'use strict';

const { resolveSession, setCookieHeader } = require('./session');

function jsonResponse(status, statusDescription, body, setCookies = []) {
  const headers = {
    'content-type': [{ key: 'Content-Type', value: 'application/json' }],
    'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
  };
  if (setCookies.length) headers['set-cookie'] = setCookieHeader(setCookies);
  return { status, statusDescription, headers, body: JSON.stringify(body) };
}

async function handleWhoami(request) {
  const session = await resolveSession(request);
  return jsonResponse('200', 'OK', { email: session.claims?.email || null }, session.setCookies);
}

// Hands the signed-in visitor's ID token to page scripts that need to present
// it to another AWS service (the shopping list's AppSync Events
// subscription), refreshing it first if it has lapsed. The cookie stays
// HttpOnly; this same-origin endpoint is the only way scripts can read it,
// and browsers block cross-origin pages from reading the response.
async function handleToken(request) {
  const session = await resolveSession(request);
  if (!session.claims) {
    return jsonResponse('401', 'Unauthorized', { error: 'signed_out' }, session.setCookies);
  }
  return jsonResponse('200', 'OK', {
    idToken: session.idToken,
    email: session.claims.email || null,
    expiresAt: session.claims.exp * 1000,
  }, session.setCookies);
}

module.exports = { handleToken, handleWhoami };
