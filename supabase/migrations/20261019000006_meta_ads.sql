-- v3: Meta広告の日次実績。追加のみ（既存テーブルは変更しない＝v2と共存できる）
-- 取得は Claude 経由（Windsor.ai）→ 99_system_tools/import-meta-ads/import.mjs で upsert。
-- 主キーは (date, ad_id)。広告名は変更されうるため名前では識別しない。再取得しても重複せず、
-- 直近日の数値がMeta側で修正されたときは上書きされる。過去の行は削除しない（履歴を保持）。
create table if not exists meta_ads_daily (
  date date not null,
  ad_id text not null,
  account_id text not null,
  currency text not null default 'JPY',
  campaign_id text,
  campaign text,
  adset_id text,
  adset_name text,
  ad_name text,
  spend numeric not null default 0,
  impressions integer,
  reach integer,
  clicks integer,
  link_clicks integer,
  frequency numeric,
  fetched_at timestamptz not null default now(),
  primary key (date, ad_id)
);

create index if not exists idx_meta_ads_daily_date on meta_ads_daily (date);

alter table meta_ads_daily enable row level security;
create policy "owner full access" on meta_ads_daily
  for all to authenticated using (is_owner()) with check (is_owner());
