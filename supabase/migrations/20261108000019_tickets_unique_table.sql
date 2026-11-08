-- 1つのテーブル(番号)に、使用中(open/served)の伝票は1枚だけにする。
-- すでに同じテーブルへ重なっている伝票があれば、新しい方を取り消し(void)にしてから制限をかける。
-- (重なった伝票の中身は残るので、必要なら tickets テーブルで確認できる)
update tickets
set status = 'void'
where id in (
  select id from (
    select id,
           row_number() over (partition by service_date, card_no order by created_at, id) as rn
    from tickets
    where status in ('open', 'served')
  ) d
  where d.rn > 1
);

create unique index if not exists uq_tickets_active_table
  on tickets (service_date, card_no)
  where status in ('open', 'served');
