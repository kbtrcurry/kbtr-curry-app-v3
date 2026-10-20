-- v3: 取り置きに「来店予定時間」「新規」「うずらアチャール付き」を持たせる（過去の台帳の取り込み用）。追加のみ。
alter table reservations add column if not exists visit_time text not null default '';
alter table reservations add column if not exists is_new boolean not null default false;
alter table reservations add column if not exists uzura boolean not null default true;
