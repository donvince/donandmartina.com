const { isAllowed, parseAllowedEmails } = require('../allowlist');

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

describe('parseAllowedEmails', () => {
  it('splits, trims, lowercases, and deduplicates a StringList value', () => {
    expect(parseAllowedEmails(' Alice@gmail.com, bob@gmail.com,ALICE@GMAIL.COM '))
      .toEqual(['alice@gmail.com', 'bob@gmail.com']);
  });

  it.each([undefined, null, '', ' , '])('rejects an empty parameter value (%p)', value => {
    expect(() => parseAllowedEmails(value)).toThrow('empty');
  });
});
