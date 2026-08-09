---
name: deploy-manually
description: Deploy donandmartina.com from this machine, mirroring the GitHub Actions workflow. Use when GitHub Actions is down or unavailable, when a deploy needs to bypass CI, or when the user says "deploy manually", "deploy locally", "GHA is broken", or "push the site out myself".
---

# Deploy donandmartina.com by hand

Mirrors `.github/workflows/deploy.yml` job for job. Reach for this when CI cannot run — not as
the routine path, since a manual deploy leaves no CI record and can drift from what `main`
would produce.

## First: is GitHub actually the problem?

```bash
gh run list --limit 5
curl -s https://www.githubstatus.com/api/v2/summary.json \
  | jq '{status: .status.description,
         actions: [.components[] | select(.name=="Actions") | .status],
         incidents: [.incidents[] | {name, status, created_at}]}'
```

A GitHub-side outage looks like jobs that never execute: `steps=0`, ~15 min idle, then
cancelled, with `The job was not acquired by Runner of type hosted` or `Internal server error.
Correlation ID: ...`. Confirm with:

```bash
gh api /repos/donvince/donandmartina.com/actions/runs/<RUN_ID>/jobs \
  --jq '.jobs[] | "\(.name): \(.conclusion) steps=\(.steps|length)"'
```

If steps *did* run and fail, this is a real build failure — read the logs
(`gh run view <RUN_ID> --log-failed`) and fix that instead. This repo is public, so free-tier
minutes are never the cause.

## Setup

```bash
cd /Users/donvince/repos/donandmartina.com
export AWS_PROFILE=don-donandmartina      # same IAM user CI uses
export ARTIFACTS_BUCKET=donandmartina-lambda-artifacts-us-east-1-015311074066
```

Do **not** use the `[default]` AWS profile — it is Skyscanner SSO and will prompt for a work
login. Verify: `aws sts get-caller-identity` should show `user/donandmartina-gha`.

Secrets cannot be read back out of GitHub, so pull them from 1Password:

```bash
export GOOGLE_CLIENT_ID="$(op item get 'donandmartina.com - Google OAuth' --fields username)"
export GOOGLE_CLIENT_SECRET="$(op item get 'donandmartina.com - Google OAuth' --fields credential --reveal)"
# tr strips the quotes op wraps around any value containing a comma. Without it
# the first and last addresses keep a literal " and never match, silently
# locking those people out.
export ALLOWED_EMAILS="$(op item get 'donandmartina.com - ALLOWED_EMAILS' --fields emails | tr -d '"')"
```

`CognitoDomainPrefix` is omitted deliberately — `infra/cognito.yaml` defaults it to
`auth-donandmartina`, which is what the Google OAuth redirect URI is registered against.
Passing a different value breaks sign-in.

## Which jobs do you actually need?

Skip what has not changed; each stage is independent.

| Changed | Run |
|---|---|
| Site content, layouts, static files | job 3 only |
| `infra/lambda/auth/**`, `infra/template.yaml` | jobs 2, 3 |
| `infra/lambda/pre-signup/**`, `infra/cognito.yaml`, allow-list | jobs 1, 2, 3 |

Job 1's outputs feed job 2's config, so running 1 means running 2.

## Job 1 — cognito

```bash
node -e "const e=process.env.ALLOWED_EMAILS.split(',').map(s=>s.trim()).filter(Boolean);\
console.log(\"'use strict';\nmodule.exports = { allowedEmails: \"+JSON.stringify(e)+\" };\")" \
  > infra/lambda/pre-signup/config.js

(cd infra/lambda/pre-signup && npm ci --omit=dev && \
   rm -f ../../../pre-signup.zip && \
   zip -r ../../../pre-signup.zip . -x '*.test.js' 'tests/*' 'config.example.js')

aws s3 cp pre-signup.zip "s3://$ARTIFACTS_BUCKET/pre-signup.zip" --region us-east-1
PRESIGNUP_VERSION=$(aws s3api head-object --bucket "$ARTIFACTS_BUCKET" \
  --key pre-signup.zip --region us-east-1 --query VersionId --output text)

aws cloudformation deploy \
  --template-file infra/cognito.yaml --stack-name donandmartina-cognito \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset --region us-east-1 \
  --parameter-overrides \
    GoogleClientId="$GOOGLE_CLIENT_ID" \
    GoogleClientSecret="$GOOGLE_CLIENT_SECRET" \
    PreSignupLambdaS3Bucket="$ARTIFACTS_BUCKET" \
    PreSignupLambdaS3ObjectVersion="$PRESIGNUP_VERSION"
```

Then capture the outputs job 2 needs:

```bash
OUT=$(aws cloudformation describe-stacks --stack-name donandmartina-cognito \
  --region us-east-1 --query "Stacks[0].Outputs")
export USER_POOL_ID=$(jq -r '.[]|select(.OutputKey=="UserPoolId").OutputValue' <<<"$OUT")
export APP_CLIENT_ID=$(jq -r '.[]|select(.OutputKey=="UserPoolClientId").OutputValue' <<<"$OUT")
export APP_CLIENT_SECRET=$(jq -r '.[]|select(.OutputKey=="UserPoolClientSecret").OutputValue' <<<"$OUT")
export COGNITO_DOMAIN=$(jq -r '.[]|select(.OutputKey=="CognitoDomain").OutputValue' <<<"$OUT")
```

## Job 2 — auth-edge Lambda@Edge + site stack

