# Frontend on Cloudflare Pages

Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git -> this repo.

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (Render URL), `VITE_DONATE_URL` |

`frontend/public/_redirects` makes client-side routes work on refresh.
After deploy, add the Pages URL to `CORS_ORIGINS` on Render and to Supabase -> Authentication -> URL Configuration (Site URL + Redirect URLs).
