-- Outfit builder feedback (18 Nov)

-- "outer" = coats, jackets, blazers: the layer worn over a top (sweater/shirt) or a dress/suit
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('hat', 'outer', 'top', 'dress', 'bottom', 'shoes'));
update products set category = 'outer'
  where category = 'top' and not is_demo and item_type in
    ('Пальто', 'Куртка', 'Піджак', 'Бомбер', 'Пуховик', 'Тренч', 'Шуба', 'Парка', 'Вітрівка', 'Дублянка', 'Косуха');

alter table outfit_items drop constraint if exists outfit_items_slot_check;
alter table outfit_items add constraint outfit_items_slot_check
  check (slot in ('hat', 'outer', 'top', 'dress', 'bottom', 'shoes'));

-- Admins hide wrong products (wrong gender, broken photo); re-imports keep them hidden
alter table products add column if not exists is_hidden boolean not null default false;
