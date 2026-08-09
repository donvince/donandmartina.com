---
name: donandmartina-allowlist
description: Add or remove an email on the donandmartina.com Cognito sign-in allow-list. Use when the user wants to grant or revoke access to donandmartina.com, mentions "add someone to the allow-list", "let X sign in", "who can log into donandmartina", or "remove X's access".
---

# donandmartina.com sign-in allow-list

The allow-list gates who can sign in to donandmartina.com. It is enforced by a Cognito
pre-signup Lambda: on first sign-in, `infra/lambda/pre-signup/allowlist.js` compares the
Google-supplied email (lowercased, trimmed) against `allowedEmails`, and throws if absent.

## The critical thing to understand

**The list is baked into the Lambda zip at deploy time.** It is *not* runtime config.
Editing 1Password, or the GitHub secret, changes nothing on its own — the running Lambda keeps
the list that was compiled into its zip. Every change needs a redeploy.

Three places hold the value, and they drift independently:

| Location | Role |
|---|---|
| 1Password `donandmartina.com - ALLOWED_EMAILS` (Private vault, field `emails`) | Source of truth for humans |
| GitHub secret `ALLOWED_EMAILS` | What CI uses |
| `infra/lambda/pre-signup/config.js` (gitignored) | Generated at deploy; what actually runs |

Update all three or they diverge. The usual failure is updating 1Password only, then being
confused that sign-in still fails.

## Procedure

Work in `/Users/donvince/repos/donandmartina.com`.

### 1. Read the current list

```bash
op item get 'donandmartina.com - ALLOWED_EMAILS' --fields emails | tr -d '"'
```

`op` wraps any value containing a comma in quotes, so always pipe through `tr -d '"'` when the
value is used programmatically. Without it the first and last addresses keep a literal `"`,
never match the allow-list check, and those people are silently locked out.

Show it to the user and confirm the exact change before writing anything. Adding is additive —
do not drop existing addresses. Removing revokes someone's access; confirm the address first.

### 2. Update 1Password

```bash
op item edit 'donandmartina.com - ALLOWED_EMAILS' \
  'emails[text]=a@example.com,b@example.com,c@example.com'
```

### 3. Update the GitHub secret

```bash
gh secret set ALLOWED_EMAILS --repo donvince/donandmartina.com --body 'a@example.com,b@example.com'
```

### 4. Redeploy

Preferred — let CI do it, so all three stay in step:

```bash
gh workflow run "Deploy site" --repo donvince/donandmartina.com
```

Check `githubstatus.com` first if runs fail without executing any step (`steps=0`, `The job was
not acquired by Runner`) — that is a GitHub outage, not a repo problem.

If CI is unavailable, deploy locally. `AWS_PROFILE=don-donandmartina` is the same IAM user CI
uses:

```bash
export AWS_PROFILE=don-donandmartina
export ARTIFACTS_BUCKET=donandmartina-lambda-artifacts-us-east-1-015311074066

# regenerate config from the list you just stored (tr strips op's quoting)
EMAILS=$(op item get 'donandmartina.com - ALLOWED_EMAILS' --fields emails | tr -d '"')
node -e "const e=process.argv[1].split(',').map(s=>s.trim()).filter(Boolean);\
console.log(\"'use strict';\nmodule.exports = { allowedEmails: \"+JSON.stringify(e)+\" };\")" \
  "$EMAILS" > infra/lambda/pre-signup/config.js

(cd infra/lambda/pre-signup && npm ci --omit=dev && \
   rm -f ../../../pre-signup.zip && \
   zip -r ../../../pre-signup.zip . -x '*.test.js' 'tests/*' 'config.example.js')

aws s3 cp pre-signup.zip "s3://$ARTIFACTS_BUCKET/pre-signup.zip" --region us-east-1
VERSION=$(aws s3api head-object --bucket "$ARTIFACTS_BUCKET" --key pre-signup.zip \
  --region us-east-1 --query VersionId --output text)

aws cloudformation deploy \
  --template-file infra/cognito.yaml --stack-name donandmartina-cognito \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset --region us-east-1 \
  --parameter-overrides \
    GoogleClientId="$(op item get 'donandmartina.com - Google OAuth' --fields username)" \
    GoogleClientSecret="$(op item get 'donandmartina.com - Google OAuth' --fields credential --reveal)" \
    PreSignupLambdaS3Bucket="$ARTIFACTS_BUCKET" \
    PreSignupLambdaS3ObjectVersion="$VERSION"
```

`$VERSION` must be a real id, never `null`. `infra/cognito.yaml` keys the Lambda off the S3
object version, so a null means CloudFormation cannot see the new code and the deploy silently
no-ops on a fixed key name.

Only the cognito stack needs redeploying. The site/CloudFront stack is untouched by an
allow-list change.

### 5. Verify

```bash
curl -sS -o /dev/null -D - https://donandmartina.com/ | grep -i '^location'
```

Expect a 302 to `auth-donandmartina.auth.us-east-1.amazoncognito.com`. Full confirmation needs
a real browser sign-in with the added address.

## Removing someone who has already signed in

Dropping an address stops *new* sign-ups but does not revoke an existing session or delete the
Cognito user — the pre-signup hook only fires on first sign-in. To actually lock someone out,
also delete their user from the pool:

```bash
aws cognito-idp admin-delete-user --region us-east-1 \
  --user-pool-id "$(aws cloudformation describe-stacks --stack-name donandmartina-cognito \
     --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
     --output text)" \
  --username 'them@example.com'
```

Their existing `id_token` cookie stays valid until it expires (1 hour, set in
`infra/lambda/auth/callback.js`). Say so rather than implying removal is instant.

## Gotchas

- Comparison is case-insensitive and trimmed, so `A@B.com ` matches `a@b.com`. Duplicates
  differing only in case are harmless but noise — dedupe.
- Google accounts only. The pool has Google as its sole IdP, so a non-Google address can never
  sign in however the list reads.
- `infra/lambda/pre-signup/config.js` is gitignored. Never commit it; it is generated.
- The account's `donandmartina-gha` IAM user sits under a permissions boundary. If a deploy
  fails with "no permissions boundary allows...", the fix belongs in
  `~/repos/don-personal-iam`, not in an inline policy — a boundary caps effective permissions
  rather than granting them, so both it and the user's own policy must allow an action.
