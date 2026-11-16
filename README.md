# Ґуґля (Guglya)

**Trending seasonal outfits, assembled from Ukrainian brands.**
Pick an outfit — for every piece (hat, top, bottoms, shoes) AI finds 5 similar items in stock at different Ukrainian brands, matched by cut, colour and texture, with prices in UAH. One click takes you to the item on the brand's own site.

Goal: make Ukrainian brands the first choice when people decide what to wear.

## How it works

```
brand catalogs (CSV) --> import_catalog.py --> Postgres (Supabase)
product photos -------> embed.py (FashionCLIP, offline) --> pgvector embeddings
React app --(Supabase Auth JWT)--> FastAPI --> similar items via pgvector cosine search
click on item --> POST /clicks (logged + UTM) --> brand product page
```

| Part | Stack | Hosting |
| --- | --- | --- |
| `frontend/` | React + Vite + TypeScript, Supabase Auth | Cloudflare Pages (HTTPS) |
| `backend/` | Python FastAPI, psycopg, PyJWT | Render (Docker, HTTPS) |
| `backend/ml/` | FashionCLIP embeddings, catalog import | runs locally |
| `infra/` | SQL migrations, docker-compose, Render blueprint, Pages setup | — |
| Database + auth | Supabase Postgres + pgvector + Auth | Supabase |

## Run locally

Prerequisites: Node 20+, Python 3.12, a free Supabase project.

1. **Database.** In Supabase -> SQL Editor run `infra/supabase/migrations/001_init.sql`.
2. **Backend.**
   ```bash
   cd backend
   cp .env.example .env        # fill DATABASE_URL, SUPABASE_URL
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload    # http://localhost:8000/docs
   ```
   Or with Docker: `docker compose -f infra/docker-compose.yml up --build`.
3. **Catalog + AI embeddings** (one-off, from repo root):
   ```bash
   pip install -r backend/requirements-ml.txt
   export DATABASE_URL=...         # same as backend/.env
   python backend/ml/import_catalog.py data/catalog.csv data/outfits.json
   python backend/ml/embed.py
   ```
   Formats: see `data/catalog.example.csv` and `data/outfits.example.json`.
4. **Frontend.**
   ```bash
   cd frontend
   cp .env.example .env        # fill Supabase URL + anon key, VITE_API_URL=http://localhost:8000
   npm install && npm run dev  # http://localhost:5173
   ```

## Deploy

- **Backend -> Render:** New -> Blueprint -> this repo, `infra/render.yaml`. Set env vars from `backend/.env.example`; `CORS_ORIGINS` = your Pages URL. Free instances sleep after inactivity — open `/health` a minute before a demo.
- **Frontend -> Cloudflare Pages:** see `infra/cloudflare-pages.md`.
- **Auth:** Supabase -> Authentication -> URL Configuration: set Site URL to the Pages URL.

## API

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| GET | `/health` | — | liveness |
| GET | `/me` | required | current user |
| GET | `/outfits?season=` | — | outfit feed |
| GET | `/outfits/{id}` | — | outfit with its hero item per slot |
| GET | `/outfits/{id}/similar/{slot}?color=&limit=5` | — | similar in-stock items (pgvector) |
| POST | `/clicks` | optional | log click, returns brand URL with UTM |
| GET/POST/DELETE | `/saved[/{outfit_id}]` | required | saved outfits |
| POST | `/feedback` | required | in-app feedback |

## Team

Built at Ukrainian Catholic University, Faculty of Applied Sciences.
