'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAllowedEmails } = require('./normalize-allowed-emails');

test('normalizes and deduplicates the configured addresses', () => {
  assert.equal(
    normalizeAllowedEmails(' Alice@example.com,bob@example.com,ALICE@example.com '),
    'alice@example.com,bob@example.com',
  );
});

test('rejects an empty list', () => {
  assert.throws(() => normalizeAllowedEmails(' , '), /at least one/);
});

test('rejects malformed addresses', () => {
  for (const email of [
    'not-an-email',
    'a..b@example.com',
    'a@example..com',
    'a@example.com.',
    'a@-example.com',
  ]) {
    assert.throws(() => normalizeAllowedEmails(email), /malformed/);
  }
});
