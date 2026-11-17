// 取り置きを登録した時点で、お客さんに「承りました」と返信している前提。そのとき(登録した時点)の内容を控えておき、
// あとで内容(日・時間・メニューと数・TO)が変わったら、「再返信が必要」と知らせる。返信の操作は増やさない。
import type { ResItem } from './reservations'

export type ReplySnap = Record<string, string>
export const MAX_SNAPS = 400

type Snapshotable = { name: string; service_date: string; visit_time: string; items: Pick<ResItem, 'menu_id' | 'name' | 'qty' | 'takeout'>[] }

/** 返信した内容のしるし。容器代は、TOの数から自動で入るので数えない */
export function snapshotOf(r: Snapshotable): string {
  const items = r.items
    .filter((i) => !/容器/.test(i.name))
    .map((i) => `${i.menu_id ?? i.name}:${i.qty}:${i.takeout ? 'T' : 'E'}`)
    .sort()
  return JSON.stringify([r.name.trim(), r.service_date, r.visit_time || '', items])
}

export function sanitizeSnaps(raw: unknown): ReplySnap {
  if (!raw || typeof raw !== 'object') return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as ReplySnap
}

/** 控えがあって、いまの内容と違うとき(控えがない昔の取り置きは、知らせない) */
export function needsReply(r: Snapshotable & { id: string; status: string }, snaps: ReplySnap): boolean {
  if (r.status !== 'reserved') return false
  const s = snaps[r.id]
  return !!s && s !== snapshotOf(r)
}

/** 控えを足す。古いものから捨てて、数を抑える */
export function withSnap(snaps: ReplySnap, id: string, snap: string): ReplySnap {
  const next = { ...snaps }
  delete next[id]
  next[id] = snap
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPS))) delete next[k]
  return next
}
