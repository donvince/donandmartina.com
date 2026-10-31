'use strict';

const https = require('https');
const config = require('./config');

// Viewer-request Lambda@Edge has a 5 second budget. Give Cognito most of it,
// but leave room to return a deliberate response rather than timing out.
const REQUEST_TIMEOUT_MS = 3000;

// POSTs a form to the Cognito hosted UI domain, authenticating as the
// confidential app client. Resolves { status, body } for any HTTP response so
// callers can tell a rejected grant (4xx) from an outage; rejects only on
// transport failure or an unparseable body.
function postToCognito(path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const auth = Buffer.from(`${config.appClientId}:${config.appClientSecret}`).toString('base64');

    const req = https.request({
      hostname: config.cognitoDomain,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (!data) {
          resolve({ status: res.statusCode, body: {} });
          return;
        }
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout?.(REQUEST_TIMEOUT_MS, () => req.destroy?.(new Error('Cognito request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function exchangeCode(code) {
  return postToCognito('/oauth2/token', {
    grant_type: 'authorization_code',
    code,
    client_id: config.appClientId,
    redirect_uri: config.callbackUrl,
  });
}

function refreshTokens(refreshToken) {
  return postToCognito('/oauth2/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.appClientId,
  });
}

function revokeRefreshToken(refreshToken) {
  return postToCognito('/oauth2/revoke', {
    token: refreshToken,
    client_id: config.appClientId,
  });
}

module.exports = { exchangeCode, refreshTokens, revokeRefreshToken };
