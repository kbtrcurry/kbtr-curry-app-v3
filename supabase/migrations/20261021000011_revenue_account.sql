-- v3: 収益の登録で、貸方の科目（売上高・雑収入など）を選べるようにする。
-- 既存の6引数版はそのまま残し、科目つきの7引数版を追加する（追加のみ）。
create or replace function record_platform_revenue(
  p_id uuid,
  p_entry_date date,
  p_segment_id uuid,
  p_gross integer,
  p_fee integer,
  p_memo text,
  p_revenue_account_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_net integer;
  v_cash_account_id uuid;
  v_fee_account_id uuid;
  v_revenue_account_id uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;
  if p_gross <= 0 or p_fee < 0 or p_fee > p_gross then
    raise exception '金額が不正です';
  end if;

  v_net := p_gross - p_fee;

  select id into v_cash_account_id from accounts where code = '102';
  select id into v_fee_account_id from accounts where code = '521';
  if p_revenue_account_id is null then
    select id into v_revenue_account_id from accounts where code = '401';
  else
    select id into v_revenue_account_id from accounts where id = p_revenue_account_id and type = 'revenue';
    if v_revenue_account_id is null then
      raise exception '収益の科目ではありません';
    end if;
  end if;

  delete from journal_entries where source_type = 'platform_revenue' and source_id = p_id;

  insert into journal_entries (id, entry_date, description, segment_id, source_type, source_id)
  values (gen_random_uuid(), p_entry_date, coalesce(p_memo, ''), p_segment_id, 'platform_revenue', p_id)
  returning id into v_entry_id;

  if v_net > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_cash_account_id, 'debit', v_net, coalesce(p_memo, ''));
  end if;

  if p_fee > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_fee_account_id, 'debit', p_fee, coalesce(p_memo, ''));
  end if;

  insert into journal_lines (entry_id, account_id, side, amount, memo) values
    (v_entry_id, v_revenue_account_id, 'credit', p_gross, coalesce(p_memo, ''));

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;
