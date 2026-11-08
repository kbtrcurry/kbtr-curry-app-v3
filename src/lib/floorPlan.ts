import { useSyncExternalStore } from 'react'
import { CARD_COUNT } from './tickets'

// 店の間取り。テーブル番号を、格子(GRID_COLS × GRID_ROWS)の上のどこに置くかを決める。
// 端末に保存する(オーダーを取る iPhone で一度整えれば、そのまま使える)。
export type Spot = { n: number; x: number; y: number; w: number; h: number }

export const GRID_COLS = 6
export const GRID_ROWS = 6
const KEY = 'kbtr_v3_floor_plan'

/** 最初の置き方(目安)。上がキッチン側: カウンター4席、2名席3つ、4名席1つ、下がテイクアウト待ち */
export function defaultLayout(): Spot[] {
  const s = (n: number, x: number, y: number, w = 1, h = 1): Spot => ({ n, x, y, w, h })
  return [
    s(1, 0, 0), s(2, 1, 0), s(3, 2, 0), s(4, 3, 0),
    s(5, 0, 2, 2), s(6, 2, 2, 2), s(7, 4, 2, 2),
    s(8, 0, 3, 2, 1),
    s(9, 0, 5), s(10, 1, 5), s(11, 2, 5), s(12, 3, 5),
  ]
}

const overlaps = (a: Spot, b: Spot): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (s: Spot): boolean => s.x >= 0 && s.y >= 0 && s.w >= 1 && s.h >= 1 && s.x + s.w <= GRID_COLS && s.y + s.h <= GRID_ROWS

/** その置き方で、はみ出さず、ほかのテーブルと重ならないか */
export function canPlace(layout: Spot[], spot: Spot): boolean {
  return inside(spot) && layout.every((o) => o.n === spot.n || !overlaps(o, spot))
}

/** テーブルを動かす。右端などではみ出すときは、収まる位置に寄せる。置けなければ null */
export function placeSpot(layout: Spot[], n: number, x: number, y: number): Spot[] | null {
  const cur = layout.find((s) => s.n === n)
  if (!cur) return null
  const next: Spot = { ...cur, x: Math.min(x, GRID_COLS - cur.w), y: Math.min(y, GRID_ROWS - cur.h) }
  return canPlace(layout, next) ? layout.map((s) => (s.n === n ? next : s)) : null
}

/** テーブルの大きさ(横・縦のマス数)を変える。置けなければ null */
export function resizeSpot(layout: Spot[], n: number, w: number, h: number): Spot[] | null {
  const cur = layout.find((s) => s.n === n)
  if (!cur) return null
  const next: Spot = { ...cur, w, h }
  return canPlace(layout, next) ? layout.map((s) => (s.n === n ? next : s)) : null
}

/** 保存されていた内容が壊れていたり、番号が足りなかったりしたら、最初の置き方に戻す */
export function sanitize(raw: unknown): Spot[] {
  if (!Array.isArray(raw)) return defaultLayout()
  const spots: Spot[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') return defaultLayout()
    const { n, x, y, w, h } = r as Record<string, unknown>
    if (![n, x, y, w, h].every((v) => Number.isInteger(v))) return defaultLayout()
    spots.push({ n: n as number, x: x as number, y: y as number, w: w as number, h: h as number })
  }
  const nums = new Set(spots.map((s) => s.n))
  const complete = spots.length === CARD_COUNT && nums.size === CARD_COUNT && Array.from({ length: CARD_COUNT }, (_, i) => i + 1).every((n) => nums.has(n))
  if (!complete) return defaultLayout()
  return spots.every((s) => canPlace(spots, s)) ? spots : defaultLayout()
}

const listeners = new Set<() => void>()
function read(): Spot[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitize(JSON.parse(raw)) : defaultLayout()
  } catch {
    return defaultLayout()
  }
}
let current: Spot[] = read()

export function setFloorPlan(next: Spot[]): void {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 保存できなくても、開いている間は反映する */
  }
  listeners.forEach((l) => l())
}

export function useFloorPlan(): Spot[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
