import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { createShoppingApi } from "../../static/shopping/model/api.js";
import { HttpError, OfflineError, SignedOutError } from "../../static/shopping/model/errors.js";
import { createSession, signInUrl } from "../../static/shopping/model/session.js";

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function scriptedFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

test("posts operations with the payload hash CloudFront needs", async () => {
  const { fetchImpl, calls } = scriptedFetch(response(200, { cart: { items: [] } }));
  const api = createShoppingApi({ session: {}, clientId: "tab-1", fetchImpl });

  await api.applyOps("home", [{ type: "removeItem", id: "a" }]);

  const { url, init } = calls[0];
  assert.equal(url, "/api/shopping/carts/home/ops");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers["x-shopping-client"], "tab-1");
  assert.equal(init.headers["x-amz-content-sha256"], createHash("sha256").update(init.body).digest("hex"));
});

test("renews a lapsed session once and retries", async () => {
  const { fetchImpl, calls } = scriptedFetch(response(401, {}), response(200, { carts: {} }));
  let renewed = 0;
  const api = createShoppingApi({ session: { getToken: async () => { renewed += 1; } }, clientId: "t", fetchImpl });

  assert.deepEqual(await api.loadAll(), { carts: {} });
  assert.equal(renewed, 1);
  assert.equal(calls.length, 2);
});

test("reports signed out when renewal doesn't help", async () => {
  const { fetchImpl } = scriptedFetch(response(401, {}), response(401, {}));
  const api = createShoppingApi({ session: { getToken: async () => {} }, clientId: "t", fetchImpl });
  await assert.rejects(api.loadAll(), SignedOutError);
});

test("reports offline when the request can't be made", async () => {
  const { fetchImpl } = scriptedFetch(new TypeError("Failed to fetch"));
  const api = createShoppingApi({ session: {}, clientId: "t", fetchImpl });
  await assert.rejects(api.loadAll(), OfflineError);
});

test("surfaces server errors with their status", async () => {
  const { fetchImpl } = scriptedFetch(response(400, { error: "invalid cart id" }));
  const api = createShoppingApi({ session: {}, clientId: "t", fetchImpl });
  await assert.rejects(api.loadAll(), (error) => error instanceof HttpError && error.status === 400 && error.permanent);
});

test("session caches the token until shortly before it expires", async () => {
  let clock = 0;
  const { fetchImpl, calls } = scriptedFetch(
    response(200, { idToken: "one", expiresAt: 120_000 }),
    response(200, { idToken: "two", expiresAt: 999_999 }),
  );
  const session = createSession({ fetchImpl, now: () => clock });

  assert.equal(await session.getToken(), "one");
  assert.equal(await session.getToken(), "one");
  clock = 61_000;
  assert.equal(await session.getToken(), "two");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/token");
});

test("session reports signed out on 401", async () => {
  const { fetchImpl } = scriptedFetch(response(401, { error: "signed_out" }));
  await assert.rejects(createSession({ fetchImpl }).getToken(), SignedOutError);
});

test("signInUrl returns to the shopping list", () => {
  assert.equal(signInUrl(), "/login?returnTo=%2Fshopping%2F");
});
