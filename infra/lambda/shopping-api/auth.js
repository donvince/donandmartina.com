'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');

// The shopping API sits behind the same CloudFront distribution as the site,
// so the browser sends the HttpOnly id_token session cookie set by the
// auth-edge Lambda. Verify it here rather than trusting the edge: the API is
// its own security boundary.
function createAuthenticator({ userPoolId, clientId, verifier }) {
  const jwtVerifier = verifier || CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });

  return async function authenticate(event) {
    const pairs = event.cookies || (event.headers?.cookie || '').split(';');
    const cookie = pairs
      .map((value) => value.split('='))
      .find(([name]) => name.trim() === 'id_token');
    const token = cookie ? cookie.slice(1).join('=').trim() : '';
    if (!token) return null;
    try {
      return await jwtVerifier.verify(token);
    } catch (_) {
      return null;
    }
  };
}

module.exports = { createAuthenticator };
