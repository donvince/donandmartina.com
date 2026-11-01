'use strict';

// Pure cart model for the shopping API: validates client operations, applies
// them to an in-memory cart, and maps carts to and from DynamoDB records.
// The browser applies the same operations optimistically
// (static/shopping/model/cart.js); keep the two in step.

const CART_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ITEM_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_NAME_LENGTH = 120;
const MAX_ALIASES = 20;
const MAX_ITEMS = 1000;
const MAX_FAVOURITES = 1000;
const MAX_OPS = 100;

class ValidationError extends Error {}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function keyFor(value) {
  return cleanName(value).toLocaleLowerCase();
}

function isCartId(value) {
  return typeof value === 'string' && CART_ID.test(value);
}

function requireName(value, what) {
  const name = cleanName(value);
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`${what} must be 1-${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function requireId(value) {
  if (typeof value !== 'string' || !ITEM_ID.test(value)) {
    throw new ValidationError('item id must be 1-64 letters, digits or dashes');
  }
  return value;
}

function normaliseFavourite(value) {
  if (!value || typeof value !== 'object') throw new ValidationError('favourite must be an object');
  const name = requireName(value.name, 'favourite name');
  const rawAliases = value.aliases ?? [];
  if (!Array.isArray(rawAliases) || rawAliases.length > MAX_ALIASES) {
    throw new ValidationError(`aliases must be a list of at most ${MAX_ALIASES}`);
  }
  const aliases = new Map();
  for (const raw of rawAliases) {
    const alias = requireName(raw, 'alias');
    if (keyFor(alias) !== keyFor(name)) aliases.set(keyFor(alias), alias);
  }
  return { name, aliases: [...aliases.values()] };
}

// Turns an untrusted request body into a list of well-formed operations, or
// throws ValidationError.
function parseOps(body) {
  const ops = body?.ops;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) {
    throw new ValidationError(`ops must be a list of 1-${MAX_OPS} operations`);
  }
  return ops.map((op) => {
    switch (op?.type) {
      case 'addItem':
        return {
          type: 'addItem',
          id: requireId(op.id),
          name: requireName(op.name, 'item name'),
          createdAt: Number.isFinite(op.createdAt) ? op.createdAt : Date.now(),
        };
      case 'setChecked':
        return { type: 'setChecked', id: requireId(op.id), checked: op.checked === true };
      case 'removeItem':
        return { type: 'removeItem', id: requireId(op.id) };
      case 'putFavourite':
        return {
          type: 'putFavourite',
          favourite: normaliseFavourite(op.favourite),
          previousName: op.previousName == null ? null : requireName(op.previousName, 'previous name'),
        };
      case 'removeFavourite':
        return { type: 'removeFavourite', name: requireName(op.name, 'favourite name') };
      case 'replaceFavourites': {
        if (!Array.isArray(op.favourites) || op.favourites.length > MAX_FAVOURITES) {
          throw new ValidationError(`favourites must be a list of at most ${MAX_FAVOURITES}`);
        }
        return { type: 'replaceFavourites', favourites: op.favourites.map(normaliseFavourite) };
      }
      default:
        throw new ValidationError(`unknown operation type: ${op?.type}`);
    }
  });
}

function emptyCart() {
  return { items: new Map(), favourites: new Map(), favouritesInitialised: false };
}

function cloneCart(cart) {
  return {
    items: new Map([...cart.items].map(([id, item]) => [id, { ...item }])),
    favourites: new Map([...cart.favourites].map(([key, fav]) => [key, { ...fav, aliases: [...fav.aliases] }])),
    favouritesInitialised: cart.favouritesInitialised,
  };
}

// Applies operations in order. Every operation is idempotent, so a client
// may safely resend a batch whose response it never received:
//   addItem     ignored if the id exists, or an item with the same name does
//   setChecked  ignored if the item has since been removed
//   removeItem / removeFavourite  no-op when already gone
function applyOps(cart, ops) {
  const next = cloneCart(cart);
  for (const op of ops) {
    switch (op.type) {
      case 'addItem': {
        const duplicate = [...next.items.values()].some((item) => keyFor(item.name) === keyFor(op.name));
        if (next.items.has(op.id) || duplicate || next.items.size >= MAX_ITEMS) break;
        next.items.set(op.id, { id: op.id, name: op.name, checked: false, createdAt: op.createdAt });
        break;
      }
      case 'setChecked': {
        const item = next.items.get(op.id);
        if (item) item.checked = op.checked;
        break;
      }
      case 'removeItem':
        next.items.delete(op.id);
        break;
      case 'putFavourite': {
        if (op.previousName && keyFor(op.previousName) !== keyFor(op.favourite.name)) {
          next.favourites.delete(keyFor(op.previousName));
        }
        const key = keyFor(op.favourite.name);
        if (!next.favourites.has(key) && next.favourites.size >= MAX_FAVOURITES) break;
        next.favourites.set(key, op.favourite);
        break;
      }
      case 'removeFavourite':
        next.favourites.delete(keyFor(op.name));
        break;
      case 'replaceFavourites':
        next.favourites = new Map(op.favourites.map((fav) => [keyFor(fav.name), fav]));
        next.favouritesInitialised = true;
        break;
      default:
        break;
    }
  }
  return next;
}

// ── DynamoDB mapping ────────────────────────────────────────────────────────
// One partition per cart (cartId); sort keys item#<id>, favourite#<name key>
// and meta.

function itemKey(id) { return `item#${id}`; }
function favouriteKey(name) { return `favourite#${keyFor(name)}`; }
const META_KEY = 'meta';

function cartFromRecords(records) {
  const cart = emptyCart();
  for (const record of records) {
    if (record.kind === 'item') {
      cart.items.set(record.id, {
        id: record.id,
        name: record.name,
        checked: Boolean(record.checked),
        createdAt: Number(record.createdAt) || 0,
      });
    } else if (record.kind === 'favourite') {
      cart.favourites.set(keyFor(record.name), { name: record.name, aliases: record.aliases || [] });
    } else if (record.kind === 'meta') {
      cart.favouritesInitialised = Boolean(record.favouritesInitialised);
    }
  }
  return cart;
}

function recordsFromCart(cartId, cart) {
  const records = new Map();
  for (const item of cart.items.values()) {
    records.set(itemKey(item.id), { cartId, sk: itemKey(item.id), kind: 'item', ...item });
  }
  for (const favourite of cart.favourites.values()) {
    records.set(favouriteKey(favourite.name), {
      cartId, sk: favouriteKey(favourite.name), kind: 'favourite', ...favourite,
    });
  }
  if (cart.favouritesInitialised) {
    records.set(META_KEY, { cartId, sk: META_KEY, kind: 'meta', favouritesInitialised: true });
  }
  return records;
}

// The DynamoDB writes that turn `before` into `after`. New items are written
// only if still absent and changed items only if still present, so a
// concurrent removal by another request isn't undone by a stale write.
function planWrites(cartId, before, after, now = Date.now()) {
  const old = recordsFromCart(cartId, before);
  const next = recordsFromCart(cartId, after);
  const writes = [];
  for (const [sk, record] of next) {
    const previous = old.get(sk);
    if (previous && JSON.stringify(previous) === JSON.stringify(record)) continue;
    let condition = null;
    if (record.kind === 'item') condition = previous ? 'exists' : 'absent';
    writes.push({ type: 'put', record: { ...record, updatedAt: now }, condition });
  }
  for (const sk of old.keys()) {
    if (!next.has(sk)) writes.push({ type: 'delete', key: { cartId, sk } });
  }
  return writes;
}

function cartToJson(cart) {
  return {
    items: [...cart.items.values()].sort((a, b) => a.createdAt - b.createdAt),
    favourites: [...cart.favourites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    favouritesInitialised: cart.favouritesInitialised,
  };
}

module.exports = {
  MAX_OPS,
  ValidationError,
  applyOps,
  cartFromRecords,
  cartToJson,
  emptyCart,
  isCartId,
  parseOps,
  planWrites,
};
