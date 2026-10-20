-- v3: 仕訳に印を付ける（「一時的な出費」＝設備・旅費など、毎月は出ない大きな出費）。
-- 分析で「いつもの営業の利益」から外して見せるために使う。追加のみ。
create table if not exists journal_tags (
  entry_id uuid primary key references journal_entries (id) on delete cascade,
  tag text not null check (tag in ('one_off')),
  created_at timestamptz not null default now()
);

alter table journal_tags enable row level security;

drop policy if exists journal_tags_owner on journal_tags;
create policy journal_tags_owner on journal_tags
  for all
  using (is_owner())
  with check (is_owner());
