const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn(input => input),
}));

const { handler } = require('../index');

function makeEvent(email, triggerSource = 'PreSignUp_ExternalProvider') {
  return {
    triggerSource,
    request: { userAttributes: { email } },
    response: {},
  };
}

describe('Cognito allow-list handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Parameter: { Value: 'allowed@gmail.com, OTHER@gmail.com' } });
  });

  it('allows a permitted pre-signup email and auto-confirms and verifies it', async () => {
    const event = makeEvent('ALLOWED@gmail.com');

    await expect(handler(event)).resolves.toBe(event);

    expect(event.response).toEqual({ autoConfirmUser: true, autoVerifyEmail: true });
    expect(mockSend).toHaveBeenCalledWith({ Name: '/donandmartina/auth/allowed-emails' });
  });

  it('allows a permitted pre-authentication email without changing the event', async () => {
    const event = makeEvent('other@gmail.com', 'PreAuthentication_Authentication');
    const original = structuredClone(event);

    await expect(handler(event)).resolves.toBe(event);

    expect(event).toEqual(original);
  });

  it.each([
    'PreSignUp_ExternalProvider',
    'PreAuthentication_Authentication',
  ])('rejects an email not on the list for %s', async triggerSource => {
    await expect(handler(makeEvent('stranger@gmail.com', triggerSource)))
      .rejects.toThrow('not permitted');
  });

  it('rejects missing email attribute', async () => {
    const event = makeEvent(undefined);
    await expect(handler(event)).rejects.toThrow('not permitted');
  });

  it.each([
    [{ Parameter: { Value: '' } }, 'empty'],
    [{ Parameter: {} }, 'empty'],
    [{}, 'empty'],
  ])('fails closed for an invalid SSM response', async (response, message) => {
    mockSend.mockResolvedValue(response);
    await expect(handler(makeEvent('allowed@gmail.com'))).rejects.toThrow(message);
  });

  it('fails closed when SSM retrieval fails', async () => {
    mockSend.mockRejectedValue(new Error('SSM unavailable'));
    await expect(handler(makeEvent('allowed@gmail.com'))).rejects.toThrow('SSM unavailable');
  });

  it('retrieves the parameter on every invocation', async () => {
    await handler(makeEvent('allowed@gmail.com'));
    await handler(makeEvent('allowed@gmail.com', 'PreAuthentication_Authentication'));
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
