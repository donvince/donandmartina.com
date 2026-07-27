// Mock config before requiring handler
// config.js is generated at CI time and gitignored; mock it virtually so
// tests run offline without a real config module present.
jest.mock('../config', () => ({
  allowedEmails: ['allowed@gmail.com'],
}), { virtual: true });

const { handler } = require('../index');

function makeEvent(email, triggerSource = 'PreSignUp_ExternalProvider') {
  return {
    triggerSource,
    request: { userAttributes: { email } },
    response: {},
  };
}

describe('pre-signup handler', () => {
  it('allows a permitted email and auto-confirms', async () => {
    const event = makeEvent('allowed@gmail.com');
    const result = await handler(event);
    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
  });

  it('throws for an email not on the list', async () => {
    const event = makeEvent('stranger@gmail.com');
    await expect(handler(event)).rejects.toThrow('not permitted');
  });

  it('rejects missing email attribute', async () => {
    const event = makeEvent(undefined);
    await expect(handler(event)).rejects.toThrow();
  });
});
