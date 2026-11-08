import { useSyncExternalStore } from 'react'

// 取り置きの「うずら」(月ごとに変わる特典)の表示名。端末に保存し、開いている画面すべてに反映する。
const KEY = 'kbtr_v3_uzura_label'
export const DEFAULT_UZURA_LABEL = 'うずら'
const listeners = new Set<() => void>()

function read(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_UZURA_LABEL
  } catch {
    return DEFAULT_UZURA_LABEL
  }
}
let current = read()

export function setUzuraLabel(v: string): void {
  current = v.trim() || DEFAULT_UZURA_LABEL
  try {
    localStorage.setItem(KEY, current)
  } catch {
    /* 保存できなくても、開いている間は反映する */
  }
  listeners.forEach((l) => l())
}

export function useUzuraLabel(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
