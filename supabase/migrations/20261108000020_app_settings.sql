-- 端末をまたいで共有する設定(店の間取り・特典の名前・今日つくる食数など)。
-- 何度実行しても問題ない。
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

drop policy if exists "owner full access" on app_settings;
create policy "owner full access" on app_settings
  for all to authenticated using (is_owner()) with check (is_owner());

-- 変えたとき、ほかの端末へすぐ知らせる(Realtime)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end
$$;
