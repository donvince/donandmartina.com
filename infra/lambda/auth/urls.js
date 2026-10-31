'use strict';

function buildLoginUrl(config, returnTo) {
  const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.appClientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: config.callbackUrl,
    state,
  });
  return `https://${config.cognitoDomain}/login?${params}`;
}

function buildSwitchAccountUrl(config) {
  const params = new URLSearchParams({
    client_id: config.appClientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: config.callbackUrl,
    prompt: 'select_account',
  });
  return `https://${config.cognitoDomain}/login?${params}`;
}

// Only ever redirect within this site. Return paths arrive back from the
// browser, so an absolute URL (or a scheme-relative //evil.example.com) would
// make sign-in an open redirect.
function safeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  // Backslashes are treated as slashes by some browsers (/\evil.example.com).
  if (value.includes('\\')) return fallback;
  return value;
}

module.exports = { buildLoginUrl, buildSwitchAccountUrl, safeReturnTo };
