// 表示用の整形（分析ページ用）
export const yen = (n: number): string => `${n < 0 ? '−' : ''}¥${Math.round(Math.abs(n)).toLocaleString()}`

// 符号つき（増減の表示用）
export const signedYen = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}¥${Math.round(Math.abs(n)).toLocaleString()}`

export const percent = (n: number, digits = 1): string => `${n.toFixed(digits)}%`

// 軸ラベル用の短縮（12,345 → 1.2万）
export function shortYen(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 10_000) return `${sign}${(a / 10_000).toFixed(a >= 100_000 ? 0 : 1)}万`
  return `${sign}${Math.round(a).toLocaleString()}`
}
