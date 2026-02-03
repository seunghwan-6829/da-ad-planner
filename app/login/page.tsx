'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, UserPlus, Loader2, Mail, Lock, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context'
import { isSupabaseConfigured } from '@/lib/supabase'

export default function LoginPage() {
  const supabaseReady = isSupabaseConfigured()
  const router = useRouter()
  const { signIn, signUp } = useAuth()
  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // 타임아웃 설정 (10초)
    const timeout = setTimeout(() => {
      setLoading(false)
      setError('요청 시간이 초과되었습니다. 다시 시도해주세요.')
    }, 10000)

    try {
      if (isLogin) {
        console.log('로그인 시도:', email)
        const { error } = await signIn(email, password)
        clearTimeout(timeout)
        
        if (error) {
          console.log('로그인 에러:', error)
          setError(error.message === 'Invalid login credentials' 
            ? '이메일 또는 비밀번호가 올바르지 않습니다.' 
            : error.message)
          setLoading(false)
          return
        }
        
        console.log('로그인 성공, 페이지 이동')
        // 약간의 딜레이 후 페이지 이동
        setTimeout(() => {
          window.location.replace('/')
        }, 100)
        return
      } else {
        if (password.length < 6) {
          clearTimeout(timeout)
          setError('비밀번호는 6자 이상이어야 합니다.')
          setLoading(false)
          return
        }
        const { error } = await signUp(email, password, name)
        clearTimeout(timeout)
        
        if (error) {
          if (error.message.includes('already registered')) {
            setError('이미 가입된 이메일입니다.')
          } else {
            setError(error.message)
          }
          setLoading(false)
          return
        }
        alert('회원가입이 완료되었습니다!\n관리자 승인 후 서비스를 이용할 수 있습니다.')
        setIsLogin(true)
        setLoading(false)
      }
    } catch (err) {
      clearTimeout(timeout)
      console.error('로그인 예외:', err)
      setError('오류가 발생했습니다. 다시 시도해주세요.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">DA 광고 플래너</CardTitle>
          <CardDescription>
            {isLogin ? '로그인하여 서비스를 이용하세요' : '새 계정을 만들어주세요'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">이름</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="홍길동"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  disabled={loading}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  disabled={loading}
                  minLength={6}
                />
              </div>
            </div>

            {!supabaseReady && (
              <div className="text-sm text-yellow-700 bg-yellow-50 p-3 rounded-lg">
                ⚠️ Supabase가 설정되지 않았습니다. 환경변수를 확인해주세요.
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isLogin ? (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  로그인
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  회원가입
                </>
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin)
                setError('')
              }}
              className="text-sm text-primary hover:underline"
              disabled={loading}
            >
              {isLogin ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
            </button>
          </div>

          {!isLogin && (
            <p className="mt-4 text-xs text-center text-muted-foreground">
              회원가입 후 관리자 승인이 필요합니다.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
