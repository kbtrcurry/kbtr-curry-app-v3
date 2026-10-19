// 横断「データ」画面の検索・並べ替え（純粋関数）。
import { normalize } from './csv'

// 全角/半角・大文字小文字を区別せず、空白区切りの語をすべて含む行だけに絞る（AND検索）
export function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const terms = normalize(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return true
  const hay = fields.map((f) => normalize(f ?? '').toLowerCase()).join('\n')
  return terms.every((t) => hay.includes(t))
}

// 値が null のものは昇順・降順どちらでも最後に置く
export function sortRows<T>(rows: T[], get: (r: T) => number | string | null, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (typeof x === 'string' && typeof y === 'string') return sign * x.localeCompare(y, 'ja')
    return sign * (Number(x) - Number(y))
  })
}
