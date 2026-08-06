'use strict';

const { serializeCookie } = require('./cookies');
const config = require('./config');

function handleLogout() {
  const cookie = serializeCookie('id_token', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
  const logoutUrl = `https://${config.cognitoDomain}/logout?client_id=${config.appClientId}&logout_uri=https://donandmartina.com/`;
  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: logoutUrl }],
      'set-cookie': [{ key: 'Set-Cookie', value: cookie }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}

module.exports = { handleLogout };
