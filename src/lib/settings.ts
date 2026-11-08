import { defineSetting } from './sharedSettings'
import { defaultLayout, sanitize as sanitizeLayout, type Spot } from './floorPlan'

// 端末をまたいで共有する設定の一覧。ここで定義したものが、すべての端末にそろう。
export const DEFAULT_UZURA_LABEL = 'うずら'

const floor = defineSetting<Spot[]>('kbtr_v3_floor_plan', defaultLayout(), sanitizeLayout)
export const useFloorPlan = (): Spot[] => floor.use()[0]
export const setFloorPlan = floor.set

const uzura = defineSetting<string>('kbtr_v3_uzura_label', DEFAULT_UZURA_LABEL, (r) => (typeof r === 'string' && r.trim() ? r.trim() : DEFAULT_UZURA_LABEL))
export const useUzuraLabel = (): string => uzura.use()[0]
export const setUzuraLabel = (v: string): void => uzura.set(v.trim() || DEFAULT_UZURA_LABEL)

/** 今日つくるビリヤニの食数 */
const cap = defineSetting<number>('kbtr_v3_reserve_cap', 36, (r) => (Number.isFinite(Number(r)) && Number(r) >= 0 ? Number(r) : 36))
export const useCap = cap.use

/** 「あと何個」を数えるメニュー(ビリヤニ以外)。null は「まだ決めていない」(最初はアチャール) */
const limited = defineSetting<string[] | null>('kbtr_v3_limited_menus', null, (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : null))
export const useLimitedSetting = limited.use
