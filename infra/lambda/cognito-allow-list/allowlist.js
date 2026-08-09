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

function parseAllowedEmails(value) {
  const emails = typeof value === 'string'
    ? [...new Set(value.split(',').map(email => email.trim().toLowerCase()).filter(Boolean))]
    : [];

  if (emails.length === 0) {
    throw new Error('Allowed email parameter is empty');
  }

  const malformed = emails.filter(email => !isValidEmail(email));
  if (malformed.length > 0) {
    throw new Error(`Allowed email parameter contains ${malformed.length} malformed address(es)`);
  }

  return emails;
}

function isAllowed(email, allowedEmails) {
  if (!email || typeof email !== 'string') return false;
  const normalised = email.toLowerCase().trim();
  return allowedEmails.includes(normalised);
}

module.exports = { isAllowed, parseAllowedEmails };
