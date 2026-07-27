const { parseCookies, serializeCookie } = require('../cookies');

describe('parseCookies', () => {
  it('parses a single cookie', () => {
    expect(parseCookies('token=abc123')).toEqual({ token: 'abc123' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('handles cookie values containing =', () => {
    const jwt = 'eyJ.eyJ.sig';
    expect(parseCookies(`token=${jwt}`)).toEqual({ token: jwt });
  });

  it('returns empty object for missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});

describe('serializeCookie', () => {
  it('sets HttpOnly, Secure, SameSite, Path', () => {
    const result = serializeCookie('token', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(result).toBe('token=abc; HttpOnly; Secure; SameSite=Lax; Path=/');
  });

  it('includes Max-Age when provided', () => {
    const result = serializeCookie('token', 'abc', { maxAge: 3600 });
    expect(result).toContain('Max-Age=3600');
  });

  it('omits optional attributes when not provided', () => {
    expect(serializeCookie('x', 'y')).toBe('x=y');
  });
});
