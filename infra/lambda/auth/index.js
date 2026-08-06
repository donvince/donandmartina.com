'use strict';

const { handleGuard } = require('./guard');
const { handleCallback } = require('./callback');
const { handleLogout } = require('./logout');
const { handleWhoami } = require('./whoami');

const ASSET_EXTENSIONS = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)$/i;

function isAsset(uri) {
  return uri.startsWith('/assets/') || ASSET_EXTENSIONS.test(uri);
}

// The site is served from a private S3 bucket via CloudFront Origin Access
// Control using the S3 REST origin (not the S3 website endpoint), so S3 will
// NOT auto-resolve directory indexes. We must rewrite directory-style paths to
// the underlying index.html object that Hugo's pretty URLs produce:
//   /                → /index.html
//   /diary/          → /diary/index.html
//   /diary/foo/      → /diary/foo/index.html
//   /diary/foo       → /diary/foo/index.html   (no trailing slash, no extension)
// A path whose final segment already has a file extension (e.g. /index.html)
// is left untouched.
function rewriteToIndex(uri) {
  if (uri === '/') return '/index.html';
  if (uri.endsWith('/')) return `${uri}index.html`;
  const lastSegment = uri.slice(uri.lastIndexOf('/') + 1);
  if (!lastSegment.includes('.')) {
    return `${uri}/index.html`;
  }
  return uri;
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;

  if (request.uri === '/callback') {
    return handleCallback(request);
  }

  if (request.uri === '/logout') {
    return handleLogout();
  }

  if (request.uri === '/whoami') {
    return handleWhoami(request);
  }

  if (isAsset(request.uri)) {
    return request; // bypass auth — assets must load on the error page too
  }

  const result = await handleGuard(request);

  // handleGuard returns the same request object when the JWT is valid; anything
  // else is a redirect/response we pass straight back. Only rewrite the origin
  // path for authenticated pass-through requests.
  if (result === request) {
    request.uri = rewriteToIndex(request.uri);
    return request;
  }

  return result;
};

exports._rewriteToIndex = rewriteToIndex;
exports._isAsset = isAsset;
