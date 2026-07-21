'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'

export type UserRole = 'admin' | 'approved' | 'pending'

interface UserProfile {
  id: string
  email: string
  name: string | null
  role: UserRole
  can_meta_ad?: boolean
  trial_expires_at?: string | null
  trial_label?: string | null
}

/* 세션 토큰을 쿠키로도 흘려준다.
   Supabase 세션은 localStorage 에만 있어 서버(middleware)가 볼 수 없다.
   체험 계정 차단은 서버에서 판정해야 하므로(주소 직접 입력·fetch 우회 방지) 쿠키가 필요하다.
   토큰 자체는 이미 브라우저 JS 가 읽을 수 있는 값이라 노출 수준은 그대로다. */
const AUTH_COOKIE = 'cd-at'
function syncAuthCookie(accessToken: string | null, expiresAt?: number) {
  if (typeof document === 'undefined') return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  if (!accessToken) {
    document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`
    return
  }
  const maxAge = expiresAt ? Math.max(60, expiresAt - Math.floor(Date.now() / 1000)) : 3600
  document.cookie = `${AUTH_COOKIE}=${accessToken}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`
}

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: string | null }>
  signOut: () => void
  isAdmin: boolean
  isApproved: boolean
  canMetaAd: boolean
  isTrial: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  error: null,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: () => {},
  isAdmin: false,
  isApproved: false,
  canMetaAd: false,
  isTrial: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 프로필 가져오기
  async function getProfile(userId: string): Promise<UserProfile | null> {
    if (!supabase) return null
    
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    
    if (error) {
      console.log('Profile error:', error.message)
      return null
    }
    return data
  }

  // 초기화
  useEffect(() => {
    // Supabase가 설정되지 않은 경우
    if (!isSupabaseConfigured() || !supabase) {
      setError('Supabase가 설정되지 않았습니다')
      setLoading(false)
      return
    }

    // 세션 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      syncAuthCookie(session?.access_token ?? null, session?.expires_at)
      if (session?.user) {
        setUser(session.user)
        getProfile(session.user.id).then(setProfile)
      }
      setLoading(false)
    })

    // Auth 리스너 (토큰 갱신 시에도 쿠키를 최신으로 유지)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event)
      syncAuthCookie(session?.access_token ?? null, session?.expires_at)
      if (session?.user) {
        setUser(session.user)
        getProfile(session.user.id).then(setProfile)
      } else {
        setUser(null)
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // 로그인
  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Supabase 연결 안됨' }
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      return { error: error.message === 'Invalid login credentials' 
        ? '이메일 또는 비밀번호가 틀렸습니다' 
        : error.message }
    }
    
    if (data.user) {
      syncAuthCookie(data.session?.access_token ?? null, data.session?.expires_at)
      setUser(data.user)
      const p = await getProfile(data.user.id)
      setProfile(p)
      // 체험 계정이 만료됐으면 바로 알려주고 세션을 정리한다.
      if (p?.role === 'trial' && p.trial_expires_at && Date.parse(p.trial_expires_at) <= Date.now()) {
        await supabase.auth.signOut()
        syncAuthCookie(null)
        setUser(null)
        setProfile(null)
        return { error: '체험 기간이 종료된 계정입니다. 관리자에게 문의해 주세요.' }
      }
    }

    return { error: null }
  }

  // 회원가입
  async function signUp(email: string, password: string, name?: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Supabase 연결 안됨' }
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    })
    
    if (error) {
      return { error: error.message.includes('already registered') 
        ? '이미 가입된 이메일입니다' 
        : error.message }
    }
    
    return { error: null }
  }

  // 로그아웃
  function signOut() {
    if (supabase) {
      supabase.auth.signOut()
    }
    syncAuthCookie(null)
    setUser(null)
    setProfile(null)
    // 로컬 스토리지 클리어
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-')) localStorage.removeItem(key)
    })
    window.location.href = '/login'
  }

  const isAdmin = profile?.role === 'admin'
  const isTrial = profile?.role === 'trial'
  // 체험 계정도 크롤러를 봐야 하므로 '승인됨'으로 취급한다(차단은 middleware 와 메뉴에서).
  const isApproved = profile?.role === 'admin' || profile?.role === 'approved' || isTrial
  const canMetaAd = profile?.role === 'admin' || profile?.can_meta_ad === true || isTrial

  return (
    <AuthContext.Provider value={{
      user, profile, loading, error, signIn, signUp, signOut, isAdmin, isApproved, canMetaAd, isTrial
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
