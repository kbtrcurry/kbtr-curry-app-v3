-- v3: 取り置きリスト、お客さん台帳、営業日ごとの用意数（売り切れ管理）。追加のみ。

-- 営業日ごとの「用意する数」（メニュー別）。レジの売り切れ管理に使う
create table if not exists menu_stock (
  service_date date not null,
  menu_id uuid not null references menus (id) on delete cascade,
  qty integer not null check (qty >= 0),
  primary key (service_date, menu_id)
);

-- 取り置き（XやInstagramのDMで受けたもの）
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  platform text not null default 'x' check (platform in ('x', 'instagram', 'other')),
  handle text not null default '',
  name text not null default '',
  items jsonb not null default '[]'::jsonb, -- [{ "menu_id": "...", "name": "...", "qty": 2 }]
  note text not null default '',
  status text not null default 'reserved' check (status in ('reserved', 'picked_up', 'no_show', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_reservations_date on reservations (service_date);
create index if not exists idx_reservations_handle on reservations (platform, handle);

-- お客さん台帳（アカウントごとのメモ・印）
create table if not exists customer_notes (
  platform text not null check (platform in ('x', 'instagram', 'other')),
  handle text not null,
  flag text not null default 'none' check (flag in ('none', 'regular', 'watch')),
  posted_review boolean not null default false,
  note text not null default '',
  primary key (platform, handle)
);

alter table menu_stock enable row level security;
alter table reservations enable row level security;
alter table customer_notes enable row level security;

drop policy if exists menu_stock_owner on menu_stock;
create policy menu_stock_owner on menu_stock for all using (is_owner()) with check (is_owner());
drop policy if exists reservations_owner on reservations;
create policy reservations_owner on reservations for all using (is_owner()) with check (is_owner());
drop policy if exists customer_notes_owner on customer_notes;
create policy customer_notes_owner on customer_notes for all using (is_owner()) with check (is_owner());
