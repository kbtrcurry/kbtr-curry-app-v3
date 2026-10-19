// 「データ」画面の直接編集で使う、フォーム値 → 更新内容の変換（純粋関数）。
import type { Ingredient, IngredientPatch, RecipePatch } from './masterData'
import type { ClosedSession, SessionPatch } from './analytics'

// 空欄は null、数値でない入力も null（呼び出し側で必須チェックする）
export function toNum(s: string | undefined): number | null {
  const t = (s ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function buildRecipePatch(f: Record<string, string>): RecipePatch {
  return {
    name: f.name.trim(),
    dish_type: f.dish_type,
    servings: toNum(f.servings),
    yield_g: toNum(f.yield_g),
    serving_weight_g: toNum(f.serving_weight_g),
    sale_price: toNum(f.sale_price),
    memo: f.memo ?? '',
  }
}

// 食材一覧の画面と同じ規約: 単品重量・単品価格が変わって両方そろえば、単価(円/g)を再計算する
export function buildIngredientPatch(orig: Ingredient, f: Record<string, string>): IngredientPatch {
  const pack_weight_g = toNum(f.pack_weight_g)
  const pack_price = toNum(f.pack_price)
  const patch: IngredientPatch = {
    name: f.name.trim(),
    category: f.category.trim(),
    unit: f.unit.trim() || 'g',
    supplier: f.supplier.trim(),
    pack_weight_g,
    pack_price,
    stock_g: toNum(f.stock_g) ?? 0,
    alert_threshold_g: toNum(f.alert_threshold_g),
    memo: f.memo ?? '',
  }
  const packChanged = pack_weight_g !== orig.pack_weight_g || pack_price !== orig.pack_price
  if (packChanged && pack_weight_g && pack_weight_g > 0 && pack_price !== null) {
    patch.unit_price_per_g = Math.round((pack_price / pack_weight_g) * 10000) / 10000
  }
  return patch
}

export function buildSessionPatch(orig: ClosedSession, f: Record<string, string>): SessionPatch {
  const patch: SessionPatch = {
    rent: toNum(f.rent) ?? 0,
    other_cost: toNum(f.other_cost) ?? 0,
    groups: toNum(f.groups) ?? 0,
    people: toNum(f.people) ?? 0,
    reserved_people: toNum(f.reserved_people) ?? 0,
    memo: f.memo ?? '',
  }
  // labor_hours 列が無い環境(migration 05 未適用)でも保存が失敗しないよう、入力があるときだけ送る
  const labor = toNum(f.labor_hours)
  if (labor !== null || orig.labor_hours != null) patch.labor_hours = labor
  return patch
}
