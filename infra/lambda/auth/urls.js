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

module.exports = { buildLoginUrl, buildSwitchAccountUrl };
