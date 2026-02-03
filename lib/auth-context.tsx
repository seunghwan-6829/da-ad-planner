'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // 프로필 가져오기
  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    if (!supabase) return null
    
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error) {
        console.error('Profile fetch error:', error.message)
        return null
      }
      return data as UserProfile
    } catch (err) {
      console.error('Profile fetch exception:', err)
      return null
    }
  }, [])

  // 초기화
  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let isMounted = true

    const initialize = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        
        if (!isMounted) return
        
        if (currentSession?.user) {
          setSession(currentSession)
          setUser(currentSession.user)
          const profileData = await fetchProfile(currentSession.user.id)
          if (isMounted) setProfile(profileData)
        }
      } catch (err) {
        console.error('Init error:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    initialize()

    // Auth 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!isMounted) return
        
        console.log('Auth event:', event)
        
        if (newSession?.user) {
          setSession(newSession)
          setUser(newSession.user)
          const profileData = await fetchProfile(newSession.user.id)
          if (isMounted) setProfile(profileData)
        } else {
          setSession(null)
          setUser(null)
          setProfile(null)
        }
        
        if (isMounted) setLoading(false)
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  // 로그인
  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: new Error('Supabase not configured') }
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      
      if (error) return { error }
      
      if (data.user && data.session) {
        setUser(data.user)
        setSession(data.session)
        const profileData = await fetchProfile(data.user.id)
        setProfile(profileData)
      }
      
      return { error: null }
    } catch (err) {
      return { error: err as Error }
    }
  }

  // 회원가입
  const signUp = async (email: string, password: string, name?: string) => {
    if (!supabase) return { error: new Error('Supabase not configured') }
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    })

    if (!error && data.user && name) {
      // 이름 업데이트 시도
      await supabase.from('user_profiles').update({ name }).eq('id', data.user.id)
    }

    return { error }
  }

  // 로그아웃
  const signOut = async () => {
    setUser(null)
    setProfile(null)
    setSession(null)
    
    if (supabase) {
      await supabase.auth.signOut()
    }
    
    // 로컬 스토리지 클리어
    if (typeof window !== 'undefined') {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-')) localStorage.removeItem(key)
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
