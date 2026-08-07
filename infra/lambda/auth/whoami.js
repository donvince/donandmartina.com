'use strict';

const { parseCookies } = require('./cookies');
const { verifyToken } = require('./jwt');
const config = require('./config');

async function handleWhoami(request) {
  const cookieHeader = request.headers.cookie?.[0]?.value || '';
  const token = parseCookies(cookieHeader).id_token;
  let email = null;
  if (token) {
    try {
      const payload = await verifyToken(token, config);
      email = payload.email || null;
    } catch (_) {}
  }
  return {
    status: '200',
    statusDescription: 'OK',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'application/json' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: JSON.stringify({ email }),
  };
}

module.exports = { handleWhoami };
