-- "jacket" = blazers (піджак): worn under a coat, alone, or as the jacket of a suit picked as separates
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('hat', 'outer', 'jacket', 'top', 'dress', 'bottom', 'shoes'));
update products set category = 'jacket' where category = 'outer' and not is_demo and item_type = 'Піджак';

alter table outfit_items drop constraint if exists outfit_items_slot_check;
alter table outfit_items add constraint outfit_items_slot_check
  check (slot in ('hat', 'outer', 'jacket', 'top', 'dress', 'bottom', 'shoes'));
