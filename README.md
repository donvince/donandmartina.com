# donandmartina.com

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
