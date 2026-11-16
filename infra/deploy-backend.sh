#!/usr/bin/env bash
# Build the backend Lambda image (arm64), push it to ECR, roll it out, and smoke-test /health.
# Usage: infra/deploy-backend.sh            (needs: aws, docker, terraform apply done at least for ECR)
set -euo pipefail
cd "$(dirname "$0")"
TF="terraform -chdir=terraform"
REGION=$($TF output -raw ecr_repository_url | cut -d. -f4)
REPO=$($TF output -raw ecr_repository_url)
TAG=$(git rev-parse --short HEAD)-$(date +%s)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO%%/*}"
# --provenance=false: Lambda rejects multi-manifest (attestation) images
docker buildx build --platform linux/arm64 --provenance=false -f ../backend/Dockerfile.lambda \
  -t "$REPO:$TAG" -t "$REPO:latest" --push ../backend

FN=$($TF output -raw backend_function_name 2>/dev/null || true)
if [ -z "$FN" ]; then
  echo "Image pushed. Lambda not created yet: run 'terraform apply' in infra/terraform now."
  exit 0
fi
aws lambda update-function-code --region "$REGION" --function-name "$FN" --image-uri "$REPO:$TAG" >/dev/null
aws lambda wait function-updated-v2 --region "$REGION" --function-name "$FN"
API=$($TF output -raw api_url)
echo "Deployed $TAG. Health check:"
curl -fsS "$API/health" && echo
