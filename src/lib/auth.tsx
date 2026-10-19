import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { GMAIL_SCOPE } from './gmail'

type AuthCtx = {
  session: Session | null
  loading: boolean
  loginWithGoogle: () => Promise<void>
  /** Googleが返したアクセストークン（Gmail読み取り用。約1時間有効。無ければ null） */
  gmailToken: string | null
  /** Gmailの読み取りを許可してログインし直す（許可後にこの画面へ戻る） */
  connectGmail: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
  }

  const connectGmail = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL, scopes: GMAIL_SCOPE },
    })
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <Ctx.Provider
      value={{ session, loading, loginWithGoogle, gmailToken: session?.provider_token ?? null, connectGmail, logout }}
    >{children}</Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
