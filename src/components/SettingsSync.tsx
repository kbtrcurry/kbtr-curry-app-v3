import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { hasDirty, pullSettings, pushDirty } from '../lib/sharedSettings'
import '../lib/settings' // 共有する設定の定義を読み込む

// 共有設定を、ログイン中はデータベースと同期する。ほかの端末で変えたら、すぐこちらにも反映される。
export function SettingsSync() {
  const { session } = useAuth()
  useEffect(() => {
    if (!session) return
    void pullSettings()
    const ch = supabase
      .channel(`app-settings-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => void pullSettings())
      .subscribe()
    const id = setInterval(() => {
      if (hasDirty()) void pushDirty()
    }, 5000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullSettings()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      void supabase.removeChannel(ch)
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])
  return null
}
