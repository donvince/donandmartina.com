import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOps, emptyCart } from "../../static/shopping/model/cart.js";
import { HttpError, OfflineError, SignedOutError } from "../../static/shopping/model/errors.js";
import { starterFavourites } from "../../static/shopping/model/groceries.js";
import { createCartStore } from "../../static/shopping/model/store.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

// A fake server holding carts and applying operations the way the real one
// does, with switches to simulate failure.
function fakeServer(carts = {}) {
  const server = {
    carts: structuredClone(carts),
    calls: [],
    fail: null,
    async loadAll() {
      server.calls.push(["loadAll"]);
      if (server.fail) throw server.fail;
      return { carts: structuredClone(server.carts), realtime: { namespace: "shopping" } };
    },
    async applyOps(cartId, ops) {
      server.calls.push(["applyOps", cartId, ops]);
      if (server.fail || server.failOps) throw server.fail || server.failOps;
      server.carts[cartId] = applyOps(server.carts[cartId] || emptyCart(), ops);
      return { cart: structuredClone(server.carts[cartId]) };
    },
  };
  return server;
}

const favourites = [
  { name: "milk", aliases: [] },
  { name: "eggs", aliases: [] },
  { name: "Lurpak butter", aliases: [] },
  { name: "Kerrygold butter", aliases: [] },
];

function homeCart(overrides = {}) {
  return { items: [], favourites, favouritesInitialised: true, ...overrides };
}

function makeStore({ server = fakeServer({ home: homeCart() }), storage = memoryStorage(), ...options } = {}) {
  let id = 0;
  const timers = [];
  const store = createCartStore({
    api: server,
    storage,
    makeId: () => `id-${++id}`,
    now: () => 1000,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    logger: { warn() {}, error() {} },
    ...options,
  });
  return { store, server, storage, timers };
}

const names = (store) => store.getState().cart.items.map((item) => item.name);

test("loads the home cart and reports synced", async () => {
  const { store } = makeStore({ server: fakeServer({ home: homeCart({ items: [{ id: "a", name: "milk", checked: false, createdAt: 1 }] }) }) });
  assert.equal(store.getState().status, "loading");

  await store.sync();

  assert.deepEqual(names(store), ["milk"]);
  assert.equal(store.getState().status, "synced");
  assert.deepEqual(store.getState().realtime, { namespace: "shopping" });
});

test("adds groceries optimistically and sends them", async () => {
  const { store, server } = makeStore();
  await store.sync();

  const result = store.addGroceries(["MILK", "lurpak", "butter", "caviar", "milk"]);

  assert.deepEqual(result, { added: ["milk", "Lurpak butter"], duplicates: ["milk"] });
  assert.deepEqual(names(store), ["milk", "Lurpak butter"]);
  await store.sync();
  assert.deepEqual(server.carts.home.items.map((item) => item.name), ["milk", "Lurpak butter"]);
  assert.equal(store.getState().pendingCount, 0);
});

test("queues changes while offline and sends them when back", async () => {
  const { store, server, timers } = makeStore();
  await store.sync();
  server.fail = new OfflineError();

  store.addGroceries(["eggs"]);
  await store.sync();

  assert.equal(store.getState().status, "offline");
  assert.equal(store.getState().pendingCount, 1);
  assert.deepEqual(names(store), ["eggs"]);
  assert.equal(timers.length, 1, "schedules a retry");

  server.fail = null;
  timers[0].fn();
  await store.sync();

  assert.equal(store.getState().status, "synced");
  assert.deepEqual(server.carts.home.items.map((item) => item.name), ["eggs"]);
});

test("keeps queued changes across a reload", async () => {
  const storage = memoryStorage();
  const server = fakeServer({ home: homeCart() });
  const first = makeStore({ server, storage });
  await first.store.sync();
  server.fail = new OfflineError();
  first.store.addGroceries(["eggs"]);
  await first.store.sync();

  server.fail = null;
  const second = makeStore({ server, storage });
  assert.deepEqual(names(second.store), ["eggs"], "shows the cached cart and queue before loading");
  await second.store.sync();

  assert.deepEqual(server.carts.home.items.map((item) => item.name), ["eggs"]);
});

test("re-applies unsent changes on top of a reloaded cart", async () => {
  const { store, server } = makeStore();
  await store.sync();
  server.fail = new OfflineError();
  store.addGroceries(["eggs"]);
  await store.sync();

  // Someone else adds milk meanwhile.
  server.carts.home.items.push({ id: "other", name: "milk", checked: false, createdAt: 5 });
  server.fail = null;
  await store.sync();

  assert.deepEqual(names(store).sort(), ["eggs", "milk"]);
});

test("stops and asks for sign-in when the session has ended", async () => {
  const { store, server, timers } = makeStore();
  await store.sync();
  server.fail = new SignedOutError();

  store.addGroceries(["eggs"]);
  await store.sync();

  assert.equal(store.getState().status, "signed-out");
  assert.equal(store.getState().pendingCount, 1);
  assert.equal(timers.length, 0, "does not retry");
});

