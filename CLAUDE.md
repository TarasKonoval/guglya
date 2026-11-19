# Ґуґля (Guglya) — context for Claude Code

## Product (source of truth: our one-pager)
Team: Андрій Гуменюк, Тарас Коновал.
"Ґуґля — сайт із готовими трендовими образами на сезон, зібраними з речей виключно українських брендів."
Goal: a person looks stylish without effort and chooses Ukrainian. "Обираєш образ — і одягаєшся в українське за кілька хвилин."
- Users: students / young people 19–35 in big cities; ideas from Instagram/TikTok/Pinterest; buy from a smartphone → mobile first.
- v1: ~30 AUTUMN outfits, 20 Ukrainian brands; for every piece AI picks similar alternatives from OTHER brands; prices shown; click → brand's product page (purchase happens there).
- Promotion: TikTok/Reels «АутфітЧек» (outfit + each item's brand and price + total). The UI mirrors this format.
- Validation: 20–30 users + 10 brands. Key metric: share of outfit viewers who click to a brand (goal ≥ 1 in 10).
- UI language Ukrainian; prices like "1 290 ₴".

## Grading (demo Thu 19 Nov 2026)
1. Repo with backend/, frontend/, infra/, README.md (what/run/deploy). 2. HTTPS prototype with sign-up/sign-in.
3. PDF report with real user feedback (backend/scripts/stats.py + feedback table; template docs/report-template.md).
4. Bonus: donations to a Monobank volunteer jar (VITE_DONATE_URL), donate clicks logged.

## Architecture (AWS eu-central-1, Terraform in infra/terraform, local state)
- Auth: Cognito User Pool (email username, min 8 chars). Email sign-up is confirmed with a 6-digit code (Cognito default
  mailer, 50 emails/day; SES is the upgrade path); the pre-sign-up Lambda auto-confirms Google sign-ins only. Public client, no secret.
  Google sign-in: Cognito Google IdP + custom domain auth.guglya.studio (OAuth code flow, Amplify signInWithRedirect); Google OAuth
  client lives in Google Cloud Console, credentials only in terraform.tfvars. Email and Google accounts are not linked.
- Frontend: React + Vite + TS + aws-amplify v6 → private S3 + CloudFront (OAC, SPA fallback). `infra/deploy-frontend.sh`.
- Backend: FastAPI (`backend/app`) on Lambda (container, arm64, Mangum) behind API Gateway HTTP API. `infra/deploy-backend.sh`.
  Lambda is in the default VPC without NAT: JWKS and DATABASE_URL come in as env vars from Terraform. CORS only in FastAPI.
- DB: RDS Postgres 16 + pgvector (db.t4g.micro, public endpoint, SG = Lambda SG + var.my_ip_cidr). Migrations in
  `infra/db/migrations`, applied by `backend/scripts/migrate.py`. DATABASE_URL in SSM `/guglya/database_url`.
- Similarity: FashionCLIP 512-d embeddings computed offline (`backend/ml/embed.py`), cosine (<=>) in SQL; alternatives only from
  other brands, one per brand first.
- Evidence: users, events (outfit_view, swap, donate_click, feedback_open), clicks (is_alternative), feedback (rating, would_buy).
- Images: demo images are our own illustrations in `data/demo/img`, served from S3/CloudFront under `/img/` (seed-demo.sh).
- Real catalog: `data/database/products.json` (Andrii's scraper, `data/database/merge.py`) -> `backend/ml/import_brand_db.py`
  (accessories, no-UAH-price and out-of-stock items skipped; colours mapped to the site's keys; "dress" slot = сукня/комплект/
  комбінезон/костюм, replaces top+bottom). Brand popularity = Instagram followers in `data/database/brand_popularity.json`.
- Alternatives ranking: CLIP similarity + 0.06 same item type + 0.05 × brand popularity (70% followers, 30% our clicks),
  outfit's gender (men: men only; women: women + unisex), similarity >= 0.6, one per brand first.
- Adding brands / how the catalog pipeline works: docs/catalog.md (scrape.mjs -> ua_names.py -> merge.py --keep ->
  import_brand_db.py -> embed.py -> classify_gender.py). 99 brands / 15 456 products on the site (19 Nov; 118 in brands.json); no Russian names, UAH only.
  Slots: hat, scarf (010), outer, jacket, bag (009), top, dress, bottom, shoes. classify_color.py fills missing colours.
- Alternatives stay within the item's kind (TYPE_GROUPS + title rules in backend/app/main.py), whole slot if < 3.
- Feed: Жінкам / Чоловікам / Парам toggle (outfits.gender); couple outfits = two looks (outfit_items.person 1/2).
  Sort/colour filters in a «Фільтри» sheet. Header: saved ♡, profile (name, surname, phone in users), cart (cart_items).
  Brand pages open only from the cart (clicks are still logged via /clicks).
- Fonts: KyivType Titling Bold (logo) + Montserrat (everything else), self-hosted in `frontend/src/assets/fonts`;
  source archives in `design/fonts/` (gitignored).
- Budget alarm $30/month (50/80/100%) to the email in terraform.tfvars.

## Conventions
- Keep it simple: prototype, not production. Smallest AWS sizes. No new services unless needed.
- AWS CLI profile `guglya` (IAM user guglya-admin; never root). `export AWS_PROFILE=guglya`.
- Never commit .env*, *.tfstate*, .terraform/, terraform.tfvars, keys. Budget email lives only in terraform.tfvars.
- Only product photos we may use (brand permission or our own). Demo data: brands/products is_demo=true, links go to /demo/<id>.
- Brand photos (18 Nov): the faculty confirmed with businesses that brand product photos may be shown at this student-project
  stage; before going further we write to each brand individually.

## Decisions / deviations
- Demo images are generated flat illustrations (no reliable verifiable free photo set for 60 specific items).
- `import_catalog.py --purge-demo` hides demo data (unpublish + out of stock) instead of deleting it, so clicks/events
  collected on the demo stay in the report.
- Outfit covers for demo outfits are generated flat lays; outfits without a cover render a 2×2 collage.

## Live
- Site: https://guglya.studio (www.guglya.studio and the *.cloudfront.net name 301-redirect here)
- Auth domain: https://auth.guglya.studio (Cognito custom domain; Google OAuth redirect URI .../oauth2/idpresponse)
- API:  https://bn43uwfr9f.execute-api.eu-central-1.amazonaws.com

## Checklist (Mon 16 Nov)
- [x] 0. Repo public on GitHub (history checked for secrets); Андрій (DobiH) invited as collaborator
- [x] 1. AWS access via IAM user profile `guglya` (not root); regular account, not Learner Lab
- [x] 2a. Terraform: Cognito + pre-sign-up Lambda, S3 + CloudFront, ECR, budget (sign-up auto-confirm verified)
- [x] 2b. Terraform: RDS + security groups + SSM
- [x] 2c. Terraform: backend Lambda + API Gateway
- [x] 3. Migrations + demo catalog (8 brands, 60 products, 10 autumn outfits) + embeddings
- [x] 4. Backend live: /health, /outfits
- [x] 5. Frontend live on CloudFront
- [x] 6. Live E2E: sign up → sign out → sign in → /me; test user removed
- [x] 7. UI per spec, Playwright check at 375×812 + desktop, redeployed
- [x] 8. README, CLAUDE.md, report template
- [x] Google sign-in (17 Nov) — redirect to Google verified; full login to be confirmed by a human
- [x] Custom domain guglya.studio + auth.guglya.studio (17 Nov), E2E verified
- [x] Monobank jar (19 Nov): https://send.monobank.ua/jar/6QFJz7R36R, default in infra/deploy-frontend.sh
- [ ] Tue/Wed: test rounds 17 + 18 Nov (stats.py --since/--until), brand interviews, real catalog import
