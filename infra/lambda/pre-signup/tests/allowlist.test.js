const { isAllowed } = require('../allowlist');

const EMAILS = ['alice@gmail.com', 'Bob@gmail.com'];

describe('isAllowed', () => {
  it('permits an exact match', () => {
    expect(isAllowed('alice@gmail.com', EMAILS)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowed('ALICE@GMAIL.COM', EMAILS)).toBe(true);
    expect(isAllowed('bob@gmail.com', EMAILS)).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isAllowed('  alice@gmail.com  ', EMAILS)).toBe(true);
  });

  it('rejects an email not on the list', () => {
    expect(isAllowed('eve@gmail.com', EMAILS)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowed('', EMAILS)).toBe(false);
  });

  it('rejects null', () => {
    expect(isAllowed(null, EMAILS)).toBe(false);
  });
});
