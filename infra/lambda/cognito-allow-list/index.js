'use strict';

const { GetParameterCommand, SSMClient } = require('@aws-sdk/client-ssm');
const { isAllowed, parseAllowedEmails } = require('./allowlist');

const ssm = new SSMClient();

async function handler(event) {
  const parameterName = process.env.ALLOWED_EMAILS_PARAMETER_NAME?.trim();
  if (!parameterName) {
    throw new Error('Allowed email parameter name is not configured');
  }

  const result = await ssm.send(new GetParameterCommand({
    Name: parameterName,
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
