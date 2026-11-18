-- Real catalog from data/database/products.json (scraped from brand sites, see data/database/merge.py)

-- Brands: scraper id + popularity (Instagram followers) used to rank AI alternatives
alter table brands
  add column if not exists slug text unique,
  add column if not exists instagram_followers integer,
  add column if not exists segment text;

-- "dress" = dresses, jumpsuits and sets: one item that covers both top and bottom
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('hat', 'top', 'dress', 'bottom', 'shoes'));
alter table products
  add column if not exists gender text check (gender in ('women', 'men', 'unisex')),
  add column if not exists item_type text,       -- brand's own type: Светр, Пальто, Сукня...
  add column if not exists old_price_uah integer,  -- regular price when price_uah is a sale price
  add column if not exists sizes text[],
  add column if not exists photos text[];
create index if not exists products_gender_idx on products (category, gender) where in_stock;

alter table outfit_items drop constraint if exists outfit_items_slot_check;
alter table outfit_items add constraint outfit_items_slot_check
  check (slot in ('hat', 'top', 'dress', 'bottom', 'shoes'));
