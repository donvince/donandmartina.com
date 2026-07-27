jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  appClientSecret: 'test-secret',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

// Mock the HTTPS token exchange
jest.mock('https', () => ({
  request: jest.fn((opts, cb) => {
    const res = {
      on: jest.fn((event, handler) => {
        if (event === 'data') handler(JSON.stringify({ id_token: 'fake.id.token' }));
        if (event === 'end') handler();
      }),
      statusCode: 200,
    };
    cb(res);
    return { write: jest.fn(), end: jest.fn(), on: jest.fn() };
  }),
}));

jest.mock('../jwt', () => ({
  verifyToken: jest.fn().mockResolvedValue({ email: 'user@test.com' }),
  _resetJwksCache: jest.fn(),
}));

const { handleCallback } = require('../callback');

function makeCallbackRequest(querystring) {
  return { uri: '/callback', querystring };
}

describe('handleCallback', () => {
  it('sets an id_token cookie and redirects on success', async () => {
    const state = Buffer.from(JSON.stringify({ returnTo: '/index.html' })).toString('base64url');
    const result = await handleCallback(makeCallbackRequest(`code=authcode123&state=${state}`));
    expect(result.status).toBe('302');
    const setCookie = result.headers['set-cookie'][0].value;
    expect(setCookie).toContain('id_token=fake.id.token');
    expect(setCookie).toContain('HttpOnly');
    expect(result.headers.location[0].value).toBe('/index.html');
  });

  it('returns error page when Cognito sends an error', async () => {
    const result = await handleCallback(makeCallbackRequest('error=access_denied&error_description=not+permitted&email=blocked@test.com'));
    expect(result.status).toBe('403');
    expect(result.body).toContain('Access not permitted');
  });
});
