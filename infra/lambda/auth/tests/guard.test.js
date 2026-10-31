jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

jest.mock('../jwt', () => ({
  verifyToken: jest.fn(),
  _resetJwksCache: jest.fn(),
}));
jest.mock('../tokens', () => ({ refreshTokens: jest.fn() }));

const { handleGuard } = require('../guard');
const { verifyToken } = require('../jwt');
const { refreshTokens } = require('../tokens');

function makeRequest(path, cookieValue, querystring = '') {
  return {
    uri: path,
    querystring,
    headers: cookieValue
      ? { cookie: [{ value: cookieValue }] }
      : {},
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleGuard', () => {
  it('passes through a request with a valid JWT', async () => {
    verifyToken.mockResolvedValue({ email: 'user@test.com' });
    const request = makeRequest('/index.html', 'id_token=valid.jwt.token');
    const result = await handleGuard(request);
    expect(result).toBe(request);
  });

  it('redirects to login when no cookie is present', async () => {
    const request = makeRequest('/index.html', null);
    const result = await handleGuard(request);
    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toContain('auth.poc.example.com');
    expect(result.headers['set-cookie']).toBeUndefined();
  });

  it('redirects to login when JWT is invalid', async () => {
    verifyToken.mockRejectedValue(new Error('invalid token'));
    const request = makeRequest('/index.html', 'id_token=bad.token');
    const result = await handleGuard(request);
    expect(result.status).toBe('302');
  });

  it('refreshes an expired session and bounces back to the same URL', async () => {
    verifyToken
      .mockRejectedValueOnce(new Error('jwt expired'))
      .mockResolvedValueOnce({ email: 'user@test.com' });
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'fresh' } });

    const result = await handleGuard(makeRequest('/diary/', 'id_token=stale; refresh_token=r', 'page=2'));

    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toBe('/diary/?page=2');
    expect(result.headers['set-cookie'][0].value).toMatch(/^id_token=fresh;/);
  });

  it('clears a rejected refresh token while redirecting to login', async () => {
    refreshTokens.mockResolvedValue({ status: 400, body: { error: 'invalid_grant' } });

    const result = await handleGuard(makeRequest('/diary/', 'refresh_token=revoked'));

    expect(result.headers.location[0].value).toContain('auth.poc.example.com');
    expect(result.headers['set-cookie']).toHaveLength(2);
  });
});
