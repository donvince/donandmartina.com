const { createPublisher } = require('../events');

describe('createPublisher', () => {
  const credentials = () => Promise.resolve({ accessKeyId: 'AKID', secretAccessKey: 'secret', sessionToken: 'session' });

  it('publishes a signed cart-changed event to the cart channel', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));
    const publisher = createPublisher({
      httpDomain: 'abc.appsync-api.us-east-1.amazonaws.com',
      namespace: 'shopping',
      region: 'us-east-1',
      credentials,
      fetchImpl,
    });

    await publisher.publishCartChanged('home', 'tab-1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://abc.appsync-api.us-east-1.amazonaws.com/event');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      channel: '/shopping/home',
      events: [JSON.stringify({ type: 'cart-changed', cartId: 'home', source: 'tab-1' })],
    });
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/appsync\/aws4_request/);
    expect(init.headers['x-amz-security-token']).toBe('session');
  });

  it('throws when AppSync rejects the publish', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 403, text: async () => 'denied' }));
    const publisher = createPublisher({
      httpDomain: 'abc.example', namespace: 'shopping', region: 'us-east-1', credentials, fetchImpl,
    });

    await expect(publisher.publishCartChanged('home', null)).rejects.toThrow('403 denied');
  });
});
