-- Kaggle Amazon Products Dataset (CC BY-NC 4.0) catalog fields.
-- Adds columns only: existing rows, grants and the active-products read policy are unchanged.
alter table public.products
  add column source text,
  add column source_url text check (source_url is null or source_url like 'https://%'),
  add column image_url text check (image_url is null or image_url like 'https://%'),
  add column name_en text,
  add column brand text,
  add column rating numeric(2,1) check (rating is null or rating between 0 and 5),
  add column rating_count integer check (rating_count is null or rating_count >= 0),
  add column allergens text[] not null default '{}',
  add column packaging text check (packaging is null or packaging in ('formal', 'basic')),
  add column sweetness text check (sweetness is null or sweetness in ('unsweetened', 'unknown')),
  add column arrival_days integer check (arrival_days is null or arrival_days between 0 and 30),
  add column demo_fields text[] not null default '{}';
create index products_active_category on public.products (is_active, category);
