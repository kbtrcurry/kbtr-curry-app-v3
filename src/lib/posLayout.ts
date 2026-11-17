// レジのメニューボタンの置き場所。好きな場所に置けて、空白(何も置かない場所)も作れる。
// 保存する形: メニューIDの並び。null は空白。端末をまたいで共有する(settings.ts)。
export const BLANK = '__blank:'
export const isBlankCell = (cell: string): boolean => cell.startsWith(BLANK)

/** 保存した配置を、いまのメニューに合わせて「マス」の並びにする。消えたメニューは外し、新しいメニューは最後に足す。空白は __blank:番号 */
export function cellsFromLayout(menuIds: string[], layout: (string | null)[] | null): string[] {
  if (!layout) return [...menuIds]
  const known = new Set(menuIds)
  const seen = new Set<string>()
  const out: string[] = []
  layout.forEach((c, i) => {
    if (c === null) out.push(`${BLANK}${i}`)
    else if (known.has(c) && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  })
  for (const id of menuIds) if (!seen.has(id)) out.push(id)
  return out
}

/** マスの並びを、保存する形にする(最後の空白は意味がないので落とす) */
export function layoutFromCells(cells: string[]): (string | null)[] {
  const out = cells.map((c) => (isBlankCell(c) ? null : c))
  while (out.length > 0 && out[out.length - 1] === null) out.pop()
  return out
}

/** 空白を、まだ使っていない番号で作る */
export function newBlank(cells: string[]): string {
  let n = 0
  while (cells.includes(`${BLANK}${n}`)) n++
  return `${BLANK}${n}`
}

export function sanitizeLayout(raw: unknown): (string | null)[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((x): x is string | null => x === null || typeof x === 'string')
}
