-- The builder's search for each outfit item (AI description of the look photo -> FashionCLIP text vector).
-- The outfit page ranks alternatives with it, so visitors see the same row the admin saw (colour-aware),
-- instead of a search by the chosen product's photo. Null for items published without the AI.
alter table outfit_items
  add column if not exists query_text text,
  add column if not exists query_color text,
  add column if not exists query_vector vector(512);
