-- 席ごとの伝票（カード番号つき）。iPhoneで注文を入れ、調理場の画面に注文順に並べ、レジで会計する。
-- 注文は items(jsonb) に [{menu_id, name, price, qty, from_res}] で持つ。
--   from_res = true  : 取り置きで予約済みの品（当日分の残りからは引かない）
--   from_res = false : 当日に追加で注文された品（当日分から引く）
create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  card_no integer not null check (card_no > 0),
  label text not null default '',
  items jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'served', 'paid', 'void')),
  reservation_id uuid references reservations (id) on delete set null,
  created_at timestamptz not null default now(),
  served_at timestamptz,
  paid_at timestamptz
);

create index if not exists idx_tickets_date_status on tickets (service_date, status);

alter table tickets enable row level security;

drop policy if exists "owner full access" on tickets;
create policy "owner full access" on tickets
  for all to authenticated using (is_owner()) with check (is_owner());
