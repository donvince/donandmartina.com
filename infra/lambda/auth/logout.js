'use strict';

const { requestCookies } = require('./cookies');
const { REFRESH_TOKEN_COOKIE, clearedSessionCookies, setCookieHeader } = require('./session');
const { revokeRefreshToken } = require('./tokens');
const config = require('./config');

async function handleLogout(request) {
  // Revoke the long-lived refresh token so a copy of the cookie can't keep
  // minting sessions. Best effort: signing out locally must still work if
  // Cognito is unreachable.
  const refreshToken = requestCookies(request)[REFRESH_TOKEN_COOKIE];
  if (refreshToken) {
    try {
      const response = await revokeRefreshToken(refreshToken);
      if (response.status !== 200) {
        console.error(`logout: revoke rejected (${response.status}): ${response.body?.error || 'unknown'}`);
      }
    } catch (err) {
      console.error(`logout: revoke failed: ${err.message}`);
    }
  }

  const logoutUrl = `https://${config.cognitoDomain}/logout?client_id=${config.appClientId}&logout_uri=https://donandmartina.com/`;
  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: logoutUrl }],
      'set-cookie': setCookieHeader(clearedSessionCookies()),
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}

module.exports = { handleLogout };
