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

const { handleWhoami } = require('../whoami');
const { verifyToken } = require('../jwt');

function makeRequest(cookieValue) {
  return {
    headers: cookieValue
      ? { cookie: [{ value: `id_token=${cookieValue}` }] }
      : {},
  };
}

describe('handleWhoami', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the verified user email when the session token is valid', async () => {
    verifyToken.mockResolvedValue({ email: 'user@test.com' });

    const result = await handleWhoami(makeRequest('valid.jwt.token'));

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

    const result = await handleWhoami(makeRequest('bad.jwt.token'));

    expect(JSON.parse(result.body)).toEqual({ email: null });
  });
});
