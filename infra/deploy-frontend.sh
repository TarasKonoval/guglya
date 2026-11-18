#!/usr/bin/env bash
# Build the frontend with production settings from Terraform outputs, upload to S3, invalidate CloudFront.
# Usage: AWS_PROFILE=guglya VITE_DONATE_URL=https://send.monobank.ua/jar/XXXX infra/deploy-frontend.sh
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=${AWS_REGION:-eu-central-1}
out() { terraform -chdir=terraform output -raw "$1"; }
BUCKET=$(out frontend_bucket)
DIST=$(out cloudfront_distribution_id)
SITE=$(out site_url)

# gitignored; regenerated on every deploy
cat > ../frontend/.env.production <<ENV
VITE_AWS_REGION=$AWS_REGION
VITE_COGNITO_USER_POOL_ID=$(out user_pool_id)
VITE_COGNITO_CLIENT_ID=$(out client_id)
VITE_API_URL=$(out api_url)
VITE_COGNITO_DOMAIN=$(out cognito_domain)
VITE_GOOGLE_ENABLED=$(out google_enabled)
VITE_DONATE_URL=${VITE_DONATE_URL:-}
VITE_AGENT_URL=$(out agent_url)
VITE_CLARITY_ID=${VITE_CLARITY_ID:-zftevqb23f}  # Microsoft Clarity project (heatmaps); public id
ENV

cd ../frontend
npm ci --no-audit --no-fund
npm run build

# img/ holds catalog images uploaded by seed-demo.sh — never delete it from here.
# Hashed bundles cache forever; everything else revalidates quickly.
aws s3 sync dist/ "s3://$BUCKET/" --delete --exclude "img/*" --exclude "assets/*" --cache-control "public,max-age=60"
aws s3 sync dist/assets/ "s3://$BUCKET/assets/" --delete --cache-control "public,max-age=31536000,immutable"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query Invalidation.Id --output text
echo "Live: $SITE"
