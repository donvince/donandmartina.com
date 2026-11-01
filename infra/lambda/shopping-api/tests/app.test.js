const { createApp } = require('../app');

const realtime = { httpDomain: 'h.example', realtimeDomain: 'r.example', namespace: 'shopping' };

function makeApp({ user = { email: 'don@test.com' }, records = new Map() } = {}) {
  const store = {
    loadAllCarts: jest.fn(async () => records),
    loadCartRecords: jest.fn(async (cartId) => records.get(cartId) || []),
    applyWrites: jest.fn(async () => {}),
  };
  const publisher = { publishCartChanged: jest.fn(async () => {}) };
  const logger = { log: jest.fn(), error: jest.fn() };
  const handle = createApp({ authenticate: jest.fn(async () => user), store, publisher, realtime, logger });
  return { handle, store, publisher, logger };
}

function request(method, rawPath, { body, headers = {} } = {}) {
  return {
    rawPath,
    requestContext: { http: { method } },
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function parse(response) {
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

describe('shopping API', () => {
  it('rejects requests without a valid session', async () => {
    const { handle, store } = makeApp({ user: null });
    expect(parse(await handle(request('GET', '/api/shopping')))).toEqual({
      status: 401, body: { error: 'unauthorized' },
    });
    expect(store.loadAllCarts).not.toHaveBeenCalled();
  });

  it('loads every cart with the realtime config', async () => {
    const records = new Map([['home', [
      { cartId: 'home', sk: 'item#a', kind: 'item', id: 'a', name: 'milk', checked: false, createdAt: 1 },
    ]]]);
    const { handle } = makeApp({ records });

    const { status, body } = parse(await handle(request('GET', '/api/shopping')));

    expect(status).toBe(200);
    expect(body).toEqual({
      carts: { home: { items: [{ id: 'a', name: 'milk', checked: false, createdAt: 1 }], favourites: [], favouritesInitialised: false } },
      realtime,
    });
  });

  it('applies operations, publishes a change and returns the cart', async () => {
    const { handle, store, publisher } = makeApp();

    const { status, body } = parse(await handle(request('POST', '/api/shopping/carts/home/ops', {
      body: { ops: [{ type: 'addItem', id: 'a', name: 'milk', createdAt: 3 }] },
      headers: { 'x-shopping-client': 'tab-1' },
    })));

    expect(status).toBe(200);
    expect(body.cart.items).toEqual([{ id: 'a', name: 'milk', checked: false, createdAt: 3 }]);
    expect(store.loadCartRecords).toHaveBeenCalledWith('home');
    expect(store.applyWrites).toHaveBeenCalledTimes(1);
    expect(publisher.publishCartChanged).toHaveBeenCalledWith('home', 'tab-1');
  });

  it('does not publish when nothing changed', async () => {
    const { handle, store, publisher } = makeApp();

    await handle(request('POST', '/api/shopping/carts/home/ops', {
      body: { ops: [{ type: 'removeItem', id: 'missing' }] },
    }));

    expect(store.applyWrites).not.toHaveBeenCalled();
    expect(publisher.publishCartChanged).not.toHaveBeenCalled();
  });

  it('keeps the write when publishing fails', async () => {
    const { handle, publisher, logger } = makeApp();
    publisher.publishCartChanged.mockRejectedValue(new Error('boom'));

    const response = await handle(request('POST', '/api/shopping/carts/home/ops', {
      body: { ops: [{ type: 'addItem', id: 'a', name: 'milk', createdAt: 3 }] },
    }));

    expect(response.statusCode).toBe(200);
    expect(logger.error).toHaveBeenCalled();
  });

  it('drops a malformed client id rather than echoing it', async () => {
    const { handle, publisher } = makeApp();
    await handle(request('POST', '/api/shopping/carts/home/ops', {
      body: { ops: [{ type: 'addItem', id: 'a', name: 'milk', createdAt: 3 }] },
      headers: { 'x-shopping-client': '<script>' },
    }));
    expect(publisher.publishCartChanged).toHaveBeenCalledWith('home', null);
  });

  it('requires a JSON content type for writes', async () => {
    const { handle } = makeApp();
    const response = await handle(request('POST', '/api/shopping/carts/home/ops', {
      body: { ops: [] },
      headers: { 'content-type': 'text/plain' },
    }));
    expect(response.statusCode).toBe(415);
  });

  it.each([
    ['/api/shopping/carts/Home/ops', { ops: [{ type: 'removeItem', id: 'a' }] }, 'invalid cart id'],
    ['/api/shopping/carts/home/ops', { ops: [{ type: 'nope' }] }, 'unknown operation type: nope'],
  ])('rejects bad input at %s', async (path, body, error) => {
    const { handle } = makeApp();
    expect(parse(await handle(request('POST', path, { body })))).toEqual({ status: 400, body: { error } });
  });

  it('rejects a body that is not JSON', async () => {
    const { handle } = makeApp();
    const event = request('POST', '/api/shopping/carts/home/ops');
    event.body = 'not json';
    expect(parse(await handle(event)).status).toBe(400);
  });

  it('reads base64-encoded bodies', async () => {
    const { handle } = makeApp();
    const event = request('POST', '/api/shopping/carts/home/ops');
    event.body = Buffer.from(JSON.stringify({ ops: [{ type: 'removeItem', id: 'a' }] })).toString('base64');
    event.isBase64Encoded = true;
    expect((await handle(event)).statusCode).toBe(200);
  });

  it.each([
    ['POST', '/api/shopping', 405],
    ['GET', '/api/shopping/carts/home/ops', 405],
    ['GET', '/api/elsewhere', 404],
  ])('%s %s returns %i', async (method, path, status) => {
    const { handle } = makeApp();
    expect((await handle(request(method, path))).statusCode).toBe(status);
  });

  it('hides internal errors', async () => {
    const { handle, store, logger } = makeApp();
    store.loadAllCarts.mockRejectedValue(new Error('dynamo down'));
    expect(parse(await handle(request('GET', '/api/shopping')))).toEqual({
      status: 500, body: { error: 'internal error' },
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
