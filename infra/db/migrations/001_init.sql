-- Guglya schema (Amazon RDS PostgreSQL 16 + pgvector). Applied by backend/scripts/migrate.py.
create extension if not exists vector;

-- One row per Cognito user, upserted by the API on every authenticated request.
create table if not exists users (
  id text primary key,       -- Cognito `sub`
  email text,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  site_url text,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  title text not null,
  category text not null check (category in ('hat', 'top', 'bottom', 'shoes')),
  color text,                -- normalised: black, white, grey, blue, beige, brown, green, red, ...
  price_uah integer not null,
  image_url text not null,
  product_url text not null unique,
  in_stock boolean not null default true,
  embedding vector(512),     -- FashionCLIP image embedding, filled by backend/ml/embed.py
  created_at timestamptz default now()
);
create index if not exists products_category_idx on products (category);

create table if not exists outfits (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  season text not null check (season in ('winter', 'spring', 'summer', 'autumn')),
  cover_image_url text not null,
  published boolean not null default true,
  created_at timestamptz default now()
);

-- The "hero" product shown for each slot of an outfit
create table if not exists outfit_items (
  outfit_id uuid references outfits(id) on delete cascade,
  slot text not null check (slot in ('hat', 'top', 'bottom', 'shoes')),
  product_id uuid not null references products(id),
  primary key (outfit_id, slot)
);

create table if not exists saved_outfits (
  user_id text references users(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, outfit_id)
);

-- Every click to a brand site: the main validation metric for the report
create table if not exists clicks (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  product_id uuid references products(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete set null,
  slot text,
  created_at timestamptz default now()
);

create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  rating integer check (rating between 1 and 5),
  text text not null,
  created_at timestamptz default now()
);

-- Handy view for the report
create or replace view report_stats as
select
  (select count(*) from users) as users,
  (select count(distinct user_id) from clicks) as users_who_clicked,
  (select count(*) from clicks) as clicks,
  (select count(*) from saved_outfits) as saves,
  (select count(*) from feedback) as feedback_entries;
