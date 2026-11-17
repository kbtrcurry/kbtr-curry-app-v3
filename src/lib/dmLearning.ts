// 取り置きのDMの読み取りを、直した内容から覚えていく。
//  ・名前: 直した名前が文面のどこにあったか(前後の言葉)を覚える
//  ・メニュー: 読み取れなかった(または間違えた)品の言い方を、メニューに結びつけて覚える
import type { ResItem } from './reservations'

export type LearnedAlias = { word: string; menu_id: string; menu_name: string }
export type LearnedName = { l: string; r: string }
export type DmLearned = { aliases: LearnedAlias[]; names: LearnedName[] }
export const EMPTY_LEARNED: DmLearned = { aliases: [], names: [] }

export function sanitizeLearned(raw: unknown): DmLearned {
  const o = (raw ?? {}) as Partial<DmLearned>
  return {
    aliases: Array.isArray(o.aliases) ? o.aliases.filter((a) => a && typeof a.word === 'string' && typeof a.menu_name === 'string').slice(0, 200) : [],
    names: Array.isArray(o.names) ? o.names.filter((n) => n && typeof n.l === 'string' && typeof n.r === 'string').slice(0, 100) : [],
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = (s: string) => s.normalize('NFKC').replace(/エビ|えび/g, '海老')

/** 覚えた前後の言葉から、名前を探す */
export function learnedName(text: string, learned: DmLearned): string {
  const t = norm(text)
  for (const { l, r } of learned.names) {
    const m = new RegExp(esc(l) + '[ \\t]*([^\\s、。,!！?？\\d]{1,10})' + (r ? esc(r) : '')).exec(t)
    if (m && m[1]) return m[1].replace(/(?:さん|様)$/, '')
  }
  return ''
}

/** 覚えた言い方で見つかる品(メニューのIDか名前で、いまのメニューから探す) */
export function learnedItems(text: string, learned: DmLearned, menus: { id: string; name: string }[], skip: Set<string>, qtyAfter: (t: string, from: number) => number): ResItem[] {
  const t = norm(text)
  const out: ResItem[] = []
  for (const a of learned.aliases) {
    const m = menus.find((x) => x.id === a.menu_id) ?? menus.find((x) => x.name === a.menu_name)
    if (!m || skip.has(m.id) || out.some((o) => o.menu_id === m.id)) continue
    const at = t.indexOf(norm(a.word))
    if (at < 0) continue
    out.push({ menu_id: m.id, name: m.name, qty: qtyAfter(t, at + norm(a.word).length) })
  }
  return out
}

type Snap = { name: string; items: { menu_id: string | null; qty: number; takeout?: boolean }[] }

const sameItems = (a: Snap['items'], b: Snap['items']) => {
  const key = (i: Snap['items'][number]) => `${i.menu_id}|${i.takeout ? 'T' : 'E'}|${i.qty}`
  return a.map(key).sort().join(',') === b.map(key).sort().join(',')
}

/**
 * 読み取り結果(parsed)と、直したあとの内容(final)の違いから、覚えることを足す。
 * 違いがなければ、そのまま返す。何を覚えたかの短い説明も返す。
 */
export function learnFromCorrection(
  text: string,
  menus: { id: string; name: string }[],
  parsed: Snap,
  final: Snap,
  learned: DmLearned,
): { learned: DmLearned; notes: string[] } {
  const t = norm(text)
  const notes: string[] = []
  let next = learned

  // 名前
  const fname = norm(final.name).trim()
  if (fname && fname !== norm(parsed.name).trim()) {
    const at = t.indexOf(fname)
    if (at >= 0) {
      const lineStart = t.lastIndexOf('\n', at - 1) + 1
      const lineEnd = (() => {
        const e = t.indexOf('\n', at)
        return e < 0 ? t.length : e
      })()
      const l = t.slice(Math.max(lineStart, at - 4), at).trim() ? t.slice(Math.max(lineStart, at - 4), at) : ''
      const r = t.slice(at + fname.length, Math.min(lineEnd, at + fname.length + 3))
      const ctxL = l.replace(/^\s+/, '')
      if ((ctxL || r) && !next.names.some((n) => n.l === ctxL && n.r === r)) {
        next = { ...next, names: [...next.names, { l: ctxL, r }] }
        notes.push(`名前: 「${ctxL}」と「${r}」のあいだ → ${final.name}`)
      }
    }
  }

  // 品: 読み取れなかった品の言い方を、メニューに結びつける
  if (!sameItems(parsed.items, final.items)) {
    const have = new Set(parsed.items.map((i) => i.menu_id))
    const runs = [...t.matchAll(/([ァ-ヶー一-龠ぁ-んA-Za-z]{2,12})\s*(?:[×x*]\s*)?(?:TO|テイクアウト)?\s*(?:[×x*]\s*)?[0-9]/g)].map((m) => m[1])
    const taken = new Set<string>()
    for (const f of final.items) {
      if (!f.menu_id || have.has(f.menu_id)) continue
      const menu = menus.find((m) => m.id === f.menu_id)
      if (!menu) continue
      const mn = norm(menu.name)
      // 数の前にある言葉のうち、メニュー名と文字が重なるものを優先。なければ、まだ使っていない言葉
      const cand = runs.filter((r) => !taken.has(r) && r !== fname && !/^(?:名前|食数|人数)/.test(r))
      const overlap = (r: string) => {
        let best = 0
        for (let i = 0; i < r.length; i++) for (let j = i + 2; j <= r.length; j++) if (mn.includes(r.slice(i, j))) best = Math.max(best, j - i)
        return best
      }
      const pick = [...cand].sort((a, b) => overlap(b) - overlap(a))[0]
      if (pick && !next.aliases.some((a) => norm(a.word) === pick && a.menu_id === menu.id)) {
        taken.add(pick)
        next = { ...next, aliases: [...next.aliases, { word: pick, menu_id: menu.id, menu_name: menu.name }] }
        notes.push(`言い方: 「${pick}」→ ${menu.name}`)
      }
    }
  }
  return { learned: next, notes }
}
