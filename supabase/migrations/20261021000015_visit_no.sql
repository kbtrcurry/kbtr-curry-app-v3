-- v3: 取り置きに「何回目の来店か」（メモの「2回目」など）を持たせる。お客さん台帳の回数に反映する。追加のみ。
alter table reservations add column if not exists visit_no integer;
