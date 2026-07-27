const { buildLoginUrl, buildSwitchAccountUrl } = require('../urls');

const CONFIG = {
  cognitoDomain: 'auth.poc.example.com',
  appClientId: 'client123',
  callbackUrl: 'https://poc.example.com/callback',
};

describe('buildLoginUrl', () => {
  it('includes required OAuth params', () => {
    const url = buildLoginUrl(CONFIG, '/protected');
    expect(url).toContain('https://auth.poc.example.com/login');
    expect(url).toContain('client_id=client123');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=openid+email+profile');
    expect(url).toContain(encodeURIComponent('https://poc.example.com/callback'));
  });

  it('encodes the original path in state', () => {
    const url = buildLoginUrl(CONFIG, '/my-page');
    const params = new URL(url).searchParams;
    const state = JSON.parse(Buffer.from(params.get('state'), 'base64url').toString());
    expect(state.returnTo).toBe('/my-page');
  });
});

describe('buildSwitchAccountUrl', () => {
  it('includes prompt=select_account', () => {
    const url = buildSwitchAccountUrl(CONFIG);
    expect(url).toContain('prompt=select_account');
  });
});
