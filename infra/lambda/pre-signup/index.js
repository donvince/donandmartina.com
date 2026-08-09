'use strict';

const { GetParameterCommand, SSMClient } = require('@aws-sdk/client-ssm');
const { isAllowed, parseAllowedEmails } = require('./allowlist');

const ALLOWED_EMAILS_PARAMETER = '/donandmartina/auth/allowed-emails';
const ssm = new SSMClient();

async function handler(event) {
  const result = await ssm.send(new GetParameterCommand({
    Name: ALLOWED_EMAILS_PARAMETER,
  }));
  const allowedEmails = parseAllowedEmails(result.Parameter?.Value);
  const email = event.request?.userAttributes?.email;

  if (!isAllowed(email, allowedEmails)) {
    throw new Error(`Email not permitted: ${email}`);
  }

  if (event.triggerSource?.startsWith('PreSignUp_')) {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  return event;
}

module.exports = { handler };
