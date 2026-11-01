// HTTP client for the shopping API (/api/shopping, served by the site's own
// CloudFront distribution, so the session cookie authenticates each call).

import { HttpError, OfflineError, SignedOutError } from "./errors.js";

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createShoppingApi({
  session,
  clientId,
  fetchImpl = globalThis.fetch.bind(globalThis),
  basePath = "/api/shopping",
}) {
  async function send(path, { method = "GET", body } = {}) {
    // Identifies this tab, so it can ignore change events it caused.
    const headers = { "x-shopping-client": clientId };
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
      // CloudFront signs requests to the API with Lambda origin access
      // control, which needs the payload hash up front.
      headers["x-amz-content-sha256"] = await sha256Hex(payload);
    }
    try {
      return await fetchImpl(`${basePath}${path}`, {
        method,
        headers,
        body: payload,
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (error) {
      throw new OfflineError(error.message);
    }
  }

  async function request(path, options) {
    let response = await send(path, options);
    if (response.status === 401) {
      // The hour-long ID token cookie has probably lapsed. /token swaps the
      // refresh token for a new one (or throws SignedOutError), then retry.
      await session.getToken({ fresh: true });
      response = await send(path, options);
      if (response.status === 401) throw new SignedOutError();
    }
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = (await response.json()).error || message; } catch (_error) { /* not JSON */ }
      throw new HttpError(response.status, message);
    }
    return response.json();
  }

  return {
    // Every cart, plus the AppSync Events endpoints for change notifications.
    loadAll: () => request(""),
    // Applies operations to a cart; resolves the cart as the server now has it.
    applyOps: (cartId, ops) => request(`/carts/${encodeURIComponent(cartId)}/ops`, {
      method: "POST",
      body: { ops },
    }),
  };
}
