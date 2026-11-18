-- Outfits for couples (two matching looks) as a third feed option next to women/men
alter table outfits drop constraint if exists outfits_gender_check;
alter table outfits add constraint outfits_gender_check check (gender in ('women', 'men', 'unisex', 'couple'));

-- Profile fields; email stays the Cognito one
alter table users
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text;

-- Items a user put in the cart; buying happens on the brand's site (via /clicks)
create table if not exists cart_items (
  user_id text references users(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete set null,
  slot text,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
