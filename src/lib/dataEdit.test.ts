import { describe, it, expect } from 'vitest'
import { toNum, buildRecipePatch, buildIngredientPatch, buildSessionPatch } from './dataEdit'
import type { Ingredient } from './masterData'
import type { ClosedSession } from './analytics'

describe('toNum', () => {
  it('空欄・数値でない入力は null', () => {
    expect(toNum('')).toBeNull()
    expect(toNum('  ')).toBeNull()
    expect(toNum('abc')).toBeNull()
    expect(toNum(undefined)).toBeNull()
    expect(toNum('12.5')).toBe(12.5)
    expect(toNum('0')).toBe(0)
  })
})

describe('buildRecipePatch', () => {
  it('名前の前後の空白を除き、空欄の数値は null にする', () => {
    const p = buildRecipePatch({ name: ' チキンカレー ', dish_type: 'カレー', servings: '', yield_g: '3000', serving_weight_g: '', sale_price: '1200', memo: '' })
    expect(p).toMatchObject({ name: 'チキンカレー', servings: null, yield_g: 3000, sale_price: 1200 })
  })
})

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 'i1',
  name: '玉ねぎ',
  category: '野菜',
  unit: 'g',
  unit_price_per_g: 0.5,
  pack_weight_g: 1000,
  pack_price: 500,
  stock_g: 100,
  alert_threshold_g: null,
  supplier: '',
  memo: '',
  created_at: '',
  ...over,
})
const form = (over: Record<string, string>) => ({
  name: '玉ねぎ',
  category: '野菜',
  unit: 'g',
  supplier: '',
  pack_weight_g: '1000',
  pack_price: '500',
  stock_g: '100',
  alert_threshold_g: '',
  memo: '',
  ...over,
})

describe('buildIngredientPatch', () => {
  it('単品価格が変わったら単価(円/g)を再計算する', () => {
    const p = buildIngredientPatch(ing({}), form({ pack_price: '600' }))
    expect(p.unit_price_per_g).toBe(0.6)
  })
  it('単品重量・価格が変わっていなければ単価は触らない（手動で設定した単価を守る）', () => {
    const p = buildIngredientPatch(ing({ unit_price_per_g: 0.45 }), form({ name: '新玉ねぎ' }))
    expect('unit_price_per_g' in p).toBe(false)
    expect(p.name).toBe('新玉ねぎ')
  })
  it('重量が空なら単価は計算しない。在庫の空欄は 0', () => {
    const p = buildIngredientPatch(ing({}), form({ pack_weight_g: '', stock_g: '' }))
    expect('unit_price_per_g' in p).toBe(false)
    expect(p.stock_g).toBe(0)
    expect(p.pack_weight_g).toBeNull()
  })
})

describe('buildSessionPatch', () => {
  const s = { labor_hours: null } as ClosedSession
  const f = { rent: '7000', other_cost: '', groups: '10', people: '12', reserved_people: '', memo: 'm', labor_hours: '' }
  it('労働時間が空で元も未入力なら labor_hours を送らない', () => {
    const p = buildSessionPatch(s, f)
    expect('labor_hours' in p).toBe(false)
    expect(p).toMatchObject({ rent: 7000, other_cost: 0, people: 12, reserved_people: 0 })
  })
  it('労働時間を入力したら送る。元が入力済みで空にしたら null で消す', () => {
    expect(buildSessionPatch(s, { ...f, labor_hours: '4.5' }).labor_hours).toBe(4.5)
    expect(buildSessionPatch({ labor_hours: 3 } as ClosedSession, f).labor_hours).toBeNull()
  })
  it('営業日と事業区分を直すと更新内容に入る（会計の仕訳も直すための値）', () => {
    const p = buildSessionPatch(s, { ...f, session_date: '2026-10-18', segment_id: 'seg-1' })
    expect(p).toMatchObject({ session_date: '2026-10-18', segment_id: 'seg-1' })
  })
  it('営業日が空・形式不正なら送らない（元の日付のまま）。事業区分が空でも同様', () => {
    const p = buildSessionPatch(s, { ...f, session_date: '2026/10/18', segment_id: '' })
    expect('session_date' in p).toBe(false)
    expect('segment_id' in p).toBe(false)
    expect('session_date' in buildSessionPatch(s, f)).toBe(false)
  })
})
