-- Who an outfit is for; the feed asks the user to pick women/men first. unisex shows in both.
alter table outfits add column if not exists gender text not null default 'women'
  check (gender in ('women', 'men', 'unisex'));

-- Demo outfits (titles from data/demo/outfits.json); everything else keeps the default
update outfits set gender = 'men'
where title in ('Оверсайз-піджак', 'Спорт-шик', 'Карго та бомбер', 'Сірий монохром');
