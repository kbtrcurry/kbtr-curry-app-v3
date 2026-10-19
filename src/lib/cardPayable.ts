// カード払い（未払金 292）の引き落とし予定と、手入力との重複の判定。純粋関数（テスト付き）。
import type { JournalEntry } from './accounting'

export const PAYABLE_CODE = '292'

export type CardCycle = { closingDay: number; payDay: number } // closingDay 0 = 月末締め

const pad = (n: number) => String(n).padStart(2, '0')

/** 利用日から引き落とし予定日を出す（締め日を過ぎた利用は翌月締め → その翌月の payDay） */
export function withdrawalDate(useDate: string, c: CardCycle): string {
  let y = Number(useDate.slice(0, 4))
  let m = Number(useDate.slice(5, 7))
  const d = Number(useDate.slice(8, 10))
  if (c.closingDay > 0 && d > c.closingDay) m += 1 // 締め後の利用は翌月の締めに入る
  m += 1 // 締めた翌月に引き落とし
  while (m > 12) {
    m -= 12
    y += 1
  }
  const last = new Date(y, m, 0).getDate()
  return `${y}-${pad(m)}-${pad(Math.min(c.payDay, last))}`
}

export type CardItem = { entryId: string; date: string; amount: number; description: string; due: string; settled: boolean }

/** 未払金(292)の貸方 = カード払い。借方 = 引き落とし。古い利用から順に引き落とし額を割り当てる */
export function cardPayables(entries: JournalEntry[], c: CardCycle): { items: CardItem[]; paid: number; unpaid: number } {
  const charges: Omit<CardItem, 'settled'>[] = []
  let paid = 0
  for (const e of entries) {
    for (const l of e.journal_lines) {
      if (l.accounts.code !== PAYABLE_CODE) continue
      if (l.side === 'credit') charges.push({ entryId: e.id, date: e.entry_date, amount: l.amount, description: e.description, due: withdrawalDate(e.entry_date, c) })
      else paid += l.amount
    }
  }
  charges.sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId))
  let left = paid
  const items = charges.map((x) => {
    const settled = left >= x.amount
    left = Math.max(0, left - x.amount)
    return { ...x, settled }
  })
  return { items, paid, unpaid: items.filter((i) => !i.settled).reduce((a, i) => a + i.amount, 0) }
}

/** 引き落とし待ちを予定日ごとにまとめる */
export function unpaidByDue(items: CardItem[]): { due: string; amount: number; count: number }[] {
  const m = new Map<string, { due: string; amount: number; count: number }>()
  for (const i of items) {
    if (i.settled) continue
    const g = m.get(i.due) ?? { due: i.due, amount: 0, count: 0 }
    g.amount += i.amount
    g.count += 1
    m.set(i.due, g)
  }
  return [...m.values()].sort((a, b) => a.due.localeCompare(b.due))
}

// ---------- 取り込み と 手入力 の重複 ----------

const IMPORTED = /^(カード:|Amazon:|銀行入金)/

export function isImportedEntry(e: Pick<JournalEntry, 'description'>): boolean {
  return IMPORTED.test(e.description ?? '')
}

export function entryAmount(e: Pick<JournalEntry, 'journal_lines'>): number {
  return e.journal_lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0)
}

const hasType = (e: JournalEntry, t: 'revenue' | 'expense') => e.journal_lines.some((l) => l.accounts.type === t)

/** 手入力で入れた仕訳（取り込み・レジ締め・入金予定以外）。kind が同じもの（経費どうし／収益どうし）だけ */
function isManualOf(e: JournalEntry, kind: 'expense' | 'revenue'): boolean {
  if (isImportedEntry(e)) return false
  if (e.source_type === 'pos_close') return false
  if (e.source_type === 'migration' && e.journal_lines.some((l) => l.accounts.code === '401')) return false // v1のレジ売上
  if (e.journal_lines.some((l) => l.accounts.code === '103')) return false // 入金予定
  return hasType(e, kind)
}

/** 取り込んだ仕訳1件につき、同じ日・同じ金額の手入力の仕訳を1件ずつ対応させる（消す候補） */
export function manualDuplicates(entries: JournalEntry[]): { imported: JournalEntry; manual: JournalEntry }[] {
  const used = new Set<string>()
  const out: { imported: JournalEntry; manual: JournalEntry }[] = []
  for (const imp of entries.filter(isImportedEntry)) {
    const kind = hasType(imp, 'revenue') ? 'revenue' : 'expense'
    const amt = entryAmount(imp)
    const m = entries.find(
      (e) => !used.has(e.id) && e.id !== imp.id && e.entry_date === imp.entry_date && entryAmount(e) === amt && isManualOf(e, kind),
    )
    if (m) {
      used.add(m.id)
      out.push({ imported: imp, manual: m })
    }
  }
  return out
}
