-- "bag" = handbags, backpacks, shoppers, clutches (data/database convention: slot "bag", see data/database/README.md)
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('hat', 'outer', 'jacket', 'top', 'dress', 'bottom', 'shoes', 'bag'));

alter table outfit_items drop constraint if exists outfit_items_slot_check;
alter table outfit_items add constraint outfit_items_slot_check
  check (slot in ('hat', 'outer', 'jacket', 'top', 'dress', 'bottom', 'shoes', 'bag'));
