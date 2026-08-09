'use strict';

const { parseAllowedEmails } = require('../lambda/cognito-allow-list/allowlist');

function normalizeAllowedEmails(value) {
  return parseAllowedEmails(value).join(',');
}

if (require.main === module) {
  process.stdout.write(normalizeAllowedEmails(process.env.ALLOWED_EMAILS));
}

module.exports = { normalizeAllowedEmails };
