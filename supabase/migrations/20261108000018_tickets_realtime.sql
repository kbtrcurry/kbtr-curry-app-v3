-- 伝票が変わったときだけ、他の端末(調理場・レジ・iPhone)へ知らせる(Supabase Realtime)。
-- 何度実行しても問題ない。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;
end
$$;
