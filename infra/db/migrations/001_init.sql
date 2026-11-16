-- Guglya schema (Amazon RDS PostgreSQL 16 + pgvector). Applied by backend/scripts/migrate.py.
-- No RLS: the FastAPI backend is the only database client.
create extension if not exists vector;

-- One row per Cognito user, upserted by the API on every authenticated request.
create table if not exists users (
  id text primary key,       -- Cognito `sub`
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  site_url text,
  instagram text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  title text not null,
  category text not null check (category in ('hat', 'top', 'bottom', 'shoes')),
  color text,                -- normalised: black, white, grey, beige, brown, blue, green, red, burgundy
  price_uah integer not null,
  image_url text not null,
  product_url text not null unique,
  in_stock boolean not null default true,
  is_demo boolean not null default false,
  embedding vector(512),     -- FashionCLIP image embedding, filled by backend/ml/embed.py
  created_at timestamptz not null default now()
);
create index if not exists products_category_idx on products (category) where in_stock;

create table if not exists outfits (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  season text not null default 'autumn' check (season in ('winter', 'spring', 'summer', 'autumn')),
  cover_image_url text,      -- null -> the frontend renders a flat-lay collage of the items
  style_tag text,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- The original ("hero") product for each slot of an outfit; hat is optional
create table if not exists outfit_items (
  outfit_id uuid references outfits(id) on delete cascade,
  slot text not null check (slot in ('hat', 'top', 'bottom', 'shoes')),
  product_id uuid not null references products(id),
  primary key (outfit_id, slot)
);

create table if not exists saved_outfits (
  user_id text references users(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_id)
);

-- Every click to a brand's product page: the key validation metric
create table if not exists clicks (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  outfit_id uuid references outfits(id) on delete set null,
  slot text,
  is_alternative boolean not null default false,  -- true = AI-picked alternative, false = the outfit's original item
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  type text not null check (type in ('outfit_view', 'swap', 'donate_click', 'feedback_open')),
  outfit_id uuid references outfits(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists events_type_idx on events (type, created_at);

create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  outfit_id uuid references outfits(id) on delete set null,
  rating integer check (rating between 1 and 5),
  would_buy text check (would_buy in ('yes', 'maybe', 'no')),
  text text,
  created_at timestamptz not null default now()
);
