import { defineSetting } from './sharedSettings'
import { setExtraConfig } from './reservations'
import { defaultLayout, sanitize as sanitizeLayout, type Spot } from './floorPlan'

// 端末をまたいで共有する設定の一覧。ここで定義したものが、すべての端末にそろう。
const floor = defineSetting<Spot[]>('kbtr_v3_floor_plan', defaultLayout(), sanitizeLayout)
export const useFloorPlan = (): Spot[] => floor.use()[0]
export const setFloorPlan = floor.set

/** 今日つくるビリヤニの食数 */
const cap = defineSetting<number>('kbtr_v3_reserve_cap', 36, (r) => (Number.isFinite(Number(r)) && Number(r) >= 0 ? Number(r) : 36))
export const useCap = cap.use

/** 「あと何個」を数えるメニュー(ビリヤニ以外)。null は「まだ決めていない」(最初はアチャール) */
const limited = defineSetting<string[] | null>('kbtr_v3_limited_menus', null, (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : null))
export const useLimitedSetting = limited.use

/** ビリヤニの皿に付けられる品(メニューID)。null は、名前で判断する(パクチー・赤玉・ライタ・アチャール・ソーダ・増量) */
const attachable = defineSetting<string[] | null>('kbtr_v3_attachable_menus', null, (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : null))
export const useAttachableSetting = attachable.use
/** 設定を読んで、判定に反映する(皿に付ける品を使う画面で呼ぶ) */
export function useAttachableIds(): string[] | null {
  const [ids] = attachable.use()
  setExtraConfig(ids)
  return ids
}
