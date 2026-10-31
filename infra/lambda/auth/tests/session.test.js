jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  appClientSecret: 'test-secret',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

jest.mock('../jwt', () => ({ verifyToken: jest.fn() }));
jest.mock('../tokens', () => ({ refreshTokens: jest.fn() }));

const { resolveSession, sessionCookies } = require('../session');
const { verifyToken } = require('../jwt');
const { refreshTokens } = require('../tokens');

function requestWith(cookies) {
  const value = Object.entries(cookies).map(([name, v]) => `${name}=${v}`).join('; ');
  return { headers: value ? { cookie: [{ value }] } : {} };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resolveSession', () => {
  it('accepts a valid ID token without refreshing', async () => {
    verifyToken.mockResolvedValue({ email: 'a@test.com' });

    const session = await resolveSession(requestWith({ id_token: 'good', refresh_token: 'r' }));

    expect(session).toEqual({ claims: { email: 'a@test.com' }, idToken: 'good', setCookies: [] });
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('is signed out with no cookies', async () => {
    const session = await resolveSession(requestWith({}));
    expect(session.claims).toBeNull();
    expect(session.setCookies).toEqual([]);
  });

  it('refreshes an expired ID token with the refresh token', async () => {
    verifyToken
      .mockRejectedValueOnce(new Error('jwt expired'))
      .mockResolvedValueOnce({ email: 'a@test.com' });
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'fresh' } });

    const session = await resolveSession(requestWith({ id_token: 'stale', refresh_token: 'r' }));

    expect(refreshTokens).toHaveBeenCalledWith('r');
    expect(session.claims).toEqual({ email: 'a@test.com' });
    expect(session.idToken).toBe('fresh');
    expect(session.setCookies).toHaveLength(1);
    expect(session.setCookies[0]).toMatch(/^id_token=fresh; HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Path=\/$/);
  });

  it('refreshes when only the refresh token cookie survives', async () => {
    verifyToken.mockResolvedValue({ email: 'a@test.com' });
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'fresh' } });

    const session = await resolveSession(requestWith({ refresh_token: 'r' }));

    expect(session.idToken).toBe('fresh');
  });

  it('clears both cookies when Cognito rejects the refresh token', async () => {
    refreshTokens.mockResolvedValue({ status: 400, body: { error: 'invalid_grant' } });

    const session = await resolveSession(requestWith({ refresh_token: 'revoked' }));

    expect(session.claims).toBeNull();
    expect(session.setCookies).toEqual([
      'id_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'refresh_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ]);
  });

  it('keeps the refresh token when Cognito is unavailable', async () => {
    refreshTokens.mockResolvedValue({ status: 503, body: {} });

    const session = await resolveSession(requestWith({ refresh_token: 'r' }));

    expect(session.claims).toBeNull();
    expect(session.setCookies).toEqual([]);
  });

  it('keeps the refresh token on a network failure', async () => {
    refreshTokens.mockRejectedValue(new Error('timed out'));

    const session = await resolveSession(requestWith({ refresh_token: 'r' }));

    expect(session.claims).toBeNull();
    expect(session.setCookies).toEqual([]);
  });

  it('clears cookies when the refreshed token fails verification', async () => {
    verifyToken.mockRejectedValue(new Error('bad signature'));
    refreshTokens.mockResolvedValue({ status: 200, body: { id_token: 'forged' } });

    const session = await resolveSession(requestWith({ refresh_token: 'r' }));

    expect(session.claims).toBeNull();
    expect(session.setCookies).toHaveLength(2);
  });
});

describe('sessionCookies', () => {
  it('stores a refresh token for a year when Cognito returns one', () => {
    const cookies = sessionCookies({ id_token: 'id', refresh_token: 'refresh' });
    expect(cookies[1]).toBe('refresh_token=refresh; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/');
  });
});
