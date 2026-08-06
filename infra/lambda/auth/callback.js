'use strict';

const https = require('https');
const { verifyToken } = require('./jwt');
const { serializeCookie } = require('./cookies');
const { buildLoginUrl, buildSwitchAccountUrl } = require('./urls');
const { renderErrorPage } = require('./error-page');
const config = require('./config');

// Anything that leaves this handler by throwing surfaces to the visitor as
// CloudFront's own "503 ERROR / The Lambda function ... is invalid" page, since
// index.js returns handleCallback(request) straight to CloudFront. So every
// failure below is turned into a deliberate response instead.
function signInFailed(reason) {
  // Log rather than attaching to the response: CloudFront validates the
  // response shape and rejects unknown top-level keys with a
  // LambdaValidationError, which would itself become a 503.
  console.error(`callback: sign-in failed: ${reason}`);
  return {
    status: '403',
    statusDescription: 'Forbidden',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Sign-in failed</title></head>
<body style="background:#0f1117;color:#e2e8f0;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;">
<div style="background:#1a1f2e;border:1px solid #2d3748;border-radius:16px;padding:2.5rem;max-width:420px;text-align:center;">
<h1 style="font-size:1.25rem;margin:0 0 .5rem;">Sign-in failed</h1>
<p style="color:#94a3b8;line-height:1.6;margin:0 0 1.5rem;">We could not complete sign-in. Please try again.</p>
<a href="/" style="display:block;padding:.75rem;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;">Back to sign in</a>
</div></body></html>`,
  };
}

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

  // Only ever redirect within this site. `state` arrives back from the browser,
  // so an absolute URL (or a scheme-relative //evil.example.com) would make this
  // an open redirect off the back of a genuine sign-in.
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    returnTo = '/';
  }

  // Someone hitting /callback directly, a bookmarked or re-used callback URL, or
  // Cognito redirecting without the usual params. There is nothing to exchange,
  // so send them back to sign in rather than attempting the exchange.
  if (!code) {
    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{ key: 'Location', value: buildLoginUrl(config, returnTo) }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
      },
    };
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    // Network failure, or a non-JSON body from the token endpoint.
    return signInFailed(`token exchange threw: ${err.message}`);
  }

  // A rejected code (expired, already redeemed, wrong client) still returns 200
  // with an OAuth error body and no id_token. Without this the undefined token
  // reached verifyToken and threw on token.split, which CloudFront rendered as
  // a bare 503.
  if (!tokens || typeof tokens.id_token !== 'string') {
    const detail = tokens && tokens.error ? tokens.error : 'no id_token in token response';
    return signInFailed(`token exchange rejected: ${detail}`);
  }

  try {
    await verifyToken(tokens.id_token, config); // validate before setting cookie
  } catch (err) {
    // Signature, issuer, audience or expiry mismatch — treat as not signed in.
    return signInFailed(`id_token verification failed: ${err.message}`);
  }

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
