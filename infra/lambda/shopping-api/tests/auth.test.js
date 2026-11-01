const { createAuthenticator } = require('../auth');

describe('createAuthenticator', () => {
  const verifier = { verify: jest.fn() };
  const authenticate = createAuthenticator({ verifier });

  beforeEach(() => verifier.verify.mockReset());

  it('verifies the id_token session cookie', async () => {
    verifier.verify.mockResolvedValue({ email: 'don@test.com' });

    const user = await authenticate({ cookies: ['refresh_token=r', 'id_token=a.b.c'] });

    expect(user).toEqual({ email: 'don@test.com' });
    expect(verifier.verify).toHaveBeenCalledWith('a.b.c');
  });

  it('falls back to the cookie header', async () => {
    verifier.verify.mockResolvedValue({ email: 'don@test.com' });
    await authenticate({ headers: { cookie: 'x=1; id_token=a.b.c' } });
    expect(verifier.verify).toHaveBeenCalledWith('a.b.c');
  });

  it('returns null without a session cookie', async () => {
    expect(await authenticate({ cookies: ['refresh_token=r'] })).toBeNull();
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('returns null for an invalid or expired token', async () => {
    verifier.verify.mockRejectedValue(new Error('expired'));
    expect(await authenticate({ cookies: ['id_token=a.b.c'] })).toBeNull();
  });
});
