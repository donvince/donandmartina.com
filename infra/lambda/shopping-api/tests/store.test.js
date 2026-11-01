const { createStore } = require('../store');

function fakeClient(handler) {
  return { send: jest.fn(async (command) => handler(command.constructor.name, command.input)) };
}

describe('createStore', () => {
  it('scans every page and groups records by cart', async () => {
    const pages = [
      { Items: [{ cartId: 'home', sk: 'item#a' }], LastEvaluatedKey: { cartId: 'home', sk: 'item#a' } },
      { Items: [{ cartId: 'garage', sk: 'item#b' }, { cartId: 'home', sk: 'meta' }] },
    ];
    const client = fakeClient(() => pages.shift());
    const store = createStore({ tableName: 't', client });

    const carts = await store.loadAllCarts();

    expect([...carts.keys()]).toEqual(['home', 'garage']);
    expect(carts.get('home')).toHaveLength(2);
    expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ cartId: 'home', sk: 'item#a' });
  });

  it('queries one cart with a consistent read', async () => {
    const client = fakeClient(() => ({ Items: [] }));
    await createStore({ tableName: 't', client }).loadCartRecords('home');
    expect(client.send.mock.calls[0][0].input).toMatchObject({
      TableName: 't',
      ExpressionAttributeValues: { ':cartId': 'home' },
      ConsistentRead: true,
    });
  });

  it('writes conditional puts singly and batches the rest', async () => {
    const calls = [];
    const client = fakeClient((name, input) => {
      calls.push([name, input]);
      if (name === 'PutCommand') {
        const err = new Error('lost race');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });
    const store = createStore({ tableName: 't', client });

    await store.applyWrites([
      { type: 'put', condition: 'absent', record: { cartId: 'home', sk: 'item#a' } },
      ...Array.from({ length: 30 }, (_, i) => ({ type: 'put', condition: null, record: { cartId: 'home', sk: `favourite#${i}` } })),
      { type: 'delete', key: { cartId: 'home', sk: 'item#b' } },
    ]);

    expect(calls.map(([name]) => name)).toEqual(['PutCommand', 'BatchWriteCommand', 'BatchWriteCommand']);
    expect(calls[0][1].ConditionExpression).toBe('attribute_not_exists(sk)');
    expect(calls[1][1].RequestItems.t).toHaveLength(25);
    expect(calls[2][1].RequestItems.t).toHaveLength(6);
  });

  it('retries unprocessed batch items', async () => {
    let first = true;
    const client = fakeClient((name, input) => {
      if (first) {
        first = false;
        return { UnprocessedItems: { t: input.RequestItems.t.slice(1) } };
      }
      return {};
    });
    const store = createStore({ tableName: 't', client });

    await store.applyWrites([
      { type: 'delete', key: { cartId: 'home', sk: 'item#a' } },
      { type: 'delete', key: { cartId: 'home', sk: 'item#b' } },
    ]);

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls[1][0].input.RequestItems.t).toHaveLength(1);
  });

  it('surfaces errors other than a lost race', async () => {
    const client = fakeClient(() => { throw new Error('throttled'); });
    const store = createStore({ tableName: 't', client });
    await expect(store.applyWrites([
      { type: 'put', condition: 'exists', record: { cartId: 'home', sk: 'item#a' } },
    ])).rejects.toThrow('throttled');
  });
});
