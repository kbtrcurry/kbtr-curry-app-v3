-- v3: 入金予定（未収入金＝売掛金）。売上は発生日で計上し、入金予定日が来たら自動で 売掛金→普通預金 に精算する。
-- 追加のみ（既存の列・テーブルは変更しない）。delete_journal_entry だけ「入金予定に紐づく仕訳は消せない」ガードを足した置き換え。

-- 1) 勘定科目: 売掛金（営業上の未収入金）
insert into accounts (code, name, type, sort_order) values ('103', '売掛金', 'asset', 103)
on conflict (code) do nothing;

-- 2) 入金予定
create table if not exists receivables (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments (id),
  accrual_date date not null,            -- 売上の発生日（イベント当日など）
  expected_date date not null,           -- 入金予定日
  gross integer not null check (gross > 0), -- 売上総額
  fee integer not null default 0,        -- 差し引かれる手数料・出店料
  memo text not null default '',
  auto_settle boolean not null default true, -- 入金予定日が来たら自動で精算する
  status text not null default 'open' check (status in ('open', 'settled')),
  settled_on date,
  settled_amount integer,
  created_at timestamptz not null default now(),
  check (fee >= 0 and fee <= gross)
);

create index if not exists idx_receivables_status on receivables (status, expected_date);

alter table receivables enable row level security;
create policy "owner full access" on receivables
  for all to authenticated using (is_owner()) with check (is_owner());

-- 3) 売上の発生日に計上: 売掛金(差引額) + 支払手数料(fee) / 売上高(gross)。同じ p_id で再実行すると作り直す
create or replace function record_receivable(
  p_id uuid,
  p_accrual_date date,
  p_expected_date date,
  p_segment_id uuid,
  p_gross integer,
  p_fee integer,
  p_memo text default '',
  p_auto boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_recv uuid;
  v_fee_acct uuid;
  v_rev uuid;
  v_status text;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_gross <= 0 or p_fee < 0 or p_fee > p_gross then
    raise exception '金額が不正です（手数料は売上総額以下にしてください）';
  end if;

  select status into v_status from receivables where id = p_id;
  if v_status = 'settled' then
    raise exception '入金済みです。先に入金を取り消してから直してください';
  end if;

  select id into v_recv from accounts where code = '103';
  select id into v_fee_acct from accounts where code = '521';
  select id into v_rev from accounts where code = '401';
  if v_recv is null or v_fee_acct is null or v_rev is null then
    raise exception '勘定科目(売掛金・支払手数料・売上高)が見つかりません';
  end if;

  insert into receivables (id, segment_id, accrual_date, expected_date, gross, fee, memo, auto_settle)
  values (p_id, p_segment_id, p_accrual_date, p_expected_date, p_gross, p_fee, coalesce(p_memo, ''), p_auto)
  on conflict (id) do update
    set segment_id = excluded.segment_id, accrual_date = excluded.accrual_date, expected_date = excluded.expected_date,
        gross = excluded.gross, fee = excluded.fee, memo = excluded.memo, auto_settle = excluded.auto_settle;

  delete from journal_entries where source_type = 'platform_revenue' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_accrual_date, coalesce(p_memo, ''), p_segment_id, 'platform_revenue', p_id)
  returning id into v_entry_id;

  if p_gross - p_fee > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo)
    values (v_entry_id, v_recv, 'debit', p_gross - p_fee, coalesce(p_memo, ''));
  end if;
  if p_fee > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo)
    values (v_entry_id, v_fee_acct, 'debit', p_fee, coalesce(p_memo, ''));
  end if;
  insert into journal_lines (entry_id, account_id, side, amount, memo)
  values (v_entry_id, v_rev, 'credit', p_gross, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return p_id;
end;
$$;

-- 4) 入金の精算: 普通預金 / 売掛金。実際の入金額が予定と違えば、差額は 支払手数料(少ない)・雑収入(多い) に出す
create or replace function settle_receivable(
  p_id uuid,
  p_date date,
  p_amount integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  r receivables%rowtype;
  v_net integer;
  v_amount integer;
  v_diff integer;
  v_entry_id uuid;
  v_bank uuid;
  v_recv uuid;
  v_fee_acct uuid;
  v_misc uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  select * into r from receivables where id = p_id for update;
  if not found then
    raise exception '入金予定が見つかりません';
  end if;
  if r.status = 'settled' then
    raise exception '既に入金済みです';
  end if;

  v_net := r.gross - r.fee;
  v_amount := coalesce(p_amount, v_net);
  if v_amount <= 0 then
    raise exception '入金額は1円以上で入力してください';
  end if;
  v_diff := v_net - v_amount;

  select id into v_bank from accounts where code = '102';
  select id into v_recv from accounts where code = '103';
  select id into v_fee_acct from accounts where code = '521';
  select id into v_misc from accounts where code = '402';

  delete from journal_entries where source_type = 'manual' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_date, '入金 ' || r.memo, r.segment_id, 'manual', p_id)
  returning id into v_entry_id;

  insert into journal_lines (entry_id, account_id, side, amount, memo)
  values (v_entry_id, v_bank, 'debit', v_amount, '入金 ' || r.memo);
  if v_diff > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo)
    values (v_entry_id, v_fee_acct, 'debit', v_diff, '入金差額');
  elsif v_diff < 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo)
    values (v_entry_id, v_misc, 'credit', -v_diff, '入金差額');
  end if;
  if v_net > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo)
    values (v_entry_id, v_recv, 'credit', v_net, '入金 ' || r.memo);
  end if;

  perform assert_entry_balanced(v_entry_id);
  update receivables set status = 'settled', settled_on = p_date, settled_amount = v_amount where id = p_id;
  return p_id;
end;
$$;

-- 5) 入金予定日が来たものを自動で精算（アプリを開いたときに呼ぶ）。精算した件数を返す
create or replace function settle_due_receivables(p_today date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  for r in
    select id, expected_date from receivables
     where status = 'open' and auto_settle and expected_date <= p_today
     order by expected_date, created_at
  loop
    perform settle_receivable(r.id, r.expected_date, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 6) 入金の取り消し（金額・日付の間違いを直すとき）。取り消すと自動精算はオフになる
create or replace function reopen_receivable(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  delete from journal_entries where source_type = 'manual' and source_id = p_id;
  update receivables
     set status = 'open', settled_on = null, settled_amount = null, auto_settle = false
   where id = p_id;
end;
$$;

-- 7) 入金予定の削除（売上の仕訳も入金の仕訳も消える）
create or replace function delete_receivable(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  delete from journal_entries where source_type = 'manual' and source_id = p_id;
  delete from journal_entries where source_type = 'platform_revenue' and source_id = p_id;
  delete from receivables where id = p_id;
end;
$$;

-- 8) 仕訳の取り消し: 入金予定に紐づく仕訳は、ここからは消せない（入金予定の画面から直す）。それ以外は従来どおり
create or replace function delete_journal_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source_type text;
  v_source_id uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  select source_type, source_id into v_source_type, v_source_id from journal_entries where id = p_entry_id;
  if v_source_type is null then
    return;
  end if;
  if v_source_type = 'pos_close' then
    raise exception 'レジ締めの仕訳は取り消せません。レジ画面の「締め直し」を使ってください';
  end if;
  if v_source_type in ('platform_revenue', 'manual') and v_source_id is not null
     and exists (select 1 from receivables where id = v_source_id) then
    raise exception 'この仕訳は「入金予定」に紐づいています。会計の「入金予定」タブから直す・削除してください';
  end if;

  delete from journal_entries where id = p_entry_id;
end;
$$;
