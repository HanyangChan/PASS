begin;

-- Product facts are maintained by trusted server/admin jobs, never by the app.
create table public.products (
  id text primary key,
  name text not null,
  category text not null,
  description text not null default '',
  price_krw integer not null check (price_krw >= 0),
  shipping_fee_krw integer not null default 0 check (shipping_fee_krw >= 0),
  stock integer not null default 0 check (stock >= 0),
  arrival_date date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 16000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations(id, user_id) on delete cascade
);
-- Snapshots can represent local demo products too; prepared records are not orders.
create table public.gift_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('saved', 'recent', 'prepared')),
  gift_key text not null check (length(gift_key) between 1 and 200),
  product_id text references public.products(id) on delete set null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, gift_key)
);
create index conversations_owner_updated on public.conversations (user_id, updated_at desc);
create index messages_conversation_created on public.messages (conversation_id, user_id, created_at);
create index gift_records_owner_kind_updated on public.gift_records (user_id, kind, updated_at desc);

create function public.pass_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger conversations_touch before update on public.conversations for each row execute function public.pass_touch_updated_at();
create trigger gift_records_touch before update on public.gift_records for each row execute function public.pass_touch_updated_at();

alter table public.products enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.gift_records enable row level security;

-- Explicit grants prevent project-wide default privileges from granting client writes.
revoke all on public.products, public.conversations, public.messages, public.gift_records from public, anon, authenticated;
grant select on public.products to anon, authenticated;
grant select, insert, update, delete on public.conversations, public.messages, public.gift_records to authenticated;
create policy active_products_read on public.products for select to anon, authenticated using (is_active = true);
create policy conversations_owner on public.conversations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy messages_owner on public.messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy gift_records_owner on public.gift_records for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on function public.pass_touch_updated_at() from public, anon, authenticated;
comment on table public.gift_records is 'User-owned gift preparation and selection snapshots; not purchase/order/payment records.';
commit;
