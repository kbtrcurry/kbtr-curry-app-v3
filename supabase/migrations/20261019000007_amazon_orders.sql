-- v3: Amazonの注文候補（Gmailの「注文済み」メールから Claude が取り込む）。追加のみ。
-- 候補は pending のまま溜め、アプリの「取り込み」画面で事業用だけ経費にする(booked)か、個人用として除外する(ignored)。
-- (order_id, title, amount, seq) で一意。再取り込みしても重複せず、booked/ignored の状態は上書きしない。
create table if not exists amazon_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  ordered_on date not null,
  title text not null,
  quantity integer not null default 1,
  amount integer not null check (amount > 0),
  seq integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'booked', 'ignored')),
  mail_message_id text,
  created_at timestamptz not null default now(),
  unique (order_id, title, amount, seq)
);

create index if not exists idx_amazon_orders_status on amazon_orders (status, ordered_on);

alter table amazon_orders enable row level security;
create policy "owner full access" on amazon_orders
  for all to authenticated using (is_owner()) with check (is_owner());
