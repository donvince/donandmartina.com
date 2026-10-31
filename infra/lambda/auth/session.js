'use strict';

const { verifyToken } = require('./jwt');
const { requestCookies, serializeCookie } = require('./cookies');
const { refreshTokens } = require('./tokens');
const config = require('./config');

const ID_TOKEN_COOKIE = 'id_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Matches the Cognito app client's IdTokenValidity (infra/cognito.yaml).
const ID_TOKEN_MAX_AGE = 60 * 60;
// Matches the Cognito app client's RefreshTokenValidity (infra/cognito.yaml).
// The refresh token is what keeps a visitor signed in between visits: when
// the hour-long ID token lapses, the edge swaps the refresh token for a new
// one without a trip through the hosted UI. Cognito runs the allow-list
// trigger on every refresh, so removing an email still ends access within an
// hour.
const REFRESH_TOKEN_MAX_AGE = 365 * 24 * 60 * 60;

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' };

function idTokenCookie(idToken) {
  return serializeCookie(ID_TOKEN_COOKIE, idToken, { ...COOKIE_OPTIONS, maxAge: ID_TOKEN_MAX_AGE });
}

function refreshTokenCookie(refreshToken) {
  return serializeCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

// Set-Cookie values for a fresh token response. Cognito only returns a
// refresh token on sign-in (or on refresh when rotation is enabled), so the
// existing refresh cookie is left alone when there isn't one.
function sessionCookies(tokens) {
  const cookies = [idTokenCookie(tokens.id_token)];
  if (typeof tokens.refresh_token === 'string' && tokens.refresh_token) {
    cookies.push(refreshTokenCookie(tokens.refresh_token));
  }
  return cookies;
}

function clearedSessionCookies() {
  return [ID_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE].map((name) =>
    serializeCookie(name, '', { ...COOKIE_OPTIONS, maxAge: 0 }));
}

function setCookieHeader(cookies) {
  return cookies.map((value) => ({ key: 'Set-Cookie', value }));
}

function signedOut(setCookies = []) {
  return { claims: null, idToken: null, setCookies };
}

// Resolves who the visitor is from their cookies, refreshing an expired ID
// token when a refresh token is available.
//
// Returns { claims, idToken, setCookies }. `claims` is null when the visitor
// is not signed in. `setCookies` lists Set-Cookie values the caller must send
// back: new tokens after a refresh, or cleared cookies after Cognito rejects
// the refresh token (revoked, expired, or the email left the allow-list).
async function resolveSession(request) {
  const cookies = requestCookies(request);

  if (cookies[ID_TOKEN_COOKIE]) {
    try {
      const claims = await verifyToken(cookies[ID_TOKEN_COOKIE], config);
      return { claims, idToken: cookies[ID_TOKEN_COOKIE], setCookies: [] };
    } catch (_) {
      // Expired or invalid: try the refresh token below.
    }
  }

  const refreshToken = cookies[REFRESH_TOKEN_COOKIE];
  if (!refreshToken) return signedOut();

  let response;
  try {
    response = await refreshTokens(refreshToken);
  } catch (err) {
    // Network failure or timeout. Keep the refresh token for next time.
    console.error(`session: refresh failed: ${err.message}`);
    return signedOut();
  }

  const tokens = response.body || {};
  if (typeof tokens.id_token !== 'string') {
    console.error(`session: refresh rejected (${response.status}): ${tokens.error || 'no id_token'}`);
    // A 4xx means Cognito will never accept this refresh token again; drop
    // it so the visitor is sent to sign in. Anything else may be transient.
    const rejected = response.status >= 400 && response.status < 500;
    return signedOut(rejected ? clearedSessionCookies() : []);
  }

  try {
    const claims = await verifyToken(tokens.id_token, config);
    return { claims, idToken: tokens.id_token, setCookies: sessionCookies(tokens) };
  } catch (err) {
    console.error(`session: refreshed id_token failed verification: ${err.message}`);
    return signedOut(clearedSessionCookies());
  }
}

module.exports = {
  REFRESH_TOKEN_COOKIE,
  clearedSessionCookies,
  resolveSession,
  sessionCookies,
  setCookieHeader,
};
