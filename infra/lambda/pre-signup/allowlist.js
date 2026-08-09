'use strict';

function parseAllowedEmails(value) {
  const emails = typeof value === 'string'
    ? [...new Set(value.split(',').map(email => email.trim().toLowerCase()).filter(Boolean))]
    : [];

  if (emails.length === 0) {
    throw new Error('Allowed email parameter is empty');
  }

  return emails;
}

function isAllowed(email, allowedEmails) {
  if (!email || typeof email !== 'string') return false;
  const normalised = email.toLowerCase().trim();
  return allowedEmails.some(allowedEmail => (
    typeof allowedEmail === 'string' && allowedEmail.toLowerCase().trim() === normalised
  ));
}

module.exports = { isAllowed, parseAllowedEmails };
