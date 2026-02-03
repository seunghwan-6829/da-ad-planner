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
      if (session?.user) {
        setUser(session.user)
        getProfile(session.user.id).then(setProfile)
      }
      setLoading(false)
    })

    // Auth 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event)
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
      setUser(data.user)
      const p = await getProfile(data.user.id)
      setProfile(p)
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
    setUser(null)
    setProfile(null)
    // 로컬 스토리지 클리어
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-')) localStorage.removeItem(key)
    })
    window.location.href = '/login'
  }

  const isAdmin = profile?.role === 'admin'
  const isApproved = profile?.role === 'admin' || profile?.role === 'approved'

  return (
    <AuthContext.Provider value={{
      user, profile, loading, error, signIn, signUp, signOut, isAdmin, isApproved
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
