import { defineSetting } from './sharedSettings'
import { setExtraConfig } from './reservations'
import { sanitizeLayout as sanitizePosLayout } from './posLayout'
import { EMPTY_LEARNED, sanitizeLearned, type DmLearned } from './dmLearning'
import { defaultLayout, sanitize as sanitizeLayout, type Spot } from './floorPlan'

// 端末をまたいで共有する設定の一覧。ここで定義したものが、すべての端末にそろう。
const floor = defineSetting<Spot[]>('kbtr_v3_floor_plan', defaultLayout(), sanitizeLayout)
export const useFloorPlan = (): Spot[] => floor.use()[0]
export const setFloorPlan = floor.set

/** レジのメニューボタンの置き場所(メニューIDの並び。null は空白。null全体は、メニューの順) */
const posLayout = defineSetting<(string | null)[] | null>('kbtr_v3_pos_layout', null, sanitizePosLayout)
export const usePosLayout = posLayout.use

/** 取り置きのDMの読み取りで、直した内容から覚えたこと(名前の前後・品の言い方) */
const dmLearned = defineSetting<DmLearned>('kbtr_v3_dm_learned', EMPTY_LEARNED, sanitizeLearned)
export const useDmLearned = dmLearned.use
export const getDmLearned = dmLearned.get

/** 今日つくるビリヤニの食数 */
const cap = defineSetting<number>('kbtr_v3_reserve_cap', 36, (r) => (Number.isFinite(Number(r)) && Number(r) >= 0 ? Number(r) : 36))
export const useCap = cap.use

/** 「あと何個」を数えるメニュー(ビリヤニ以外)。null は「まだ決めていない」(最初はアチャール) */
const limited = defineSetting<string[] | null>('kbtr_v3_limited_menus', null, (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : null))
export const useLimitedSetting = limited.use

/** ビリヤニの皿に付けられる品(メニューID)。null は、名前で判断する(パクチー・赤玉・ライタ・アチャール・増量) */
const attachable = defineSetting<string[] | null>('kbtr_v3_attachable_menus', null, (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : null))
export const useAttachableSetting = attachable.use
/** 設定を読んで、判定に反映する(皿に付ける品を使う画面で呼ぶ) */
export function useAttachableIds(): string[] | null {
  const [ids] = attachable.use()
  setExtraConfig(ids)
  return ids
}
