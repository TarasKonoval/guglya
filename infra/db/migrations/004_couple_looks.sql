-- A couple outfit is two complete looks: outfit_items.person = 1 or 2 (all other outfits use 1)
alter table outfit_items add column if not exists person smallint not null default 1 check (person in (1, 2));
alter table outfit_items drop constraint if exists outfit_items_pkey;
alter table outfit_items add primary key (outfit_id, person, slot);
