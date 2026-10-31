'use strict';

const { verifyToken } = require('./jwt');
const { sessionCookies, setCookieHeader } = require('./session');
const { exchangeCode } = require('./tokens');
const { buildLoginUrl, buildSwitchAccountUrl, safeReturnTo } = require('./urls');
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

  // `state` arrives back from the browser, so it must not become an open
  // redirect off the back of a genuine sign-in.
  returnTo = safeReturnTo(returnTo);

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
    tokens = (await exchangeCode(code)).body;
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

  // The refresh token keeps the visitor signed in once the ID token lapses;
  // see session.js.
  return {
    status: '302',
    statusDescription: 'Found',
    headers: {
      location: [{ key: 'Location', value: returnTo }],
      'set-cookie': setCookieHeader(sessionCookies(tokens)),
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
  };
}

module.exports = { handleCallback };
