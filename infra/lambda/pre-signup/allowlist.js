'use strict';

function isAllowed(email, allowedEmails) {
  if (!email || typeof email !== 'string') return false;
  const normalised = email.toLowerCase().trim();
  return allowedEmails
    .map(e => e.toLowerCase().trim())
    .includes(normalised);
}

module.exports = { isAllowed };
