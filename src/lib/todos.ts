// ホームの「やること」: 取り込み・確認・締め忘れなど、手を付ける必要があるものを集める。
// 判定は純粋関数 buildTodos（テスト付き）。データの取得は useTodos。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { monthRange, todayStr } from './accounting'

export type TodoLevel = 'warn' | 'info'
export type Todo = { id: string; level: TodoLevel; title: string; detail?: string; to: string; cta: string }

export type TodoInput = {
  cardPending: number
  amazonPending: number
  /** カード・Amazonの候補を最後に取り込んだ日時（ISO）。一度もなければ null */
  lastMailImport: string | null
  /** Meta広告データの最新日 */
  metaLastDate: string | null
  /** 締めていない、今日より前の営業の日付 */
  openSessionDates: string[]
  /** 入金予定日を過ぎた（自動入金しない）入金予定の件数 */
  overdueReceivables: number
  /** 今月の営業回数と、今月会計に入っている仕入(501)の合計 */
  monthSessions: number
  monthFoodRecorded: number
  /** 銀行CSVの明細の最終日（この端末で取り込んだもの） */
  bankLastDate: string | null
}

const BANK_KEY = 'kbtr_v3_bank_last_date'

export function markBankImported(lastDate: string): void {
  try {
    const prev = localStorage.getItem(BANK_KEY)
    if (!prev || prev < lastDate) localStorage.setItem(BANK_KEY, lastDate)
  } catch {
    // 保存できない環境では何もしない
  }
}
function readBankLastDate(): string | null {
  try {
    return localStorage.getItem(BANK_KEY)
  } catch {
    return null
  }
}

export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
  return Math.round((ms(to) - ms(from)) / 86400000)
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

export function buildTodos(i: TodoInput, today: string): Todo[] {
  const out: Todo[] = []
  if (i.openSessionDates.length > 0) {
    out.push({
      id: 'open-session',
      level: 'warn',
      title: `レジ締めしていない営業があります（${i.openSessionDates.map(md).join('・')}）`,
      detail: '会計はあるのに締めていないので、売上・場所代が会計に入っていません。営業履歴から後で締められます。',
      to: '/history',
      cta: '営業履歴で締める',
    })
  }
  if (i.cardPending > 0) {
    out.push({ id: 'card', level: 'warn', title: `カードの利用 ${i.cardPending}件が振り分け待ち`, detail: '事業用なら経費に、個人用なら除外。', to: '/import?tab=card', cta: '振り分ける' })
  }
  if (i.amazonPending > 0) {
    out.push({ id: 'amazon', level: 'warn', title: `Amazonの注文 ${i.amazonPending}件が確認待ち`, to: '/import?tab=mail', cta: '確認する' })
  }
  if (i.overdueReceivables > 0) {
    out.push({ id: 'receivable', level: 'warn', title: `入金予定日を過ぎた入金予定が ${i.overdueReceivables}件`, detail: '入金されたか口座を確認して、入金済みにしてください。', to: '/accounting?tab=receivable', cta: '確認する' })
  }
  const mailDays = i.lastMailImport ? daysBetween(i.lastMailImport.slice(0, 10), today) : null
  if (mailDays == null || mailDays >= 3) {
    out.push({
      id: 'mail',
      level: 'info',
      title: mailDays == null ? 'メールからの取り込みがまだです' : `メールからの取り込みが ${mailDays}日前で止まっています`,
      detail: 'カード利用・Amazon注文のメールを読み込みます。',
      to: '/import?tab=card',
      cta: 'メールから更新',
    })
  }
  if (i.monthSessions > 0 && i.monthFoodRecorded === 0) {
    out.push({
      id: 'food',
      level: 'info',
      title: '今月の食材の仕入が会計に入っていません',
      detail: 'カード払いは取り込みで振り分け、現金で買った分は経費入力（仕入高）から。',
      to: '/accounting?tab=expense',
      cta: '経費を入力',
    })
  }
  const bankDays = i.bankLastDate ? daysBetween(i.bankLastDate, today) : null
  if (bankDays == null || bankDays >= 35) {
    out.push({
      id: 'bank',
      level: 'info',
      title: bankDays == null ? '銀行の明細（CSV）をまだ取り込んでいません' : `銀行の明細は ${md(i.bankLastDate as string)} までです`,
      detail: 'YouTube・note・Amazonアソシエイトの入金とカードの引き落としが入ります（月1回が目安）。',
      to: '/import?tab=bank',
      cta: 'CSVを取り込む',
    })
  }
  const metaDays = i.metaLastDate ? daysBetween(i.metaLastDate, today) : null
  if (metaDays != null && metaDays >= 4) {
    out.push({
      id: 'meta',
      level: 'info',
      title: `Meta広告のデータが ${md(i.metaLastDate as string)} までです`,
      detail: 'PCのClaudeに「Meta広告を更新して」と頼んでください。',
      to: '/ads',
      cta: '広告を見る',
    })
  }
  return out
}

async function count(table: string, build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number> {
  const { count: c, error } = await build(base(table))
  if (error) throw error
  return c ?? 0
}
function base(table: string) {
  return supabase.from(table).select('*', { count: 'exact', head: true })
}
async function latest(table: string, col: string): Promise<string | null> {
  const { data, error } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1)
  if (error) throw error
  const row = (data ?? [])[0] as unknown as Record<string, string> | undefined
  return row ? row[col] : null
}

export async function fetchTodoInput(): Promise<TodoInput> {
  const today = todayStr()
  const month = monthRange(today.slice(0, 7))
  const [cardPending, amazonPending, card, amazon, metaLastDate, open, overdue, monthSessions, food] = await Promise.all([
    count('card_charges', (q) => q.eq('status', 'pending')),
    count('amazon_orders', (q) => q.eq('status', 'pending')),
    latest('card_charges', 'created_at'),
    latest('amazon_orders', 'created_at'),
    latest('meta_ads_daily', 'date'),
    // レジを開いただけの空の営業は除き、会計（レシート）がある営業だけ
    supabase
      .from('sales_sessions')
      .select('session_date, receipts!inner(id)')
      .eq('status', 'open')
      .eq('receipts.voided', false)
      .lt('session_date', today),
    count('receivables', (q) => q.eq('status', 'open').eq('auto_settle', false).lt('expected_date', today)),
    count('sales_sessions', (q) => q.eq('status', 'closed').gte('session_date', month.from).lte('session_date', month.to)),
    supabase
      .from('journal_lines')
      .select('amount, side, accounts!inner(code), journal_entries!inner(entry_date)')
      .eq('accounts.code', '501')
      .gte('journal_entries.entry_date', month.from)
      .lte('journal_entries.entry_date', month.to),
  ])
  if (open.error) throw open.error
  if (food.error) throw food.error
  const lastMailImport = [card, amazon].filter((x): x is string => !!x).sort().pop() ?? null
  const monthFoodRecorded = ((food.data ?? []) as { amount: number; side: string }[]).reduce(
    (a, l) => a + (l.side === 'debit' ? l.amount : -l.amount),
    0,
  )
  return {
    cardPending,
    amazonPending,
    lastMailImport,
    metaLastDate,
    openSessionDates: [...new Set(((open.data ?? []) as { session_date: string }[]).map((r) => r.session_date))].sort(),
    overdueReceivables: overdue,
    monthSessions,
    monthFoodRecorded,
    bankLastDate: readBankLastDate(),
  }
}

export function useTodos() {
  return useQuery({
    queryKey: ['todos'],
    queryFn: async () => buildTodos(await fetchTodoInput(), todayStr()),
    staleTime: 30_000,
  })
}
