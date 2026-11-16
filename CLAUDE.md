# Guglya — context for Claude Code

## Product
Website with trending seasonal outfits made of Ukrainian brands' items. User opens an outfit: outfit image on the left (full height), on the right one horizontal swipeable row per slot (hat, top, bottom, shoes). Each row shows the outfit's own item first, then 5 similar in-stock items from other Ukrainian brands (thumbnail, brand name, price in UAH). Colour chips filter a row. Click -> POST /clicks -> open returned URL (brand product page) in a new tab. Users must sign up / sign in (Supabase Auth email+password). Signed-in users can save outfits and send feedback. UI language: Ukrainian. Mobile-first (most fashion purchases are on phones).

## Deadline and grading (demo Thursday 19 Nov 2026)
1. Repo with top-level backend/, frontend/, infra/, README.md explaining product + run + deploy (3 pts).
2. Deployed prototype over HTTPS with working sign-up and sign-in (3 pts).
3. Report (PDF) with real user feedback: who, how many, what they said, what we changed (4 pts). Use `report_stats` view + clicks/feedback tables as evidence. Template: docs/report-template.md.
4. Bonus: users paid money — donation button to a Monobank volunteer jar (VITE_DONATE_URL); collect screenshots.

## Architecture
- frontend/: React 18 + Vite + TS, react-router, @supabase/supabase-js. `src/lib/api.ts` adds the Supabase JWT to API calls. Deployed to Cloudflare Pages.
- backend/: FastAPI (`app/main.py`), psycopg pool to Supabase Postgres, JWT verified in `app/auth.py` (JWKS, HS256 fallback). Deployed to Render via Docker.
- Similarity: FashionCLIP 512-d embeddings precomputed offline (`backend/ml/embed.py`), stored in `products.embedding` (pgvector); `/outfits/{id}/similar/{slot}` orders by cosine distance to the outfit's hero item, same category, in stock.
- Schema: `infra/supabase/migrations/001_init.sql`.

## Conventions
- Keep it simple: prototype, not production. No new services unless needed.
- Never commit .env files or keys. Frontend only uses the Supabase anon key.
- Use only product photos we are allowed to use (brand permission or our own photos).

## Today's plan (Mon 16 Nov) — in order
1. [ ] `npm install` in frontend, `pip install -r requirements.txt` in backend; both run locally.
2. [ ] Supabase project created, migration run, sign-up/sign-in works locally.
3. [ ] Deploy skeleton: backend on Render, frontend on Cloudflare Pages, HTTPS sign-up/sign-in works. (Secures 3+3 pts early.)
4. [ ] Catalog: data/catalog.csv with 100–300 items from 5–10 Ukrainian brands + data/outfits.json with 6–10 outfits; import; run embed.py.
5. [ ] UI: outfit feed (horizontal swipe, season switch) -> outfit page (left image, right rows with similar items, colour chips, total outfit price) -> click to brand.
6. [ ] Saved outfits page, feedback button/modal, donate button.
7. [ ] Polish mobile layout, deploy, smoke test on a phone.
8. [ ] README check; start user tests (tomorrow: 2 rounds, 15–20 people total).
