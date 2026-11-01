const {
  ValidationError,
  applyOps,
  cartFromRecords,
  cartToJson,
  emptyCart,
  isCartId,
  parseOps,
  planWrites,
} = require('../cart');

function cartWith({ items = [], favourites = [], favouritesInitialised = false } = {}) {
  const cart = emptyCart();
  for (const item of items) cart.items.set(item.id, { checked: false, createdAt: 1, ...item });
  for (const fav of favourites) cart.favourites.set(fav.name.toLowerCase(), { aliases: [], ...fav });
  cart.favouritesInitialised = favouritesInitialised;
  return cart;
}

describe('parseOps', () => {
  it('normalises names and aliases', () => {
    const [op] = parseOps({
      ops: [{ type: 'putFavourite', favourite: { name: '  Oat   milk ', aliases: ['oatly', 'OAT MILK', 'Oatly'] } }],
    });
    expect(op).toEqual({
      type: 'putFavourite',
      favourite: { name: 'Oat milk', aliases: ['Oatly'] },
      previousName: null,
    });
  });

  it.each([
    [{}, 'ops must be a list'],
    [{ ops: [] }, 'ops must be a list'],
    [{ ops: Array(101).fill({ type: 'removeItem', id: 'a' }) }, 'ops must be a list'],
    [{ ops: [{ type: 'explode' }] }, 'unknown operation type'],
    [{ ops: [{ type: 'addItem', id: 'bad id!', name: 'milk' }] }, 'item id'],
    [{ ops: [{ type: 'addItem', id: 'a', name: '   ' }] }, 'item name'],
    [{ ops: [{ type: 'addItem', id: 'a', name: 'x'.repeat(121) }] }, 'item name'],
  ])('rejects %j', (body, message) => {
    expect(() => parseOps(body)).toThrow(ValidationError);
    expect(() => parseOps(body)).toThrow(message);
  });

  it('treats anything but true as unchecked', () => {
    expect(parseOps({ ops: [{ type: 'setChecked', id: 'a', checked: 'yes' }] })[0].checked).toBe(false);
  });
});

describe('isCartId', () => {
  it('accepts lowercase slugs such as home', () => {
    expect(isCartId('home')).toBe(true);
    expect(isCartId('hardware-store')).toBe(true);
  });

  it.each(['', 'Home', '-home', 'home-', 'a/b', 'x'.repeat(41)])('rejects %s', (id) => {
    expect(isCartId(id)).toBe(false);
  });
});

describe('applyOps', () => {
  it('adds, checks and removes items', () => {
    const cart = applyOps(emptyCart(), [
      { type: 'addItem', id: 'a', name: 'milk', createdAt: 10 },
      { type: 'addItem', id: 'b', name: 'eggs', createdAt: 11 },
      { type: 'setChecked', id: 'a', checked: true },
      { type: 'removeItem', id: 'b' },
    ]);
    expect([...cart.items.values()]).toEqual([{ id: 'a', name: 'milk', checked: true, createdAt: 10 }]);
  });

  it('does not change the cart it was given', () => {
    const before = cartWith({ items: [{ id: 'a', name: 'milk' }] });
    applyOps(before, [{ type: 'setChecked', id: 'a', checked: true }]);
    expect(before.items.get('a').checked).toBe(false);
  });

  it('ignores an item whose name is already on the list, whatever its case', () => {
    const cart = applyOps(cartWith({ items: [{ id: 'a', name: 'Milk' }] }), [
      { type: 'addItem', id: 'b', name: 'milk', createdAt: 2 },
    ]);
    expect([...cart.items.keys()]).toEqual(['a']);
  });

  it('is idempotent when a batch is replayed', () => {
    const ops = [
      { type: 'addItem', id: 'a', name: 'milk', createdAt: 10 },
      { type: 'setChecked', id: 'a', checked: true },
      { type: 'removeFavourite', name: 'tea' },
    ];
    const once = applyOps(cartWith({ favourites: [{ name: 'tea' }] }), ops);
    const twice = applyOps(once, ops);
    expect(cartToJson(twice)).toEqual(cartToJson(once));
  });

  it('ignores checking an item someone else removed', () => {
    const cart = applyOps(emptyCart(), [{ type: 'setChecked', id: 'gone', checked: true }]);
    expect(cart.items.size).toBe(0);
  });

  it('renames a favourite', () => {
    const cart = applyOps(cartWith({ favourites: [{ name: 'yogurt' }] }), [
      { type: 'putFavourite', favourite: { name: 'yoghurt', aliases: ['yogurt'] }, previousName: 'yogurt' },
    ]);
    expect(cartToJson(cart).favourites).toEqual([{ name: 'yoghurt', aliases: ['yogurt'] }]);
  });

  it('replaces favourites and marks them initialised', () => {
    const cart = applyOps(cartWith({ favourites: [{ name: 'tea' }] }), [
      { type: 'replaceFavourites', favourites: [{ name: 'coffee', aliases: [] }] },
    ]);
    expect(cartToJson(cart).favourites).toEqual([{ name: 'coffee', aliases: [] }]);
    expect(cart.favouritesInitialised).toBe(true);
  });
});

describe('DynamoDB mapping', () => {
  it('round-trips a cart through records', () => {
    const cart = cartWith({
      items: [{ id: 'a', name: 'milk', checked: true, createdAt: 5 }],
      favourites: [{ name: 'Milk', aliases: ['moo juice'] }],
      favouritesInitialised: true,
    });
    const records = [
      { cartId: 'home', sk: 'item#a', kind: 'item', id: 'a', name: 'milk', checked: true, createdAt: 5, updatedAt: 1 },
      { cartId: 'home', sk: 'favourite#milk', kind: 'favourite', name: 'Milk', aliases: ['moo juice'], updatedAt: 1 },
      { cartId: 'home', sk: 'meta', kind: 'meta', favouritesInitialised: true, updatedAt: 1 },
    ];
    expect(cartToJson(cartFromRecords(records))).toEqual(cartToJson(cart));
  });

  it('plans only the writes needed, with conditions on items', () => {
    const before = cartWith({
      items: [{ id: 'a', name: 'milk' }, { id: 'b', name: 'eggs' }, { id: 'c', name: 'tea' }],
      favourites: [{ name: 'tea' }],
    });
    const after = applyOps(before, [
      { type: 'setChecked', id: 'a', checked: true },
      { type: 'removeItem', id: 'b' },
      { type: 'addItem', id: 'd', name: 'bread', createdAt: 9 },
    ]);

    const writes = planWrites('home', before, after, 1234);

    expect(writes).toEqual([
      {
        type: 'put',
        condition: 'exists',
        record: { cartId: 'home', sk: 'item#a', kind: 'item', id: 'a', name: 'milk', checked: true, createdAt: 1, updatedAt: 1234 },
      },
      {
        type: 'put',
        condition: 'absent',
        record: { cartId: 'home', sk: 'item#d', kind: 'item', id: 'd', name: 'bread', checked: false, createdAt: 9, updatedAt: 1234 },
      },
      { type: 'delete', key: { cartId: 'home', sk: 'item#b' } },
    ]);
  });

  it('plans nothing for a replayed batch', () => {
    const before = cartWith({ items: [{ id: 'a', name: 'milk', checked: true }] });
    const after = applyOps(before, [{ type: 'setChecked', id: 'a', checked: true }]);
    expect(planWrites('home', before, after)).toEqual([]);
  });
});
