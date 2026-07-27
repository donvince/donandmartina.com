const { verifyToken, _resetJwksCache } = require('../jwt');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('crypto');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIG = {
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_TEST',
  appClientId: 'test-client',
};

const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST`;

function makeToken(overrides = {}) {
  return jwt.sign(
    { email: 'user@test.com', ...overrides },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '1h',
      issuer: ISSUER,
      audience: 'test-client',
      keyid: 'test-kid',
    }
  );
}

// Inject a fake JWKS cache so tests don't hit the network
function seedCache(kid, key) {
  _resetJwksCache({ keys: [{ kid, ...key.export({ format: 'jwk', type: 'public' }) }] });
}

beforeEach(() => seedCache('test-kid', publicKey));

describe('verifyToken', () => {
  it('resolves with payload for a valid token', async () => {
    const token = makeToken();
    const payload = await verifyToken(token, CONFIG);
    expect(payload.email).toBe('user@test.com');
  });

  it('rejects an expired token', async () => {
    // Sign with a negative lifetime so the token is already expired. (jsonwebtoken v9
    // forbids passing both an `exp` payload claim and the `expiresIn` option.)
    const token = jwt.sign({ email: 'user@test.com' }, privateKey, {
      algorithm: 'RS256',
      expiresIn: '-10s',
      issuer: ISSUER,
      audience: 'test-client',
      keyid: 'test-kid',
    });
    await expect(verifyToken(token, CONFIG)).rejects.toThrow();
  });

  it('rejects a token with wrong audience', async () => {
    const token = jwt.sign({}, privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: 'wrong-client',
      keyid: 'test-kid',
    });
    await expect(verifyToken(token, CONFIG)).rejects.toThrow();
  });

  it('rejects a token with wrong issuer', async () => {
    const token = jwt.sign({}, privateKey, {
      algorithm: 'RS256',
      issuer: 'https://evil.example.com',
      audience: 'test-client',
      keyid: 'test-kid',
    });
    await expect(verifyToken(token, CONFIG)).rejects.toThrow();
  });
});
