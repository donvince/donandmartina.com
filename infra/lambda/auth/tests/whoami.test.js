jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

jest.mock('../jwt', () => ({
  verifyToken: jest.fn(),
}));
jest.mock('../tokens', () => ({ refreshTokens: jest.fn() }));

const { handleToken, handleWhoami } = require('../whoami');
const { verifyToken } = require('../jwt');
const { refreshTokens } = require('../tokens');

function makeRequest(cookieValue) {
  return {
    headers: cookieValue
      ? { cookie: [{ value: cookieValue }] }
      : {},
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleWhoami', () => {
  it('returns the verified user email when the session token is valid', async () => {
    verifyToken.mockResolvedValue({ email: 'user@test.com' });

    const result = await handleWhoami(makeRequest('id_token=valid.jwt.token'));

    expect(result.status).toBe('200');
    expect(JSON.parse(result.body)).toEqual({ email: 'user@test.com' });
  });

  it('returns null when no session token is present', async () => {
    const result = await handleWhoami(makeRequest(null));

    expect(JSON.parse(result.body)).toEqual({ email: null });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('returns null when the session token is invalid', async () => {
    verifyToken.mockRejectedValue(new Error('invalid token'));

    const result = await handleWhoami(makeRequest('id_token=bad.jwt.token'));

    expect(JSON.parse(result.body)).toEqual({ email: null });
  });

  it('refreshes a lapsed session so the homepage still shows the member card', async () => {
    verifyToken
      .mockRejectedValueOnce(new Error('jwt expired'))
      .mockResolvedValueOnce({ email: 'user@test.com' });
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'fresh' } });

    const result = await handleWhoami(makeRequest('id_token=stale; refresh_token=r'));

    expect(JSON.parse(result.body)).toEqual({ email: 'user@test.com' });
    expect(result.headers['set-cookie'][0].value).toMatch(/^id_token=fresh;/);
  });
});

describe('handleToken', () => {
  it('returns the ID token and its expiry to same-origin scripts', async () => {
    verifyToken.mockResolvedValue({ email: 'user@test.com', exp: 1700000000 });

    const result = await handleToken(makeRequest('id_token=valid.jwt.token'));

    expect(result.status).toBe('200');
    expect(result.headers['cache-control'][0].value).toBe('no-store');
    expect(JSON.parse(result.body)).toEqual({
      idToken: 'valid.jwt.token',
      email: 'user@test.com',
      expiresAt: 1700000000000,
    });
  });

  it('returns the refreshed token when the ID token had lapsed', async () => {
    verifyToken
      .mockRejectedValueOnce(new Error('jwt expired'))
      .mockResolvedValueOnce({ email: 'user@test.com', exp: 1700000000 });
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'fresh' } });

    const result = await handleToken(makeRequest('id_token=stale; refresh_token=r'));

    expect(JSON.parse(result.body).idToken).toBe('fresh');
    expect(result.headers['set-cookie']).toHaveLength(1);
  });

  it('returns 401 when signed out', async () => {
    const result = await handleToken(makeRequest(null));

    expect(result.status).toBe('401');
    expect(JSON.parse(result.body)).toEqual({ error: 'signed_out' });
  });
});
