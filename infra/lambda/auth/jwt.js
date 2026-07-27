'use strict';

const { createPublicKey } = require('crypto');
const { verify } = require('jsonwebtoken');
const https = require('https');

let cachedJwks = null;

function _resetJwksCache(jwks) {
  cachedJwks = jwks;
}

function fetchJwks(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function getPublicKey(kid, jwksUrl) {
  if (!cachedJwks) {
    cachedJwks = await fetchJwks(jwksUrl);
  }
  const keyData = cachedJwks.keys.find(k => k.kid === kid);
  if (!keyData) throw new Error(`Key ID '${kid}' not found in JWKS`);
  return createPublicKey({ format: 'jwk', key: keyData });
}

async function verifyToken(token, config) {
  const { cognitoRegion, userPoolId, appClientId } = config;
  const headerB64 = token.split('.')[0];
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const jwksUrl = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const publicKey = await getPublicKey(header.kid, jwksUrl);
  return verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${cognitoRegion}.amazonaws.com/${userPoolId}`,
    audience: appClientId,
  });
}

module.exports = { verifyToken, _resetJwksCache };
