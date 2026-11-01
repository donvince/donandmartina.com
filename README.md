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
- `/robots.txt`, which excludes `/shopping/` from crawlers
- `/login`, which redirects to the Cognito Hosted UI and returns to `?returnTo=` (a same-site path) or `/diary/` after sign-in
- `/callback`
- `/logout`
- `/whoami`
- `/token`, which returns the signed-in visitor's ID token to same-origin scripts (401 when signed out)
- static assets detected by `isAsset()`, including `/assets/...` and common asset file extensions such as `.css`, `.js`, `.png`, `.svg`, `.ico`, and fonts

Every other path is passed to `handleGuard(request)`, which means it must have a valid Cognito-backed session/JWT or the user is redirected to sign in.

To change whether a path is public or protected, update the routing/bypass logic in `infra/lambda/auth/index.js` and add or update the matching tests in `infra/lambda/auth/tests/index.test.js`.

## Sessions

Sign-in sets two HttpOnly cookies: `id_token` (one hour) and `refresh_token`
(one year, matching the Cognito app client's `RefreshTokenValidity`). When the ID
token lapses, the auth-edge Lambda exchanges the refresh token at the Cognito
token endpoint and re-sets `id_token`; pages redirect to themselves to pick it
up, and `/whoami` and `/token` refresh in place. `/logout` revokes the refresh
token and clears both cookies. The lifetimes live in `infra/cognito.yaml` and
`infra/lambda/auth/session.js`; keep them in step.

## Shopping list

`/shopping/` (signed-in only) is a static app backed by the
`donandmartina-shopping` stack (`infra/shopping.yaml`):

- **Data**: DynamoDB table `donandmartina-shopping`, one partition per cart. The
  only cart today is `home`.
- **API**: `infra/lambda/shopping-api`, a Lambda function URL that CloudFront serves
  at `/api/*` with Lambda origin access control. It verifies the `id_token`
  cookie itself. `GET /api/shopping` returns every cart. `POST
  /api/shopping/carts/{cartId}/ops` applies idempotent cart operations
  (`infra/lambda/shopping-api/cart.js`, mirrored by `static/shopping/model/cart.js`).
- **Change notifications**: after a write, the API publishes `cart-changed` to
  `/shopping/{cartId}` on an AppSync Events API. Open pages subscribe with the
  ID token from `/token` and reload the cart when another tab or device changed it.

The page keeps model and view apart. `static/shopping/model/` holds the data,
sync, offline queue and realtime code, with no DOM; `static/shopping/view/` renders
store state and calls store commands; `app.js` wires them together. Changes made
offline wait in a localStorage queue and are sent when the connection returns.

Tests:

```bash
node --test tests/shopping/
(cd infra/lambda/shopping-api && npm test)
```

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
next signup or authentication, including every token refresh. Visitors stay
signed in for up to a year through a refresh-token cookie, but the edge swaps
it for a new hour-long ID token each hour and Cognito runs the allow-list
trigger on each swap, so a removed address loses access within an hour.
