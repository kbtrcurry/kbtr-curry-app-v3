// 取り込み用CSVの共通処理（銀行・Amazon）。
// 日本のCSVは Shift_JIS のことが多いので、UTF-8として読めなければ Shift_JIS で読み直す。

export function decodeCsvBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('shift_jis').decode(buf)
  }
}

// RFC 4180 準拠の簡易パーサ（引用符内のカンマ・改行・"" に対応）。区切りはカンマ。
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += c
      }
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

// 全角・半角カナ/英数を統一（半角カナの摘要「ﾉｰﾄ」を「ノート」に揃える）
export function normalize(s: string): string {
  return s.normalize('NFKC').trim()
}

// 金額文字列 → 整数円。空・解釈できない値は 0。符号は無視（入金/出金の列で区別する）
export function parseAmount(s: string | undefined): number {
  if (!s) return 0
  const t = normalize(s).replace(/[,¥￥円\s]/g, '')
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : 0
}

// 日付文字列 → 'YYYY-MM-DD'。2026/10/19, 2026-10-19, 2026年10月19日, 20261019, 令和8年10月19日 に対応
export function parseDateLoose(s: string | undefined): string | null {
  if (!s) return null
  const t = normalize(s)
  const pad = (n: number | string) => String(n).padStart(2, '0')
  const valid = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    const dt = new Date(y, m - 1, d)
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
  }
  let m = t.match(/(令和|平成|R|H)\s*(\d{1,2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/)
  if (m) {
    const base = m[1] === '令和' || m[1] === 'R' ? 2018 : 1988
    return valid(base + Number(m[2]), Number(m[3]), Number(m[4]))
  }
  m = t.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

// 登録済みかどうかの判定に使う。journal_entries.source_id は uuid 型なので、
// 取込行の内容から決定的に作ったIDを使う（同じ行は何度取り込んでも同じID）。
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
