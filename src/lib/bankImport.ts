// 銀行の入出金CSV → プラットフォーム収益（YouTube / note / Amazonアソシエイト）の自動判定。
// 取り込むのは「入金」だけ。出金は対象外。手数料は入金額からは分からないので 0 で登録し、
// 必要なら会計タブで編集する（入金額＝売上総額として計上）。
import { normalize, parseAmount, parseDateLoose } from './csv'

export type BankColumns = {
  headerRow: number
  date: number
  /** 摘要の詳細（相手先など）。無ければ摘要の列 */
  description: number
  /** 摘要内容とは別に「摘要」の列があるとき（種別: 振込・カード など）。摘要内容が空の行で使う */
  summary?: number
  deposit: number
  withdrawal: number
}

const PATTERNS = {
  date: /日付|取引日|年月日|日時|^日$/,
  // 三菱UFJは「摘要」(種別)と「摘要内容」(相手先)の2列。相手先のほうを優先して使う
  detail: /摘要内容|取引内容|お取引内容/,
  description: /摘要|内容|振込人|名義|備考|取扱/,
  deposit: /入金|預入|お預り|預り金額|預かり|収入/,
  withdrawal: /出金|払戻|お支払|支払い?金額|引出|支出/,
}

function firstMatch(cells: string[], re: RegExp, exclude: number[] = []): number {
  return cells.findIndex((c, i) => !exclude.includes(i) && re.test(c))
}

// 先頭の説明行を飛ばして、見出し行と各列の位置を探す。見つからなければ null（画面で手動指定）
export function detectBankColumns(rows: string[][]): BankColumns | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map(normalize)
    const date = firstMatch(cells, PATTERNS.date)
    const deposit = firstMatch(cells, PATTERNS.deposit, [date])
    if (date < 0 || deposit < 0) continue
    const withdrawal = firstMatch(cells, PATTERNS.withdrawal, [date, deposit])
    const taken = [date, deposit, withdrawal]
    const detail = firstMatch(cells, PATTERNS.detail, taken)
    const general = firstMatch(cells, PATTERNS.description, [...taken, detail])
    if (detail >= 0) return { headerRow: i, date, description: detail, summary: general >= 0 ? general : undefined, deposit, withdrawal }
    return { headerRow: i, date, description: general, deposit, withdrawal }
  }
  return null
}

export type BankTxn = {
  date: string
  description: string
  deposit: number
  withdrawal: number
  /** 同じ日付・金額・摘要が複数あっても別の行として扱うための通し番号（0始まり） */
  seq: number
}

export function parseBankRows(rows: string[][], cols: BankColumns): BankTxn[] {
  const out: BankTxn[] = []
  const seen = new Map<string, number>()
  for (const r of rows.slice(cols.headerRow + 1)) {
    const date = parseDateLoose(r[cols.date])
    if (!date) continue
    const detail = cols.description >= 0 ? normalize(r[cols.description] ?? '') : ''
    const description = detail || (cols.summary != null && cols.summary >= 0 ? normalize(r[cols.summary] ?? '') : '')
    const deposit = parseAmount(r[cols.deposit])
    const withdrawal = cols.withdrawal >= 0 ? parseAmount(r[cols.withdrawal]) : 0
    if (deposit === 0 && withdrawal === 0) continue
    const k = `${date}|${deposit}|${withdrawal}|${description}`
    const seq = seen.get(k) ?? 0
    seen.set(k, seq + 1)
    out.push({ date, description, deposit, withdrawal, seq })
  }
  return out
}

export type BankRule = { pattern: string; segment: 'youtube' | 'note' | 'amazon' }

// 摘要は半角カナ(ﾉｰﾄ)のことが多いので NFKC で揃えてから、大文字小文字を無視して部分一致する
export const DEFAULT_BANK_RULES: BankRule[] = [
  { pattern: 'グーグル', segment: 'youtube' },
  { pattern: 'GOOGLE', segment: 'youtube' },
  { pattern: 'ADSENSE', segment: 'youtube' },
  { pattern: 'ノート', segment: 'note' },
  { pattern: 'NOTE', segment: 'note' },
  { pattern: 'アマゾン', segment: 'amazon' },
  { pattern: 'AMAZON', segment: 'amazon' },
]

export function classifyDeposit(description: string, rules: BankRule[]): BankRule['segment'] | null {
  const d = normalize(description).toUpperCase()
  for (const r of rules) {
    const p = normalize(r.pattern).toUpperCase()
    if (p && d.includes(p)) return r.segment
  }
  return null
}

// uuidV5 に渡す名前（同じ行は常に同じID＝再取り込みしても二重登録しない）
export function bankSourceName(t: BankTxn): string {
  return `bank-deposit:${t.date}:${t.deposit}:${t.description}:${t.seq}`
}

// ---------- クレジットカードの引き落とし ----------
// 銀行の出金のうち、カード会社への引き落としは 未払金 / 普通預金 で精算する（カード払いの経費は未払金に計上している）。
// 摘要は半角カナ(ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ など)のことが多いので、NFKC で揃えてから部分一致する。
export const DEFAULT_CARD_WITHDRAWAL_PATTERNS = ['ミツイスミトモ', 'スミトモカード', '三井住友', 'SMBC']

export function isCardWithdrawal(description: string, patterns: string[]): boolean {
  const d = normalize(description).toUpperCase()
  return patterns.some((p) => {
    const q = normalize(p).toUpperCase()
    return q !== '' && d.includes(q)
  })
}

export function cardSettlementSourceName(t: BankTxn): string {
  return `card-settlement:${t.date}:${t.withdrawal}:${t.description}:${t.seq}`
}