test("drops a batch the server permanently rejects", async () => {
  const { store, server } = makeStore();
  await store.sync();
  server.failOps = new HttpError(400, "bad");

  store.addGroceries(["eggs"]);
  await store.sync();

  assert.equal(store.getState().status, "synced");
  assert.equal(store.getState().pendingCount, 0);
  assert.deepEqual(names(store), [], "the rejected change is gone");
  assert.equal(store.getState().notice.message, "Some changes couldn't be saved");
});

test("retries after a server error", async () => {
  const { store, server, timers } = makeStore();
  server.fail = new HttpError(503);
  await store.sync();
  assert.equal(store.getState().status, "error");
  assert.equal(timers.length, 1);
});

test("toggles and removes items", async () => {
  const { store, server } = makeStore();
  await store.sync();
  store.addGroceries(["milk", "eggs"]);
  const [milk, eggs] = store.getState().cart.items;

  store.toggleItem(milk.id);
  assert.equal(store.getState().cart.items[0].checked, true);
  assert.deepEqual(store.removeItem(milk.id).name, "milk");
  assert.deepEqual(store.removeItem(eggs.id).name, "eggs");
  assert.equal(store.removeItem("missing"), null);

  await store.sync();
  assert.deepEqual(server.carts.home.items, []);
});

test("adding a ticked-off item puts it back", async () => {
  const { store, server } = makeStore();
  await store.sync();
  store.addGroceries(["milk", "eggs"]);
  const [milk] = store.getState().cart.items;
  store.toggleItem(milk.id);

  assert.deepEqual(store.addGroceries(["milk", "eggs"]), { added: ["milk"], duplicates: ["eggs"] });
  assert.equal(store.getState().cart.items.find((item) => item.id === milk.id).checked, false);
  assert.equal(store.getState().cart.items.length, 2);

  await store.sync();
  assert.equal(server.carts.home.items.find((item) => item.id === milk.id).checked, false);
});

test("manages favourites", async () => {
  const { store } = makeStore();
  await store.sync();

  assert.deepEqual(store.addFavourite("Butter").reason, "ambiguous");
  assert.deepEqual(store.addFavourite("milk").reason, "exists");
  assert.deepEqual(store.addFavourite(" ").reason, "empty");
  assert.deepEqual(store.addFavourite("x".repeat(121)).reason, "too-long");
  assert.deepEqual(store.addFavourite("oat milk"), { ok: true, name: "oat milk" });

  assert.deepEqual(store.updateFavourite("oat milk", { name: "eggs", aliases: [] }), { ok: false, reason: "exists", name: "eggs" });
  assert.deepEqual(store.updateFavourite("oat milk", { name: "Oatly", aliases: ["oat milk"] }), { ok: true, name: "Oatly" });
  store.removeFavourite("milk");

  const fav = store.getState().cart.favourites.map((f) => f.name);
  assert.deepEqual(fav, ["eggs", "Lurpak butter", "Kerrygold butter", "Oatly"]);

  store.resetFavourites();
  assert.deepEqual(store.getState().cart.favourites, starterFavourites());
});

test("seeds starter favourites for a brand new cart", async () => {
  const { store, server } = makeStore({ server: fakeServer({}) });
  await store.sync();

  assert.deepEqual(server.carts.home.favourites, starterFavourites());
  assert.equal(server.carts.home.favouritesInitialised, true);
});

test("imports this device's old local list once", async () => {
  const legacy = JSON.stringify({
    items: [{ id: "old-1", name: "eggs", checked: true, createdAt: 3 }, { id: "old-2", name: "milk", createdAt: 4 }],
    favourites: [{ name: "milk", aliases: [] }, { name: "jam", aliases: [] }],
  });
  const storage = memoryStorage({ "groceries-state-v1": legacy });
  const server = fakeServer({ home: homeCart({ items: [{ id: "s", name: "milk", checked: false, createdAt: 1 }] }) });
  const { store } = makeStore({ server, storage });

  await store.sync();

  assert.deepEqual(server.carts.home.items.map((item) => [item.name, item.checked]), [["milk", false], ["eggs", true]]);
  assert.ok(server.carts.home.favourites.some((favourite) => favourite.name === "jam"));
  assert.equal(storage.getItem("groceries-state-v1"), null);
  assert.equal(storage.getItem("groceries-state-v1.migrated"), legacy);

  await store.sync();
  assert.equal(server.carts.home.items.length, 2, "does not import twice");
});

test("seeds a new cart with this device's old favourites", async () => {
  const storage = memoryStorage({
    "groceries-state-v1": JSON.stringify({ items: [], favourites: [{ name: "jam", aliases: [] }] }),
  });
  const { store, server } = makeStore({ server: fakeServer({}), storage });
  await store.sync();
  assert.deepEqual(server.carts.home.favourites, [{ name: "jam", aliases: [] }]);
});

test("notifies subscribers", async () => {
  const { store } = makeStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  await store.sync();
  assert.ok(calls > 0);
  unsubscribe();
  const before = calls;
  store.addGroceries(["milk"]);
  assert.equal(calls, before);
});
