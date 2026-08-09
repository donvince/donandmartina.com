---
name: expand-iam-permissions
description: >
  Add AWS permissions to the donandmartina-gha IAM user when a deploy or
  operation fails with AccessDenied or "not authorized". Use when hitting a
  permissions wall, when asked to "add permission", "expand IAM", "grant
  access to X", or "update the IAM policy".
---

# Expand IAM permissions for donandmartina-gha

This account's IAM uses a two-layer model. Both layers must allow an action
before it is permitted:

1. **`ServiceUserBoundary`** (`bootstrap.yaml`) — the hard ceiling. Permits:
   Route53, CloudFormation, S3, ACM, CloudFront, Lambda, Cognito, and scoped
   IAM role management. Nothing outside this list can ever be granted, even
   with a matching inline policy. Changing this requires `don-root`.

2. **Inline policy** (`stacks/donandmartina.yaml`) — the per-project grant
   inside the boundary. This is the usual target when adding permissions.

**Error diagnosis:**
- `"no permissions boundary allows..."` → action is missing from `bootstrap.yaml`.
  That file requires `don-root` credentials; discuss with the user before
  proceeding.
- Plain `AccessDenied` → action is missing from `stacks/donandmartina.yaml`.
  Add a statement there; `infra-deployer` (GHA on `don-personal-iam`) deploys it.

## Step 1 — Identify what to add

Read the error carefully. CloudFormation/CLI errors name the exact action and
resource:

```
User: arn:aws:iam::015311074066:user/donandmartina-gha is not authorized to
perform: logs:DescribeLogGroups on resource: arn:aws:logs:us-east-1:015311074066:*
```

That tells you: action = `logs:DescribeLogGroups`, service = `logs` (CloudWatch Logs).

Check the boundary first:

```bash
grep -A5 'logs:\|cloudwatch:' /Users/donvince/repos/don-personal-iam/bootstrap.yaml
```

If the service is missing from the boundary entirely, this session cannot
proceed — the boundary must be updated with `don-root`. Surface that to the
user with the exact service and action needed.

## Step 2 — Edit `stacks/donandmartina.yaml`

File: `/Users/donvince/repos/don-personal-iam/stacks/donandmartina.yaml`

Add a new `Sid` statement, or extend an existing one if the service is already
represented. Follow the existing style:

```yaml
- Sid: CloudWatchLogs        # CamelCase, no spaces
  Effect: Allow
  Action: logs:*             # or a tighter list if the service is scoped
  Resource: "*"              # or scoped ARN if possible
```

**Scoping guidance:**
- Use `Resource: "*"` only when AWS does not support resource-level restrictions
  for the action (common for CloudFront, ACM, Cognito read-only, most `List*`
  and `Describe*` calls).
- Prefer ARN scope when the resource is known:
  `arn:aws:logs:*:${AWS::AccountId}:log-group:/aws/lambda/donandmartina-*`
- Always use `!Sub` for `${AWS::AccountId}` substitutions.

**Inline policy size limit:** The user has a 2048-character inline policy limit
per policy document. If adding a new statement would push it over, consolidate
similar statements (e.g. merge two `Resource: "*"` statements for different
services into one). Check current size:

```bash
wc -c /Users/donvince/repos/don-personal-iam/stacks/donandmartina.yaml
```

## Step 3 — Deploy via `don-personal-iam` GHA

The `infra-deployer` GHA user deploys changes to `stacks/*.yaml` automatically
on push to `main`. Push directly to `main` (this repo has no branch protection).

```bash
git -C /Users/donvince/repos/don-personal-iam add stacks/donandmartina.yaml
git -C /Users/donvince/repos/don-personal-iam commit -m "Grant <action> to donandmartina-gha"
git -C /Users/donvince/repos/don-personal-iam push origin main
```

Then watch the GHA run:

```bash
gh run watch --repo donvince/don-personal-iam
```

The workflow is `deploy-iam.yml`; it runs `aws cloudformation deploy
--capabilities CAPABILITY_NAMED_IAM` for every `stacks/*.yaml`.

## Step 4 — Verify

Once GHA reports success, retry the original failing operation. The IAM change
is effective within seconds of the stack update completing.

If the retry produces a *different* `AccessDenied`, repeat from Step 1 — it is
common for a multi-step operation to reveal missing permissions one at a time.

## Traps

**`ROLLBACK_COMPLETE` on the IAM stack.** The stack name is `iam-donandmartina`.
A rollback means CloudFormation rejected the template (syntax error, duplicate
Sid, inline policy size exceeded). Delete the stack in this state before
retrying — but verify the user still exists first:

```bash
aws cloudformation describe-stack-resources \
  --stack-name iam-donandmartina --region us-east-1 2>&1 | grep UserName
```

**Action in the boundary but still denied.** Both layers must allow — a service
listed in the boundary still requires a statement in the inline policy. Check
both with:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::015311074066:user/donandmartina-gha \
  --action-names <action> \
  --resource-arns <resource> \
  --profile don-root
```

(Requires `don-root` profile; ask the user to run this if needed.)

**Boundary missing the service entirely.** Services the boundary currently
permits (from `bootstrap.yaml`): `route53`, `s3`, `cloudformation`, `acm`,
`cloudfront`, `lambda`, `cognito-idp`, `iam` (scoped). CloudWatch Logs, SSM,
SNS, SQS, etc. are absent. Adding them to the boundary requires `don-root` to
run `aws cloudformation deploy` on `bootstrap.yaml`. Surface this clearly and
draft the YAML change for the user to review, but do not push `bootstrap.yaml`
changes — that file must be deployed manually with elevated credentials.
