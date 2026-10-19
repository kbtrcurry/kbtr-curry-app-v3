-- v3: クレジットカード払いの記帳（未払金）と、カード利用の候補テーブル。
-- 既存の関数・テーブルは同じ形のまま拡張（record_expense に 'card' を足すだけ）なので、v2 と共存できる。

-- 1) 勘定科目: 未払金（カード払いは、引き落としまで未払金で持つ）
insert into accounts (code, name, type, sort_order) values ('292', '未払金', 'liability', 292)
on conflict (code) do nothing;

-- 2) 経費入力: 支払方法に 'card'（貸方=未払金）を追加。引数は変えない（置き換え）
create or replace function record_expense(
  p_id uuid,
  p_entry_date date,
  p_segment_id uuid,
  p_account_id uuid,
  p_amount integer,
  p_payment_method text, -- 'cash' | 'bank' | 'card'
  p_memo text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_credit_account_id uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_amount <= 0 then
    raise exception '金額は1円以上で入力してください';
  end if;

  select id into v_credit_account_id from accounts
    where code = case p_payment_method when 'bank' then '102' when 'card' then '292' else '101' end;
  if v_credit_account_id is null then
    raise exception '支払方法が不正です: %', p_payment_method;
  end if;

  delete from journal_entries where source_type = 'expense' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_entry_date, coalesce(p_memo, ''), p_segment_id, 'expense', p_id)
  returning id into v_entry_id;

  insert into journal_lines (entry_id, account_id, side, amount, memo) values
    (v_entry_id, p_account_id, 'debit', p_amount, coalesce(p_memo, '')),
    (v_entry_id, v_credit_account_id, 'credit', p_amount, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- 3) カード引き落とし: 未払金 / 普通預金。同じ p_id で再実行すると作り直す（冪等）
create or replace function record_card_settlement(
  p_id uuid,
  p_entry_date date,
  p_amount integer,
  p_memo text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_payable uuid;
  v_bank uuid;
  v_seg uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_amount <= 0 then
    raise exception '金額は1円以上で入力してください';
  end if;

  select id into v_payable from accounts where code = '292';
  select id into v_bank from accounts where code = '102';
  select id into v_seg from segments where code = 'common';
  if v_payable is null or v_bank is null or v_seg is null then
    raise exception '勘定科目(未払金・普通預金)または共通セグメントが見つかりません';
  end if;

  delete from journal_entries where source_type = 'manual' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_entry_date, coalesce(p_memo, ''), v_seg, 'manual', p_id)
  returning id into v_entry_id;

  insert into journal_lines (entry_id, account_id, side, amount, memo) values
    (v_entry_id, v_payable, 'debit', p_amount, coalesce(p_memo, '')),
    (v_entry_id, v_bank, 'credit', p_amount, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- 4) カード利用の候補（Gmailの「ご利用のお知らせ」メールから Claude が取り込む）
--    pending=確認待ち / booked=経費に登録済み / ignored=個人用など / matched=Amazon注文と一致（計上不要）
create table if not exists card_charges (
  id uuid primary key default gen_random_uuid(),
  card text not null default 'smbc',
  used_at timestamp not null, -- 日本時間の利用日時
  merchant text not null,
  amount integer not null check (amount > 0),
  mail_message_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'booked', 'ignored', 'matched')),
  created_at timestamptz not null default now()
);

create index if not exists idx_card_charges_status on card_charges (status, used_at);

alter table card_charges enable row level security;
create policy "owner full access" on card_charges
  for all to authenticated using (is_owner()) with check (is_owner());
