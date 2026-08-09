'use strict';

function isValidEmail(email) {
  if (email.length > 254) return false;

  const parts = email.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

function normalizeAllowedEmails(value) {
  const emails = typeof value === 'string'
    ? [...new Set(value.split(',').map(email => email.trim().toLowerCase()).filter(Boolean))]
    : [];

  if (emails.length === 0) {
    throw new Error('ALLOWED_EMAILS must contain at least one email address');
  }

  const malformed = emails.filter(email => !isValidEmail(email));
  if (malformed.length > 0) {
    throw new Error(`ALLOWED_EMAILS contains ${malformed.length} malformed address(es)`);
  }

  return emails.join(',');
}

if (require.main === module) {
  process.stdout.write(normalizeAllowedEmails(process.env.ALLOWED_EMAILS));
}

module.exports = { normalizeAllowedEmails };
