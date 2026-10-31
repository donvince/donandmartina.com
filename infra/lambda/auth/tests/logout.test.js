jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  appClientSecret: 'test-secret',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

jest.mock('../tokens', () => ({ revokeRefreshToken: jest.fn(), refreshTokens: jest.fn() }));

const { handleLogout } = require('../logout');
const { revokeRefreshToken } = require('../tokens');

function makeRequest(cookieValue) {
  return { headers: cookieValue ? { cookie: [{ value: cookieValue }] } : {} };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('handleLogout', () => {
  it('revokes the refresh token and deletes both session cookies', async () => {
    revokeRefreshToken.mockResolvedValue({ status: 200, body: {} });

    const result = await handleLogout(makeRequest('id_token=i; refresh_token=r'));

    expect(revokeRefreshToken).toHaveBeenCalledWith('r');
    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toBe(
      'https://auth.poc.example.com/logout?client_id=test-client&logout_uri=https://donandmartina.com/',
    );
    expect(result.headers['set-cookie'].map((c) => c.value)).toEqual([
      'id_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'refresh_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ]);
  });

  it('still signs out locally when revocation fails', async () => {
    revokeRefreshToken.mockRejectedValue(new Error('timed out'));

    const result = await handleLogout(makeRequest('refresh_token=r'));

    expect(result.status).toBe('302');
    expect(result.headers['set-cookie']).toHaveLength(2);
  });

  it('skips revocation without a refresh token', async () => {
    const result = await handleLogout(makeRequest(null));

    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(result.status).toBe('302');
  });
});
