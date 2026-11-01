'use strict';

const {
  ValidationError,
  applyOps,
  cartFromRecords,
  cartToJson,
  isCartId,
  parseOps,
  planWrites,
} = require('./cart');

const CLIENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const OPS_PATH = /^\/api\/shopping\/carts\/([^/]+)\/ops$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function header(event, name) {
  return event.headers?.[name] ?? event.headers?.[name.toLowerCase()];
}

function readJsonBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw || '');
  } catch (_) {
    throw new ValidationError('body must be JSON');
  }
}

// HTTP routing for the shopping API, with its collaborators injected so it
// can be tested without AWS.
//
//   GET  /api/shopping                      every cart, plus realtime config
//   POST /api/shopping/carts/{cartId}/ops   apply operations, return the cart
function createApp({ authenticate, store, publisher, realtime, logger = console }) {
  async function listCarts() {
    const carts = {};
    for (const [cartId, records] of await store.loadAllCarts()) {
      carts[cartId] = cartToJson(cartFromRecords(records));
    }
    return json(200, { carts, realtime });
  }

  async function applyCartOps(event, cartId, user) {
    // Requiring JSON keeps cross-site form posts out: a cross-origin request
    // with this content type needs a CORS preflight, which this API refuses.
    if (!String(header(event, 'content-type') || '').startsWith('application/json')) {
      return json(415, { error: 'content-type must be application/json' });
    }
    if (!isCartId(cartId)) return json(400, { error: 'invalid cart id' });

    const ops = parseOps(readJsonBody(event));
    const before = cartFromRecords(await store.loadCartRecords(cartId));
    const after = applyOps(before, ops);
    const writes = planWrites(cartId, before, after);

    if (writes.length) {
      await store.applyWrites(writes);
      const source = header(event, 'x-shopping-client');
      try {
        await publisher.publishCartChanged(cartId, CLIENT_ID.test(source || '') ? source : null);
      } catch (err) {
        // The write stands; other pages still catch up when they next load
        // or reconnect.
        logger.error(`shopping-api: publish failed: ${err.message}`);
      }
    }
    logger.log(`shopping-api: ${user.email} applied ${ops.length} op(s) to ${cartId} (${writes.length} write(s))`);
    return json(200, { cart: cartToJson(after) });
  }

  return async function handle(event) {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath || '';

    const user = await authenticate(event);
    if (!user) return json(401, { error: 'unauthorized' });

    try {
      if (path === '/api/shopping') {
        return method === 'GET' ? await listCarts() : json(405, { error: 'method not allowed' });
      }
      const opsMatch = OPS_PATH.exec(path);
      if (opsMatch) {
        return method === 'POST'
          ? await applyCartOps(event, opsMatch[1], user)
          : json(405, { error: 'method not allowed' });
      }
      return json(404, { error: 'not found' });
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      logger.error(`shopping-api: ${method} ${path} failed: ${err.stack || err.message}`);
      return json(500, { error: 'internal error' });
    }
  };
}

module.exports = { createApp };
