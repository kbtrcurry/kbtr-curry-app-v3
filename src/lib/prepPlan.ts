// 仕込み計画: メニューごとの食数 → 必要な材料と概算金額。純粋関数（テスト付き）。
import { TAX, effectiveServings, ingredientPricePerG, type MenuComponentRow, type RecipeIngredientRow } from './masterData'

export type NeedRow = {
  ingredientId: string
  name: string
  unit: string
  qty: number
  /** 概算金額（税込）。単価が未設定なら null */
  cost: number | null
  supplier: string
  category: string
}

/** 1つのレシピを「何倍」作ればよいか。食数(servings)を基準にする。食数が決まっていないレシピは、食数＝倍数として扱う */
export function recipeMultiplier(recipe: MenuComponentRow['recipes'], servingsNeeded: number): number {
  const eff = effectiveServings(recipe)
  return eff && eff > 0 ? servingsNeeded / eff : servingsNeeded
}

export type PlanInput = {
  /** メニューID → 食数 */
  menuQty: Record<string, number>
  /** メニューを作るレシピ（メニュー1食あたり c.servings 食分） */
  components: MenuComponentRow[]
  recipeItems: Record<string, RecipeIngredientRow[]>
  /** メニューにないレシピを単体で仕込む分（レシピID → 倍数） */
  extraMult?: Record<string, number>
  ingredientInfo?: Map<string, { supplier: string; category: string }>
}

export function ingredientNeeds(p: PlanInput): NeedRow[] {
  const acc = new Map<string, NeedRow>()
  const add = (items: RecipeIngredientRow[], mult: number) => {
    for (const it of items) {
      const qty = it.quantity * mult
      if (!(qty > 0)) continue
      const per = ingredientPricePerG(it.ingredients)
      const cost = per != null ? qty * per * TAX : null
      const info = p.ingredientInfo?.get(it.ingredient_id)
      const prev = acc.get(it.ingredient_id)
      if (prev) {
        prev.qty += qty
        prev.cost = prev.cost == null || cost == null ? (prev.cost ?? cost) : prev.cost + cost
      } else {
        acc.set(it.ingredient_id, {
          ingredientId: it.ingredient_id,
          name: it.ingredients.name,
          unit: it.unit || 'g',
          qty,
          cost,
          supplier: info?.supplier ?? '',
          category: info?.category ?? '',
        })
      }
    }
  }
  for (const c of p.components) {
    const q = p.menuQty[c.menu_id] ?? 0
    if (!(q > 0)) continue
    add(p.recipeItems[c.recipe_id] ?? [], recipeMultiplier(c.recipes, c.servings * q))
  }
  for (const [rid, m] of Object.entries(p.extraMult ?? {})) if (m > 0) add(p.recipeItems[rid] ?? [], m)
  return [...acc.values()]
}

/** 仕入先ごと（未設定は「仕入先未設定」）にまとめる。大きい出費の店が先 */
export function groupBySupplier(rows: NeedRow[]): { supplier: string; rows: NeedRow[]; cost: number }[] {
  const m = new Map<string, NeedRow[]>()
  for (const r of rows) m.set(r.supplier || '仕入先未設定', [...(m.get(r.supplier || '仕入先未設定') ?? []), r])
  return [...m.entries()]
    .map(([supplier, rs]) => ({ supplier, rows: rs.sort((a, b) => a.name.localeCompare(b.name, 'ja')), cost: rs.reduce((a, r) => a + (r.cost ?? 0), 0) }))
    .sort((a, b) => (a.supplier === '仕入先未設定' ? 1 : b.supplier === '仕入先未設定' ? -1 : b.cost - a.cost))
}

/** 量の表示: 1000g以上は kg */
export function fmtQty(qty: number, unit: string): string {
  if ((unit === 'g' || unit === '') && qty >= 1000) return `${(Math.round(qty / 10) / 100).toLocaleString()}kg`
  return `${(Math.round(qty * 10) / 10).toLocaleString()}${unit || 'g'}`
}
