#!/usr/bin/env bash
# Build the backend Lambda image (arm64), push it to ECR, roll it out, and smoke-test /health.
# Usage: AWS_PROFILE=guglya infra/deploy-backend.sh
# First deploy: apply the ECR repo, run this (pushes the image), then `terraform apply` creates the Lambda.
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=${AWS_REGION:-eu-central-1}
out() { terraform -chdir=terraform output -raw "$1" 2>/dev/null; }
REPO=$(out ecr_repository_url)
TAG=$(git rev-parse --short HEAD)-$(date +%s)

aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
# --provenance=false: Lambda rejects multi-manifest (attestation) images
docker buildx build --platform linux/arm64 --provenance=false -f ../backend/Dockerfile.lambda \
  -t "$REPO:$TAG" -t "$REPO:latest" --push ../backend

FN=$(out backend_function_name || true)
if [ -z "$FN" ]; then
  echo "Image pushed. Lambda not created yet: run 'terraform -chdir=infra/terraform apply' now."
  exit 0
fi
aws lambda update-function-code --function-name "$FN" --image-uri "$REPO:$TAG" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FN"
API=$(out api_url)
echo "Deployed $TAG -> $API"
curl -fsS "$API/health" && echo
