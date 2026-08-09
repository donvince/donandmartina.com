# donandmartina.com

## Architecture notes

- [us-east-1 coupling and request flow](docs/us-east-1-coupling.md)

## AWS authentication

GitHub Actions obtains temporary credentials through OIDC as
`donandmartina-ci`; no AWS access-key secrets are required. Local commands keep
using `--profile don-donandmartina`, which is installed as a role profile that
assumes `donandmartina-operator` through the MFA-protected `don-cli` browser
session. Region-sensitive deployment commands continue specifying `--region`.

## Path authentication configuration

The decision for whether a request path needs authentication is made in `infra/lambda/auth/index.js`, inside the Lambda@Edge viewer-request handler.

That handler explicitly bypasses authentication for:

- `/` and `/index.html`, so the homepage is public
- `/login`, which redirects to the Cognito Hosted UI and returns to `/diary/` after sign-in
- `/callback`
- `/logout`
- `/whoami`
- static assets detected by `isAsset()`, including `/assets/...` and common asset file extensions such as `.css`, `.js`, `.png`, `.svg`, `.ico`, and fonts

Every other path is passed to `handleGuard(request)`, which means it must have a valid Cognito-backed session/JWT or the user is redirected to sign in.

To change whether a path is public or protected, update the routing/bypass logic in `infra/lambda/auth/index.js` and add or update the matching tests in `infra/lambda/auth/tests/index.test.js`.

## Authentication allow list

The private `ALLOWED_EMAILS` GitHub Actions secret is the source of truth for the
comma-separated list of addresses allowed to sign up and authenticate. Deployments
store its normalized value in the standard SSM `StringList` parameter
`/donandmartina/auth/allowed-emails` in `us-east-1`.

To change access:

1. Update the `ALLOWED_EMAILS` GitHub secret.
2. Manually run the **Update allowed emails** workflow.
3. Wait for the `donandmartina-access-config` CloudFormation update to complete.

Changing a GitHub secret does not trigger a workflow automatically. The dedicated
workflow updates only the access-configuration stack: it does not package Lambdas,
deploy Cognito or CloudFront, invalidate the CDN, or publish the site. The Cognito
trigger reads Parameter Store on every invocation, so the new list applies to the
next signup or authentication. Existing authenticated sessions remain valid until
their current token/cookie expires (currently at most one hour).
