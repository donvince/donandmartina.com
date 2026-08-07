// handleGuard returns the same request object it is given when the JWT is
// valid (authenticated pass-through); otherwise it returns a redirect response.
jest.mock('../guard', () => ({
  handleGuard: jest.fn(),
}));
jest.mock('../callback', () => ({
  handleCallback: jest.fn().mockResolvedValue({ status: '302' }),
}));
jest.mock('../config', () => ({
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
  cognitoDomain: 'auth.poc.example.com',
  callbackUrl: 'https://poc.example.com/callback',
}), { virtual: true });

const { handler, _rewriteToIndex, _isAsset, _isPublicHomepage } = require('../index');
const { handleGuard } = require('../guard');
const { handleCallback } = require('../callback');

function makeEvent(uri) {
  return { Records: [{ cf: { request: { uri, headers: {}, querystring: '' } } }] };
}

// Authenticated: guard hands the request straight back so the router rewrites it.
function authenticate() {
  handleGuard.mockImplementation(async (request) => request);
}
// Unauthenticated: guard returns a 302 redirect response.
function reject() {
  handleGuard.mockResolvedValue({
    status: '302',
    headers: { location: [{ key: 'Location', value: 'https://auth.poc.example.com/login' }] },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handler routing', () => {
  it('passes asset requests through without calling guard', async () => {
    const event = makeEvent('/assets/style.css');
    const result = await handler(event);
    expect(result.uri).toBe('/assets/style.css'); // no rewrite
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('bypasses auth for common file extensions at root level', async () => {
    const event = makeEvent('/favicon.ico');
    const result = await handler(event);
    expect(result.uri).toBe('/favicon.ico'); // no rewrite
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('bypasses auth for a root-level .js file', async () => {
    const event = makeEvent('/foo.js');
    const result = await handler(event);
    expect(result.uri).toBe('/foo.js');
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('routes /callback to handleCallback', async () => {
    await handler(makeEvent('/callback'));
    expect(handleCallback).toHaveBeenCalled();
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('redirects /login to the Cognito login page', async () => {
    const result = await handler(makeEvent('/login'));
    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toContain('https://auth.poc.example.com/login');
    expect(handleGuard).not.toHaveBeenCalled();

    const params = new URL(result.headers.location[0].value).searchParams;
    const state = JSON.parse(Buffer.from(params.get('state'), 'base64url').toString());
    expect(state.returnTo).toBe('/diary/');
  });

  it('serves the homepage without calling guard', async () => {
    const result = await handler(makeEvent('/'));
    expect(result.uri).toBe('/index.html');
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('serves /index.html without calling guard', async () => {
    const result = await handler(makeEvent('/index.html'));
    expect(result.uri).toBe('/index.html');
    expect(handleGuard).not.toHaveBeenCalled();
  });

  it('routes everything else to handleGuard', async () => {
    authenticate();
    await handler(makeEvent('/diary/'));
    expect(handleGuard).toHaveBeenCalled();
  });
});

describe('authenticated directory-index rewrite', () => {
  it('rewrites an authenticated bare HTML directory request', async () => {
    authenticate();
    const result = await handler(makeEvent('/diary/'));
    expect(result.uri).toBe('/diary/index.html');
  });

  it('leaves an explicit .html request untouched', async () => {
    authenticate();
    const result = await handler(makeEvent('/index.html'));
    expect(result.uri).toBe('/index.html');
  });

  it('does NOT rewrite when unauthenticated — redirects to login instead', async () => {
    reject();
    const result = await handler(makeEvent('/diary/foo'));
    expect(result.status).toBe('302');
    expect(result.headers.location[0].value).toContain('auth.poc.example.com');
    expect(result.uri).toBeUndefined();
  });
});

describe('_rewriteToIndex', () => {
  it('rewrites root to /index.html', () => {
    expect(_rewriteToIndex('/')).toBe('/index.html');
  });

  it('rewrites a top-level trailing-slash directory', () => {
    expect(_rewriteToIndex('/diary/')).toBe('/diary/index.html');
  });

  it('rewrites a nested trailing-slash directory', () => {
    expect(_rewriteToIndex('/diary/foo/')).toBe('/diary/foo/index.html');
  });

  it('rewrites a no-slash, no-extension path (Hugo pretty URL)', () => {
    expect(_rewriteToIndex('/diary/foo')).toBe('/diary/foo/index.html');
  });

  it('leaves a path with a file extension untouched', () => {
    expect(_rewriteToIndex('/index.html')).toBe('/index.html');
    expect(_rewriteToIndex('/diary/foo/index.html')).toBe('/diary/foo/index.html');
  });
});

describe('_isAsset', () => {
  it('treats /assets/ paths as assets', () => {
    expect(_isAsset('/assets/style.css')).toBe(true);
  });

  it('treats known file extensions as assets', () => {
    expect(_isAsset('/favicon.ico')).toBe(true);
    expect(_isAsset('/foo.js')).toBe(true);
  });

  it('does not treat a directory path as an asset', () => {
    expect(_isAsset('/diary/')).toBe(false);
    expect(_isAsset('/diary/foo')).toBe(false);
  });
});

describe('_isPublicHomepage', () => {
  it('treats the root and explicit index as public homepage requests', () => {
    expect(_isPublicHomepage('/')).toBe(true);
    expect(_isPublicHomepage('/index.html')).toBe(true);
  });

  it('does not treat other paths as the public homepage', () => {
    expect(_isPublicHomepage('/diary/')).toBe(false);
  });
});
