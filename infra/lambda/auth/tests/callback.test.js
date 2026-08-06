jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  appClientSecret: 'test-secret',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

// Mock the HTTPS token exchange. The body and transport behaviour are settable
// per test so the failure paths (rejected code, network error, malformed JSON)
// are reachable — a hardcoded happy-path body makes them untestable.
let mockTokenResponseBody = JSON.stringify({ id_token: 'fake.id.token' });
let mockRequestError = null;

jest.mock('https', () => ({
  request: jest.fn((opts, cb) => {
    const handlers = {};
    if (!mockRequestError) {
      const res = {
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(mockTokenResponseBody);
          if (event === 'end') handler();
        }),
        statusCode: 200,
      };
      cb(res);
    }
    return {
      write: jest.fn(),
      end: jest.fn(() => {
        if (mockRequestError && handlers.error) handlers.error(mockRequestError);
      }),
      on: jest.fn((event, handler) => { handlers[event] = handler; }),
    };
  }),
}));

jest.mock('../jwt', () => ({
  verifyToken: jest.fn().mockResolvedValue({ email: 'user@test.com' }),
  _resetJwksCache: jest.fn(),
}));

const { handleCallback } = require('../callback');
const { verifyToken } = require('../jwt');

function makeCallbackRequest(querystring) {
  return { uri: '/callback', querystring };
}

function stateFor(returnTo) {
  return Buffer.from(JSON.stringify({ returnTo })).toString('base64url');
}

beforeEach(() => {
  mockTokenResponseBody = JSON.stringify({ id_token: 'fake.id.token' });
  mockRequestError = null;
  verifyToken.mockReset();
  verifyToken.mockResolvedValue({ email: 'user@test.com' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

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

  // Regression: hitting /callback with no code used to reach verifyToken with an
  // undefined token, throwing on token.split and surfacing as CloudFront's bare
  // "503 ERROR ... Lambda function is invalid" page.
  describe('when there is no authorization code', () => {
    it('redirects to sign in rather than throwing', async () => {
      const result = await handleCallback(makeCallbackRequest(''));
      expect(result.status).toBe('302');
      expect(result.headers.location[0].value).toContain('/login?');
      expect(result.headers['set-cookie']).toBeUndefined();
    });

    it('does not attempt to verify a token', async () => {
      await handleCallback(makeCallbackRequest(''));
      expect(verifyToken).not.toHaveBeenCalled();
    });

    it('handles a missing querystring entirely', async () => {
      const result = await handleCallback({ uri: '/callback' });
      expect(result.status).toBe('302');
    });

    it('preserves returnTo so the visitor lands where they meant to', async () => {
      const result = await handleCallback(makeCallbackRequest(`state=${stateFor('/diary/')}`));
      // returnTo is carried base64url-encoded inside the login URL's own state
      // param, so decode it rather than substring-matching the URL.
      const state = new URL(result.headers.location[0].value).searchParams.get('state');
      expect(JSON.parse(Buffer.from(state, 'base64url').toString()).returnTo).toBe('/diary/');
    });
  });

  describe('when the token exchange does not yield an id_token', () => {
    it('shows sign-in failed for a rejected code', async () => {
      mockTokenResponseBody = JSON.stringify({ error: 'invalid_grant' });
      const result = await handleCallback(makeCallbackRequest('code=expired'));
      expect(result.status).toBe('403');
      expect(result.body).toContain('Sign-in failed');
      expect(result.headers['set-cookie']).toBeUndefined();
    });

    it('does not set a cookie from a non-string id_token', async () => {
      mockTokenResponseBody = JSON.stringify({ id_token: null });
      const result = await handleCallback(makeCallbackRequest('code=weird'));
      expect(result.status).toBe('403');
      expect(result.headers['set-cookie']).toBeUndefined();
    });

    it('survives a malformed JSON body', async () => {
      mockTokenResponseBody = 'not json at all';
      const result = await handleCallback(makeCallbackRequest('code=abc'));
      expect(result.status).toBe('403');
      expect(result.body).toContain('Sign-in failed');
    });

    it('survives a network error talking to Cognito', async () => {
      mockRequestError = new Error('socket hang up');
      const result = await handleCallback(makeCallbackRequest('code=abc'));
      expect(result.status).toBe('403');
      expect(result.body).toContain('Sign-in failed');
    });
  });

  describe('when the id_token fails verification', () => {
    it('does not set a cookie for an invalid signature', async () => {
      verifyToken.mockRejectedValue(new Error('invalid signature'));
      const result = await handleCallback(makeCallbackRequest('code=abc'));
      expect(result.status).toBe('403');
      expect(result.body).toContain('Sign-in failed');
      expect(result.headers['set-cookie']).toBeUndefined();
    });
  });

  // `state` round-trips through the browser, so a crafted value must not be able
  // to turn a real sign-in into a redirect off-site.
  describe('returnTo is confined to this site', () => {
    it.each([
      ['an absolute URL', 'https://evil.example.com/'],
      ['a scheme-relative URL', '//evil.example.com/'],
      ['a non-path value', 'evil.example.com'],
    ])('rewrites %s to /', async (_label, hostile) => {
      const result = await handleCallback(makeCallbackRequest(`code=abc&state=${stateFor(hostile)}`));
      expect(result.status).toBe('302');
      expect(result.headers.location[0].value).toBe('/');
    });

    it('still allows an ordinary in-site path', async () => {
      const result = await handleCallback(makeCallbackRequest(`code=abc&state=${stateFor('/diary/foo/')}`));
      expect(result.headers.location[0].value).toBe('/diary/foo/');
    });

    it('falls back to / when state is not valid base64 JSON', async () => {
      const result = await handleCallback(makeCallbackRequest('code=abc&state=%%%not-base64%%%'));
      expect(result.headers.location[0].value).toBe('/');
    });
  });
});
