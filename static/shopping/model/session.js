// The visitor's sign-in session, as seen from page scripts.
//
// The session lives in HttpOnly cookies set by the site's auth-edge Lambda.
// Page scripts can't read them, but /token returns the current ID token
// (refreshing it first if it has lapsed), which is what AppSync Events needs.

import { OfflineError, SignedOutError } from "./errors.js";

// Fetch a new token a little before the old one expires.
const EXPIRY_MARGIN_MS = 60_000;

export function signInUrl(returnTo = "/shopping/") {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function createSession({ fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now } = {}) {
  let current = null;
  let inflight = null;

  async function fetchToken() {
    let response;
    try {
      response = await fetchImpl("/token", { credentials: "same-origin", cache: "no-store" });
    } catch (error) {
      throw new OfflineError(error.message);
    }
    if (response.status === 401) {
      current = null;
      throw new SignedOutError();
    }
    if (!response.ok) throw new OfflineError(`/token returned ${response.status}`);
    current = await response.json();
    return current;
  }

  // Resolves the current ID token. Also renews the session cookie when it has
  // lapsed, so callers retry a 401 from the API after calling this.
  async function getToken({ fresh = false } = {}) {
    if (!fresh && current && current.expiresAt - now() > EXPIRY_MARGIN_MS) return current.idToken;
    inflight ??= fetchToken().finally(() => { inflight = null; });
    return (await inflight).idToken;
  }

  return { getToken };
}
