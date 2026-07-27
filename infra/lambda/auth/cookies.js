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

function serializeCookie(name, value, opts = {}) {
  let cookie = `${name}=${value}`;
  if (opts.httpOnly) cookie += '; HttpOnly';
  if (opts.secure)   cookie += '; Secure';
  if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
  if (opts.maxAge)   cookie += `; Max-Age=${opts.maxAge}`;
  if (opts.path)     cookie += `; Path=${opts.path}`;
  return cookie;
}

module.exports = { parseCookies, serializeCookie };
