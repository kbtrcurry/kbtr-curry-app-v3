-- v3: 取り置きを「来店済み」にした時刻。来店済みの人を、した順に並べるため。追加のみ。
alter table reservations add column if not exists picked_up_at timestamptz;
