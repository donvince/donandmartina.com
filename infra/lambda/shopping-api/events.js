'use strict';

const { Sha256 } = require('@aws-crypto/sha256-js');
const { SignatureV4 } = require('@smithy/signature-v4');

// Publishes to an AppSync Events channel over HTTP, signed with the Lambda's
// own role (the namespace only accepts IAM-authorised publishes).
function createPublisher({
  httpDomain,
  namespace,
  region = process.env.AWS_REGION,
  credentials = () => Promise.resolve({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }),
  fetchImpl = globalThis.fetch,
}) {
  const signer = new SignatureV4({ service: 'appsync', region, credentials, sha256: Sha256 });

  async function publish(channel, events) {
    const body = JSON.stringify({ channel, events: events.map((event) => JSON.stringify(event)) });
    const signed = await signer.sign({
      method: 'POST',
      protocol: 'https:',
      hostname: httpDomain,
      path: '/event',
      headers: { 'content-type': 'application/json', host: httpDomain },
      body,
    });
    const response = await fetchImpl(`https://${httpDomain}/event`, {
      method: 'POST',
      headers: signed.headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`AppSync Events publish failed: ${response.status} ${await response.text()}`);
    }
  }

  // Tells open pages that a cart changed so they reload it. The event carries
  // no list contents: subscribers fetch them through the authorised API.
  function publishCartChanged(cartId, source) {
    return publish(`/${namespace}/${cartId}`, [{ type: 'cart-changed', cartId, source }]);
  }

  return { publishCartChanged };
}

module.exports = { createPublisher };
