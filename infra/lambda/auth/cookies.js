'use strict';

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, pair) => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return acc;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    acc[key] = value;
    return acc;
  }, {});
}

// CloudFront can deliver cookies as several `cookie` header entries, so read
// them all rather than only the first.
function requestCookies(request) {
  const entries = request?.headers?.cookie || [];
  return parseCookies(entries.map((entry) => entry.value).join('; '));
}

function serializeCookie(name, value, opts = {}) {
  let cookie = `${name}=${value}`;
  if (opts.httpOnly) cookie += '; HttpOnly';
  if (opts.secure)   cookie += '; Secure';
  if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
  // Max-Age=0 is meaningful (delete the cookie), so test for a number rather
  // than truthiness.
  if (Number.isFinite(opts.maxAge)) cookie += `; Max-Age=${opts.maxAge}`;
  if (opts.path)     cookie += `; Path=${opts.path}`;
  return cookie;
}

module.exports = { parseCookies, requestCookies, serializeCookie };
