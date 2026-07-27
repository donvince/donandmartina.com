'use strict';

const { verifyToken } = require('./jwt');
const { parseCookies } = require('./cookies');
const { buildLoginUrl } = require('./urls');
const config = require('./config');

async function handleGuard(request) {
  const cookieHeader = request.headers.cookie
    ? request.headers.cookie[0].value
    : '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies.id_token;

  if (token) {
    try {
      await verifyToken(token, config);
      return request; // valid — pass through
    } catch (_) {
      // invalid or expired — fall through to redirect
    }
  }

  const returnTo = request.uri || '/';
  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: buildLoginUrl(config, returnTo) }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}

module.exports = { handleGuard };
