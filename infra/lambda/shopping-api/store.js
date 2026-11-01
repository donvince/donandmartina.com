'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 5;

function createStore({ tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({})) }) {
  async function readAll(makeCommand) {
    const records = [];
    let ExclusiveStartKey;
    do {
      const page = await client.send(makeCommand(ExclusiveStartKey));
      records.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return records;
  }

  // Every record in the table, grouped by cart. The table only ever holds a
  // household's shopping, so the page loads the whole thing in one go.
  async function loadAllCarts() {
    const records = await readAll((ExclusiveStartKey) =>
      new ScanCommand({ TableName: tableName, ExclusiveStartKey }));
    const carts = new Map();
    for (const record of records) {
      if (!carts.has(record.cartId)) carts.set(record.cartId, []);
      carts.get(record.cartId).push(record);
    }
    return carts;
  }

  function loadCartRecords(cartId) {
    return readAll((ExclusiveStartKey) => new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'cartId = :cartId',
      ExpressionAttributeValues: { ':cartId': cartId },
      ConsistentRead: true,
      ExclusiveStartKey,
    }));
  }

  async function writeConditional(write) {
    const expression = write.condition === 'absent' ? 'attribute_not_exists(sk)' : 'attribute_exists(sk)';
    try {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: write.record,
        ConditionExpression: expression,
      }));
    } catch (err) {
      // Another request added or removed the item first; theirs stands.
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }

  async function writeBatch(requests) {
    let pending = requests;
    for (let attempt = 1; pending.length; attempt += 1) {
      if (attempt > MAX_BATCH_ATTEMPTS) throw new Error('DynamoDB left batch writes unprocessed');
      const result = await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
      pending = result.UnprocessedItems?.[tableName] || [];
      if (pending.length) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }

  // Applies writes from cart.planWrites. Each touches a distinct key, so
  // unconditional ones can go in batches.
  async function applyWrites(writes) {
    const batched = [];
    for (const write of writes) {
      if (write.type === 'put' && write.condition) {
        await writeConditional(write);
      } else if (write.type === 'put') {
        batched.push({ PutRequest: { Item: write.record } });
      } else {
        batched.push({ DeleteRequest: { Key: write.key } });
      }
    }
    for (let start = 0; start < batched.length; start += BATCH_SIZE) {
      await writeBatch(batched.slice(start, start + BATCH_SIZE));
    }
  }

  return { applyWrites, loadAllCarts, loadCartRecords };
}

module.exports = { createStore };
