-- v3: 人時売上用の労働時間。追加のみ（既存の列・関数は変更しない＝v2と共存できる）
alter table sales_sessions add column if not exists labor_hours numeric;
