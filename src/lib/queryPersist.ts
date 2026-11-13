// 読み込んだデータを、端末(IndexedDB)に残す。電波が悪くても、前に見たデータをすぐ出せるようにするため。
// 画面を開くと、まず端末に残っているデータを出し、そのあと裏で新しいデータを取りに行く。
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistedClient } from '@tanstack/react-query-persist-client'

const DB = 'kbtr_v3_query_cache'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const storage = {
  getItem: async (k: string): Promise<string | null> => {
    try {
      return ((await run('readonly', (s) => s.get(k))) as string | undefined) ?? null
    } catch {
      return null
    }
  },
  setItem: async (k: string, v: string): Promise<void> => {
    try {
      await run('readwrite', (s) => s.put(v, k))
    } catch {
      /* 保存できなくても、アプリは動く */
    }
  },
  removeItem: async (k: string): Promise<void> => {
    try {
      await run('readwrite', (s) => s.delete(k))
    } catch {
      /* 何もしない */
    }
  },
}

const KEY = 'kbtr_v3_query_cache'
export const queryPersister = createAsyncStoragePersister({ storage, key: KEY, throttleTime: 1500 })

/** 保存期間。これより古いデータは使わない */
export const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 3

/** ログアウトしたとき、端末に残したデータを消す */
export async function clearPersistedQueries(): Promise<void> {
  await storage.removeItem(KEY)
}

/** 画面に出さないほうがよい問い合わせ(認証まわりなど)は保存しない */
export const shouldPersist = (q: { queryKey: readonly unknown[]; state: { status: string } }): boolean => q.state.status === 'success' && q.queryKey[0] !== 'auth'

export type { PersistedClient }
