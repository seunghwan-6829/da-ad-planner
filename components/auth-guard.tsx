'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, profile, loading, error, isApproved } = useAuth()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // 최대 2초 대기 후 체크 완료
    const timer = setTimeout(() => setChecked(true), 2000)
    
    if (!loading) {
      setChecked(true)
      clearTimeout(timer)
    }
    
    return () => clearTimeout(timer)
  }, [loading])

  // 아직 체크 중
  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Supabase 에러
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">연결 오류</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-white rounded"
          >
            새로고침
          </button>
        </div>
      </div>
    )
  }

  // 로그인 안됨
  if (!user) {
    router.push('/login')
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // 승인 안됨
  if (profile && !isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">권한이 없습니다</h2>
          <p className="text-gray-600 mb-4">
            관리자 승인 후 서비스를 이용할 수 있습니다.
          </p>
          <button 
            onClick={() => window.location.href = '/login'}
            className="px-4 py-2 bg-primary text-white rounded"
          >
            로그인 페이지로
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
