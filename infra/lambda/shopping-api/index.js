'use strict';

const { createApp } = require('./app');
const { createAuthenticator } = require('./auth');
const { createPublisher } = require('./events');
const { createStore } = require('./store');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

const realtime = {
  httpDomain: requiredEnv('EVENTS_HTTP_DOMAIN'),
  realtimeDomain: requiredEnv('EVENTS_REALTIME_DOMAIN'),
  namespace: requiredEnv('EVENTS_NAMESPACE'),
};

exports.handler = createApp({
  authenticate: createAuthenticator({
    userPoolId: requiredEnv('USER_POOL_ID'),
    clientId: requiredEnv('USER_POOL_CLIENT_ID'),
  }),
  store: createStore({ tableName: requiredEnv('TABLE_NAME') }),
  publisher: createPublisher({ httpDomain: realtime.httpDomain, namespace: realtime.namespace }),
  realtime,
});
