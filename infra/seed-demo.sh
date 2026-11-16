#!/usr/bin/env bash
# Migrate the RDS database and load the DEMO catalog: images -> S3 /img/, rows -> Postgres, then embeddings.
# Usage (from repo root, with backend/.venv from requirements-ml.txt): AWS_PROFILE=guglya infra/seed-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_REGION=${AWS_REGION:-eu-central-1}
out() { terraform -chdir=infra/terraform output -raw "$1"; }
PY=${PYTHON:-backend/.venv/bin/python}
export DATABASE_URL=$(aws ssm get-parameter --name "$(out database_url_ssm_parameter)" --with-decryption \
  --query Parameter.Value --output text)
export IMAGE_BASE_URL=$(out cloudfront_url)

$PY backend/scripts/migrate.py
aws s3 sync data/demo/img/ "s3://$(out frontend_bucket)/img/" --cache-control "public,max-age=86400" --only-show-errors
$PY backend/ml/import_catalog.py --demo data/demo/catalog.csv data/demo/outfits.json
$PY backend/ml/embed.py
