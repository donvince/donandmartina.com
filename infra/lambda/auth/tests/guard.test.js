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

const { handleGuard } = require('../guard');
const { verifyToken } = require('../jwt');

function makeRequest(path, cookieValue) {
  return {
    uri: path,
    headers: cookieValue
      ? { cookie: [{ value: `id_token=${cookieValue}` }] }
      : {},
  };
}

describe('handleGuard', () => {
  it('passes through a request with a valid JWT', async () => {
    verifyToken.mockResolvedValue({ email: 'user@test.com' });
    const request = makeRequest('/index.html', 'valid.jwt.token');
    const result = await handleGuard(request);
    expect(result).toBe(request);
  });

  it('redirects to login when no cookie is present', async () => {
    const request = makeRequest('/index.html', null);
    const result = await handleGuard(request);
    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toContain('auth.poc.example.com');
  });

  it('redirects to login when JWT is invalid', async () => {
    verifyToken.mockRejectedValue(new Error('invalid token'));
    const request = makeRequest('/index.html', 'bad.token');
    const result = await handleGuard(request);
    expect(result.status).toBe('302');
  });
});
