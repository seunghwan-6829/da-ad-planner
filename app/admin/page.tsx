'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Users, Check, X, Clock, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth, UserRole } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

interface UserProfile {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

export default function AdminPage() {
  const router = useRouter()
  const { isAdmin, loading: authLoading } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/')
      return
    }
    if (isAdmin) {
      loadUsers()
    }
  }, [isAdmin, authLoading, router])

  async function loadUsers() {
    if (!supabase) return
    
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('사용자 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function updateUserRole(userId: string, newRole: UserRole) {
    if (!supabase) return

    setUpdating(userId)
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', userId)

      if (error) throw error
      
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, role: newRole } : u
      ))
      
      alert(`권한이 ${newRole === 'approved' ? '승인' : newRole === 'pending' ? '대기' : '관리자'}로 변경되었습니다.`)
    } catch (error) {
      console.error('권한 변경 실패:', error)
      alert('권한 변경에 실패했습니다.')
    } finally {
      setUpdating(null)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  const pendingUsers = users.filter(u => u.role === 'pending')
  const approvedUsers = users.filter(u => u.role === 'approved')
  const adminUsers = users.filter(u => u.role === 'admin')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-red-500" />
            관리자 페이지
          </h1>
          <p className="text-muted-foreground mt-1">
            사용자 권한을 관리합니다
          </p>
        </div>
        <Button variant="outline" onClick={loadUsers} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingUsers.length}</p>
                <p className="text-sm text-muted-foreground">승인 대기</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{approvedUsers.length}</p>
                <p className="text-sm text-muted-foreground">승인됨</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <Shield className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{adminUsers.length}</p>
                <p className="text-sm text-muted-foreground">관리자</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 승인 대기 */}
      {pendingUsers.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="text-yellow-800 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              승인 대기 ({pendingUsers.length}명)
            </CardTitle>
            <CardDescription>
              아래 사용자들의 가입을 승인해주세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingUsers.map((user) => (
                <div 
                  key={user.id} 
                  className="flex items-center justify-between p-4 bg-white rounded-lg border"
                >
                  <div>
                    <p className="font-medium">{user.name || '(이름 없음)'}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      가입일: {new Date(user.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => updateUserRole(user.id, 'approved')}
                      disabled={updating === user.id}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {updating === user.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          승인
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 전체 사용자 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            전체 사용자 ({users.length}명)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              등록된 사용자가 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div 
                  key={user.id} 
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium">{user.name || '(이름 없음)'}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={
                        user.role === 'admin' ? 'destructive' : 
                        user.role === 'approved' ? 'default' : 
                        'secondary'
                      }
                    >
                      {user.role === 'admin' ? '관리자' : 
                       user.role === 'approved' ? '승인됨' : 
                       '대기중'}
                    </Badge>
                    {user.role !== 'admin' && (
                      <div className="flex gap-1">
                        {user.role === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateUserRole(user.id, 'approved')}
                            disabled={updating === user.id}
                          >
                            승인
                          </Button>
                        )}
                        {user.role === 'approved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateUserRole(user.id, 'pending')}
                            disabled={updating === user.id}
                          >
                            취소
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