```bash
cat > infra/lambda/auth/config.js <<EOF
'use strict';
module.exports = {
  cognitoRegion: 'us-east-1',
  userPoolId: '${USER_POOL_ID}',
  appClientId: '${APP_CLIENT_ID}',
  appClientSecret: '${APP_CLIENT_SECRET}',
  cognitoDomain: '${COGNITO_DOMAIN}',
  callbackUrl: 'https://donandmartina.com/callback',
};
EOF

(cd infra/lambda/auth && npm ci --omit=dev && \
   rm -f ../../../auth-edge.zip && \
   zip -r ../../../auth-edge.zip . -x '*.test.js' 'tests/*' 'config.example.js')

aws s3 cp auth-edge.zip "s3://$ARTIFACTS_BUCKET/auth-edge.zip" --region us-east-1
AUTH_VERSION=$(aws s3api head-object --bucket "$ARTIFACTS_BUCKET" \
  --key auth-edge.zip --region us-east-1 --query VersionId --output text)

aws cloudformation deploy \
  --template-file infra/template.yaml --stack-name donandmartina-site \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset --region us-east-1 \
  --parameter-overrides \
    AuthEdgeLambdaS3Bucket="$ARTIFACTS_BUCKET" \
    AuthEdgeLambdaS3ObjectVersion="$AUTH_VERSION"

export DIST_ID=$(aws cloudformation describe-stacks --stack-name donandmartina-site \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text)
```

Run `npm test` in `infra/lambda/auth` before bundling if the Lambda changed. **Run the tests in
a subagent** — Jest output is long, and only the pass/fail summary matters here.

This deploy is slow (Lambda@Edge replication) and can exceed a 10-minute command timeout while
still succeeding server-side. If the command is killed, do not redeploy — poll instead:

```bash
aws cloudformation describe-stacks --stack-name donandmartina-site \
  --region us-east-1 --query 'Stacks[0].StackStatus' --output text
```

## Job 3 — build and publish

```bash
hugo --minify --baseURL "https://donandmartina.com/"

# ALWAYS dry-run first: --delete removes anything absent from public/
aws s3 sync public/ s3://donandmartina.com --delete \
  --cache-control "public,max-age=3600" --dryrun

aws s3 sync public/ s3://donandmartina.com --delete --cache-control "public,max-age=3600"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

Review the dry-run's `delete:` lines before proceeding — an unexpected batch of deletions means
Hugo under-built (wrong working directory, failed build, empty `public/`). Zero deletions is
the normal case for a content update.

Note the region flip: the site bucket is `eu-west-1`; everything else here is `us-east-1`. Only
the artifacts bucket had to be `us-east-1`, because Lambda fetches its zip using the function's
own region and a cross-region fetch fails with `TemporaryRedirect`.

## Verify

```bash
curl -sS -o /dev/null -D - https://donandmartina.com/ | grep -iE '^HTTP|^location'
for p in / /diary/ /callback; do printf '%s -> ' "$p"
  curl -sS -o /dev/null -w '%{http_code}\n' "https://donandmartina.com$p"; done
```

Expect 302 everywhere: `/` and `/diary/` to the Cognito hosted UI, `/callback` back to sign-in.
A **503** means the edge Lambda threw — see below. Full confirmation needs a browser sign-in
with an allow-listed Google account.

## Traps

**A successful deploy that changes nothing at the edge.** `AWS::Lambda::Version` only publishes
a new version when one of its properties changes, so `infra/template.yaml` derives its
`Description` from the S3 object version. If that is ever removed, `$LATEST` updates while
CloudFront stays pinned to the old published version — the deploy reports success and the edge
keeps running the previous code. Check what is actually serving:

```bash
aws cloudfront get-distribution-config --id "$DIST_ID" \
  --query 'DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations.Items[0].LambdaFunctionARN' \
  --output text
```

**Reading edge Lambda logs.** They are written in the *edge* region, not `us-east-1`, under
`/aws/lambda/us-east-1.donandmartina-auth-edge`. For London traffic that is `eu-west-2`. The
`donandmartina-gha` user cannot read logs; use `AWS_PROFILE=don-root` for diagnostics only.

**`DELETE_FAILED` on an old Lambda version during cleanup.** Expected and benign — AWS refuses
to delete a replicated Lambda@Edge version until its replicas drain. The stack still reaches
`UPDATE_COMPLETE`; no action needed.

**A null S3 version id.** Both templates key their Lambda off the object version. A `null` means
bucket versioning is off, and CloudFormation cannot detect new code on a fixed key — it will
silently no-op. Never proceed with a null.

**`ROLLBACK_COMPLETE`.** A stack in this state cannot be updated and must be deleted before
retrying. Check `describe-stack-resources` first to confirm nothing live would be lost — after a
failed create everything is usually already `DELETE_COMPLETE`.

**Permission errors.** IAM for this account is managed in `~/repos/don-personal-iam`, not by
hand: `bootstrap.yaml` holds the shared `ServiceUserBoundary` (deployed with `don-root`) and
`stacks/donandmartina.yaml` the per-project user (deployed with `don-infra`, normally via its
own GHA). A boundary **caps** effective permissions rather than granting them, so an action must
appear in both the boundary and the user's own policy — "no permissions boundary allows..."
means the boundary, plain `AccessDenied` usually means the inline policy.

## Afterwards

Once Actions recovers, run CI so the deploy is reproducible from `main`:

```bash
gh workflow run "Deploy site" --repo donvince/donandmartina.com
```

Stacks are idempotent, so this will not conflict with the manual run. Generated
`infra/lambda/**/config.js` and the root-level zips are gitignored — never commit them; the
auth `config.js` contains the app client secret.
