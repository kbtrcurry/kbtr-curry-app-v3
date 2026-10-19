-- v3: レジ締め後に営業を直したとき（日付・事業区分・場所代・その他経費・売上の明細）、会計の仕訳も作り直す。
-- これまでは sales_sessions だけが更新され、仕訳（pos_close）が古いまま残っていた。
-- 追加のみ（既存の関数は変更しない）。

-- 1) 締め済みの営業の仕訳を、いまの営業の値から作り直す（close_session と同じ組み立て）
--    対象の仕訳は pos_close と、v1からの移行(migration)で同じ営業に紐づくもの
create or replace function resync_session_journal(p_session_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_s sales_sessions%rowtype;
  v_sales bigint;
  v_entry_id uuid;
  v_cash uuid;
  v_sales_acct uuid;
  v_rent_acct uuid;
  v_misc_acct uuid;
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  select * into v_s from sales_sessions where id = p_session_id for update;
  if not found then
    raise exception '営業セッションが見つかりません: %', p_session_id;
  end if;
  if v_s.status <> 'closed' then
    return null; -- 締める前は仕訳がない
  end if;

  select coalesce(sum(total), 0) into v_sales from receipts where session_id = p_session_id and not voided;

  select id into v_cash from accounts where code = '101';
  select id into v_sales_acct from accounts where code = '401';
  select id into v_rent_acct from accounts where code = '511';
  select id into v_misc_acct from accounts where code = '529';

  delete from journal_entries where source_id = p_session_id and source_type in ('pos_close', 'migration');

  insert into journal_entries (entry_date, description, segment_id, source_type, source_id)
  values (v_s.session_date, '営業売上 ' || to_char(v_s.session_date, 'YYYY-MM-DD'), v_s.segment_id, 'pos_close', p_session_id)
  returning id into v_entry_id;

  if v_sales > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_cash, 'debit', v_sales::integer, '現金売上'),
      (v_entry_id, v_sales_acct, 'credit', v_sales::integer, '');
  end if;
  if v_s.rent > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_rent_acct, 'debit', v_s.rent, '場所代'),
      (v_entry_id, v_cash, 'credit', v_s.rent, '場所代支払');
  end if;
  if v_s.other_cost > 0 then
    insert into journal_lines (entry_id, account_id, side, amount, memo) values
      (v_entry_id, v_misc_acct, 'debit', v_s.other_cost, '当日その他経費'),
      (v_entry_id, v_cash, 'credit', v_s.other_cost, 'その他経費支払');
  end if;

  if not exists (select 1 from journal_lines where entry_id = v_entry_id) then
    delete from journal_entries where id = v_entry_id;
    return null;
  end if;

  perform assert_entry_balanced(v_entry_id);
  return v_entry_id;
end;
$$;

-- 2) 営業の項目を直して、仕訳も作り直す（1回の処理で両方）。p_patch に入れた項目だけ更新する
create or replace function update_closed_session(p_session_id uuid, p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception '権限がありません';
  end if;

  update sales_sessions
     set session_date = coalesce((p_patch ->> 'session_date')::date, session_date),
         segment_id = coalesce((p_patch ->> 'segment_id')::uuid, segment_id),
         rent = coalesce((p_patch ->> 'rent')::integer, rent),
         other_cost = coalesce((p_patch ->> 'other_cost')::integer, other_cost),
         groups = coalesce((p_patch ->> 'groups')::integer, groups),
         people = coalesce((p_patch ->> 'people')::integer, people),
         reserved_people = coalesce((p_patch ->> 'reserved_people')::integer, reserved_people),
         memo = coalesce(p_patch ->> 'memo', memo),
         labor_hours = case when p_patch ? 'labor_hours' then (p_patch ->> 'labor_hours')::numeric else labor_hours end
   where id = p_session_id;
  if not found then
    raise exception '営業セッションが見つかりません: %', p_session_id;
  end if;

  perform resync_session_journal(p_session_id);
end;
$$;

-- 3) 過去のズレの修復（一度だけ実行済み）: 仕訳と営業の値が合わなかった pos_close の営業5件
--    (2026-09-05, 09-12, 09-27, 10-10, 10-17) に resync_session_journal を実行した。
--    v1から移行した営業(migration)の仕訳は触っていない（2026-05-30 だけ売上が 仕訳28,300円 / レシート29,300円 と食い違うまま）。
