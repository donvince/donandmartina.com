'use strict';

const { isAllowed } = require('./allowlist');
const { allowedEmails } = require('./config');

async function handler(event) {
  const email = event.request.userAttributes.email;
  if (!isAllowed(email, allowedEmails)) {
    throw new Error(`Email not permitted: ${email}`);
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}

module.exports = { handler };
