#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPOSITORY_ROOT"

fail() {
  echo "AWS authentication guardrail failed: $*" >&2
  exit 1
}

if grep -R -n -E 'aws-access-key-id|aws-secret-access-key|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' \
  --include='*.yaml' --include='*.yml' .github; then
  fail "GitHub Actions contains static AWS credential plumbing"
fi

command -v ruby >/dev/null 2>&1 || fail "Ruby is required for structural template validation"
ruby infra/scripts/validate-aws-auth.rb

if [[ "${1:-}" != --offline ]]; then
  for template in infra/access-config.yaml infra/artifacts.yaml infra/cognito.yaml infra/template.yaml; do
    aws cloudformation validate-template \
      --template-body "file://${REPOSITORY_ROOT}/${template}" \
      --region us-east-1 >/dev/null
    echo "Validated $template"
  done
fi

echo "AWS authentication guardrails passed."
