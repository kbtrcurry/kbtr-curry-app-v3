import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

// 端末をまたいで共有する設定(間取り・特典の名前・今日つくる食数など)。
// まず端末に保存して画面にすぐ反映し、データベース(app_settings)にも保存して、ほかの端末へも反映する。
// データベース側にテーブルがない間は、端末だけで動く。

type Def = { initial: unknown; sanitize: (raw: unknown) => unknown }
const defs = new Map<string, Def>()
const values = new Map<string, unknown>()
const dirty = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
let unavailable = false

const emit = () => {
  version += 1
  listeners.forEach((l) => l())
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function readLocal(key: string): { value: unknown } | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    try {
      return { value: JSON.parse(raw) }
    } catch {
      return { value: raw } // 昔の形式(文字列そのまま)
    }
  } catch {
    return null
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 保存できなくても、開いている間は反映する */
  }
}

export function defineSetting<T>(key: string, initial: T, sanitize: (raw: unknown) => T) {
  defs.set(key, { initial, sanitize })
  const get = (): T => {
    if (!values.has(key)) {
      const l = readLocal(key)
      values.set(key, l ? sanitize(l.value) : initial)
    }
    return values.get(key) as T
  }
  const set = (v: T) => {
    values.set(key, v)
    writeLocal(key, v)
    dirty.add(key)
    emit()
    void pushDirty()
  }
  const use = (): [T, (v: T) => void] => {
    useSyncExternalStore(subscribe, () => version)
    return [get(), set]
  }
  return { get, set, use }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const hasDirty = (): boolean => dirty.size > 0

/** 端末で変えた設定を、データベースへ送る。送れなければ、あとで送り直す */
export async function pushDirty(): Promise<void> {
  if (unavailable) return
  for (const key of [...dirty]) {
    const value = values.get(key)
    const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() })
    if (!error) dirty.delete(key)
    else {
      if (/app_settings/.test(error.message ?? '') && /(does not exist|schema cache|Could not find)/i.test(error.message ?? '')) unavailable = true
      return
    }
  }
}

/** データベースの設定を取り込む。端末だけにある設定は、データベースへ上げる(最初の1回の引っ越し) */
export async function pullSettings(): Promise<void> {
  const { data, error } = await supabase.from('app_settings').select('key, value')
  if (error) {
    if (/app_settings/.test(error.message ?? '') && /(does not exist|schema cache|Could not find)/i.test(error.message ?? '')) unavailable = true
    return
  }
  unavailable = false
  const remote = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]))
  let changed = false
  for (const [key, def] of defs) {
    if (dirty.has(key)) continue
    if (remote.has(key)) {
      const next = def.sanitize(remote.get(key))
      const cur = values.has(key) ? values.get(key) : (readLocal(key) ? def.sanitize(readLocal(key)!.value) : def.initial)
      if (!same(cur, next)) {
        values.set(key, next)
        writeLocal(key, next)
        changed = true
      }
    } else if (readLocal(key)) {
      dirty.add(key) // 端末にだけある設定
      if (!values.has(key)) values.set(key, def.sanitize(readLocal(key)!.value))
    }
  }
  if (changed) emit()
  await pushDirty()
}
