import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// 電波が悪いと、通信が返ってこないまま、画面がぐるぐるのまま止まる。
// 読み込み(GET)は一定時間で見切り、端末に残してあるデータを使えるようにする。書き込みなどには、時間の制限をつけない。
const GET_TIMEOUT_MS = 12_000
const fetchWithTimeout: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' || typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return fetch(input, init)
  const timeout = AbortSignal.timeout(GET_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

// 未設定でもアプリ自体は起動できるようにする（接続確認画面で案内を出す）
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder',
  { global: { fetch: fetchWithTimeout } },
)
