'use strict';

const { resolveSession, setCookieHeader } = require('./session');
const { buildLoginUrl } = require('./urls');
const config = require('./config');

function redirect(location, setCookies) {
  const headers = {
    location: [{ key: 'Location', value: location }],
    'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
  };
  if (setCookies.length) headers['set-cookie'] = setCookieHeader(setCookies);
  return { status: '302', statusDescription: 'Found', headers };
}

async function handleGuard(request) {
  const session = await resolveSession(request);
  const path = request.uri || '/';

  if (session.claims && !session.setCookies.length) {
    return request; // valid — pass through
  }

  if (session.claims) {
    // The ID token was refreshed. A viewer-request function can't add
    // Set-Cookie to the origin's response, so bounce the browser back to the
    // same URL with the new cookies; the retry passes straight through.
    const query = request.querystring ? `?${request.querystring}` : '';
    return redirect(`${path}${query}`, session.setCookies);
  }

  return redirect(buildLoginUrl(config, path), session.setCookies);
}

module.exports = { handleGuard };
