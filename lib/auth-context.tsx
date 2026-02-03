'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

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
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  isAdmin: boolean
  isApproved: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId: string) {
    if (!supabase) return null
    
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error) {
        console.error('Profile fetch error:', error)
        // 프로필이 없으면 기본값 반환
        return null
      }
      return data as UserProfile
    } catch (err) {
      console.error('Profile fetch exception:', err)
      return null
    }
  }

  async function refreshProfile() {
    if (user) {
      const profileData = await fetchProfile(user.id)
      setProfile(profileData)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    // 현재 세션 가져오기
    async function initAuth() {
      try {
        const { data: { session } } = await supabase!.auth.getSession()
        
        if (!mounted) return
        
        setSession(session)
        setUser(session?.user ?? null)
        
        if (session?.user) {
          const profileData = await fetchProfile(session.user.id)
          if (mounted) setProfile(profileData)
        }
      } catch (err) {
        console.error('Auth init error:', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    initAuth()

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      
      setSession(session)
      setUser(session?.user ?? null)
      
      if (session?.user) {
        const profileData = await fetchProfile(session.user.id)
        if (mounted) setProfile(profileData)
      } else {
        setProfile(null)
      }
      
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    if (!supabase) return { error: new Error('Supabase not configured') }
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  async function signUp(email: string, password: string, name?: string) {
    if (!supabase) return { error: new Error('Supabase not configured') }
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    })

    // 프로필에 이름 업데이트
    if (!error && data.user && name) {
      await supabase
        .from('user_profiles')
        .update({ name })
        .eq('id', data.user.id)
    }

    return { error }
  }

  async function signOut() {
    // 상태 먼저 초기화
    setUser(null)
    setProfile(null)
    setSession(null)
    
    // Supabase 로그아웃 시도
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch (err) {
        console.error('Supabase signOut error:', err)
      }
    }
    
    // 로컬 스토리지 정리
    if (typeof window !== 'undefined') {
      localStorage.removeItem('supabase.auth.token')
      // Supabase가 사용하는 모든 키 정리
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-')) {
          localStorage.removeItem(key)
        }
      })
    }
  }

  const isAdmin = profile?.role === 'admin'
  const isApproved = profile?.role === 'admin' || profile?.role === 'approved'

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      isAdmin,
      isApproved,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
