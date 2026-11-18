#!/usr/bin/env bash
# Build the outfit agent Lambda image (arm64, torch + FashionCLIP baked in), push it to ECR and roll it out.
# Usage: AWS_PROFILE=guglya infra/deploy-agent.sh
# First deploy: `terraform apply -target=aws_ecr_repository.agent`, run this, then a full `terraform apply`.
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=${AWS_REGION:-eu-central-1}
out() { terraform -chdir=terraform output -raw "$1" 2>/dev/null; }
REPO=$(out agent_ecr_repository_url)
TAG=$(git rev-parse --short HEAD)-$(date +%s)

aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 --provenance=false -f ../backend/agent/Dockerfile \
  -t "$REPO:$TAG" -t "$REPO:latest" --push ../backend/agent

FN=$(out agent_function_name || true)
if [ -z "$FN" ]; then
  echo "Image pushed. Lambda not created yet: run 'terraform -chdir=infra/terraform apply' now."
  exit 0
fi
aws lambda update-function-code --function-name "$FN" --image-uri "$REPO:$TAG" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FN"
echo "Deployed $TAG -> $(out agent_url)"
