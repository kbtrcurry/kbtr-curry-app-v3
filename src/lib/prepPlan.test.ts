import { describe, it, expect } from 'vitest'
import { ingredientNeeds, groupBySupplier, fmtQty, recipeMultiplier } from './prepPlan'
import type { MenuComponentRow, RecipeIngredientRow } from './masterData'

const recipe = (servings: number | null) => ({ name: 'r', servings, yield_g: null, serving_weight_g: null })
const comp = (menu: string, rid: string, servings: number, rs: number | null): MenuComponentRow => ({ id: menu + rid, menu_id: menu, recipe_id: rid, servings, recipes: recipe(rs) })
const item = (rid: string, ing: string, name: string, quantity: number, per: number | null): RecipeIngredientRow =>
  ({ id: rid + ing, recipe_id: rid, ingredient_id: ing, quantity, unit: 'g', memo: '', ingredients: { name, unit_price_per_g: per, pack_weight_g: null, pack_price: null } }) as RecipeIngredientRow

describe('recipeMultiplier', () => {
  it('必要食数 ÷ レシピの食数。食数なしは食数＝倍数', () => {
    expect(recipeMultiplier(recipe(10), 25)).toBe(2.5)
    expect(recipeMultiplier(recipe(null), 3)).toBe(3)
  })
})

describe('ingredientNeeds', () => {
  const items = { r1: [item('r1', 'i1', '鶏もも', 1000, 1), item('r1', 'i2', '玉ねぎ', 500, 0.5)], r2: [item('r2', 'i1', '鶏もも', 200, 1)] }
  const components = [comp('m1', 'r1', 1, 10), comp('m2', 'r2', 1, 4)]
  it('メニューの食数から、同じ食材を合算して必要量と概算金額を出す', () => {
    const rows = ingredientNeeds({ menuQty: { m1: 20, m2: 8 }, components, recipeItems: items })
    const chicken = rows.find((r) => r.name === '鶏もも')!
    expect(chicken.qty).toBe(2000 + 400)
    expect(chicken.cost).toBeCloseTo(2400 * 1.08)
    expect(rows.find((r) => r.name === '玉ねぎ')!.qty).toBe(1000)
  })
  it('食数0のメニューは含めない。単品レシピの倍数も足せる', () => {
    expect(ingredientNeeds({ menuQty: { m1: 0 }, components, recipeItems: items })).toEqual([])
    const rows = ingredientNeeds({ menuQty: {}, components, recipeItems: items, extraMult: { r2: 2 } })
    expect(rows.map((r) => [r.name, r.qty])).toEqual([['鶏もも', 400]])
  })
  it('単価が未設定なら金額は null', () => {
    const rows = ingredientNeeds({ menuQty: { m1: 10 }, components: [comp('m1', 'r3', 1, 10)], recipeItems: { r3: [item('r3', 'i9', '謎', 100, null)] } })
    expect(rows[0].cost).toBeNull()
  })
})

describe('groupBySupplier / fmtQty', () => {
  it('仕入先ごと。未設定は最後', () => {
    const g = groupBySupplier([
      { ingredientId: 'a', name: 'a', unit: 'g', qty: 1, cost: 100, supplier: '', category: '' },
      { ingredientId: 'b', name: 'b', unit: 'g', qty: 1, cost: 500, supplier: 'ベルク', category: '' },
    ])
    expect(g.map((x) => x.supplier)).toEqual(['ベルク', '仕入先未設定'])
  })
  it('1000g以上は kg', () => {
    expect(fmtQty(2400, 'g')).toBe('2.4kg')
    expect(fmtQty(250, 'g')).toBe('250g')
    expect(fmtQty(3, '個')).toBe('3個')
  })
})
