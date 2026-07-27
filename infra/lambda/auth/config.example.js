'use strict';

// config.example.js
// This file documents the shape of config.js, which is generated at CI time
// by GitHub Actions from CloudFormation outputs and GitHub Secrets.
// config.js is gitignored and must never be committed.
module.exports = {
  cognitoRegion: 'us-east-1',
  userPoolId: 'us-east-1_XXXXXXXXX',
  appClientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX',
  appClientSecret: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  cognitoDomain: 'auth.poc.yourdomain.com',
  callbackUrl: 'https://poc.yourdomain.com/callback',
};
