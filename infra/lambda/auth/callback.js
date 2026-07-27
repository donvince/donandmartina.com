'use strict';

const https = require('https');
const { verifyToken } = require('./jwt');
const { serializeCookie } = require('./cookies');
const { buildSwitchAccountUrl } = require('./urls');
const { renderErrorPage } = require('./error-page');
const config = require('./config');

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.appClientId,
      redirect_uri: config.callbackUrl,
    }).toString();

    const auth = Buffer.from(`${config.appClientId}:${config.appClientSecret}`).toString('base64');

    const options = {
      hostname: config.cognitoDomain,
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function handleCallback(request) {
  const params = new URLSearchParams(request.querystring || '');

  // Cognito error response
  if (params.get('error')) {
    const email = params.get('email') || 'unknown';
    const switchUrl = buildSwitchAccountUrl(config);
    return {
      status: '403',
      statusDescription: 'Forbidden',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] },
      body: renderErrorPage(email, switchUrl),
    };
  }

  const code = params.get('code');
  const stateRaw = params.get('state') || '';
  let returnTo = '/';
  try {
    returnTo = JSON.parse(Buffer.from(stateRaw, 'base64url').toString()).returnTo || '/';
  } catch (_) {}

  const tokens = await exchangeCode(code);
  await verifyToken(tokens.id_token, config); // validate before setting cookie

  const cookie = serializeCookie('id_token', tokens.id_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 3600,
  });

  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: returnTo }],
      'set-cookie': [{ key: 'Set-Cookie', value: cookie }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}

module.exports = { handleCallback };
