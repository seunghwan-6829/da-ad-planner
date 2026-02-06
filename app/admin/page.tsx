'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, Users, Check, X, Clock, Loader2, RefreshCw, Folder, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth, UserRole } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { 
  getClients, 
  getClientPermissions, 
  grantClientPermission, 
  revokeClientPermission,
  Client,
  ClientPermission 
} from '@/lib/api/clients'

interface UserProfile {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

export default function AdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAdmin, loading: authLoading } = useAuth()
  
  // 탭 관리
  const [activeTab, setActiveTab] = useState<'users' | 'clients'>('users')
  
  // 사용자 관리
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  
  // 클라이언트 권한 관리
  const [clients, setClients] = useState<Client[]>([])
  const [permissions, setPermissions] = useState<{ [clientId: string]: ClientPermission[] }>({})
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clientLoading, setClientLoading] = useState(false)
  const [permissionUpdating, setPermissionUpdating] = useState<string | null>(null)

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'clients') {
      setActiveTab('clients')
    }
  }, [searchParams])

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/')
      return
    }
    if (isAdmin) {
      loadUsers()
      loadClients()
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

  async function loadClients() {
    setClientLoading(true)
    try {
      const clientsData = await getClients()
      setClients(clientsData)
      
      // 각 클라이언트의 권한 정보 로드
      const permsMap: { [clientId: string]: ClientPermission[] } = {}
      for (const client of clientsData) {
        const perms = await getClientPermissions(client.id)
        permsMap[client.id] = perms
      }
      setPermissions(permsMap)
      
      if (clientsData.length > 0 && !selectedClient) {
        setSelectedClient(clientsData[0].id)
      }
    } catch (error) {
      console.error('클라이언트 로드 실패:', error)
    } finally {
      setClientLoading(false)
    }
  }

  async function handleGrantPermission(userId: string, clientId: string) {
    setPermissionUpdating(userId)
    try {
      await grantClientPermission(userId, clientId)
      const perms = await getClientPermissions(clientId)
      setPermissions(prev => ({ ...prev, [clientId]: perms }))
    } catch (error) {
      console.error('권한 부여 실패:', error)
      alert('권한 부여에 실패했습니다.')
    } finally {
      setPermissionUpdating(null)
    }
  }

  async function handleRevokePermission(userId: string, clientId: string) {
    setPermissionUpdating(userId)
    try {
      await revokeClientPermission(userId, clientId)
      const perms = await getClientPermissions(clientId)
      setPermissions(prev => ({ ...prev, [clientId]: perms }))
    } catch (error) {
      console.error('권한 취소 실패:', error)
      alert('권한 취소에 실패했습니다.')
    } finally {
      setPermissionUpdating(null)
    }
  }

  function hasPermission(userId: string, clientId: string): boolean {
    return permissions[clientId]?.some(p => p.user_id === userId) || false
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

  const approvedAndAdminUsers = users.filter(u => u.role === 'approved' || u.role === 'admin')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-red-500" />
            관리자 페이지
          </h1>
          <p className="text-muted-foreground mt-1">
            사용자 및 클라이언트 권한을 관리합니다
          </p>
        </div>
        <Button variant="outline" onClick={() => { loadUsers(); loadClients() }} disabled={loading || clientLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading || clientLoading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'users' 
              ? 'border-b-2 border-primary text-primary' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('users')}
        >
          <Users className="h-4 w-4 inline mr-2" />
          사용자 관리
        </button>
        <button
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'clients' 
              ? 'border-b-2 border-primary text-primary' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('clients')}
        >
          <Folder className="h-4 w-4 inline mr-2" />
          클라이언트 권한
        </button>
      </div>

      {/* 사용자 관리 탭 */}
      {activeTab === 'users' && (
        <>
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
        </>
      )}

      {/* 클라이언트 권한 관리 탭 */}
      {activeTab === 'clients' && (
        <div className="grid grid-cols-3 gap-6">
          {/* 클라이언트 목록 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Folder className="h-5 w-5" />
                클라이언트 목록
              </CardTitle>
              <CardDescription>
                권한을 관리할 클라이언트를 선택하세요
              </CardDescription>
            </CardHeader>
            <CardContent>
              {clientLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : clients.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  클라이언트가 없습니다.<br/>
                  기획안 제작에서 클라이언트를 추가하세요.
                </p>
              ) : (
                <div className="space-y-2">
                  {clients.map((client) => (
                    <div
                      key={client.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedClient === client.id 
                          ? 'bg-primary text-white' 
                          : 'hover:bg-gray-100'
                      }`}
                      onClick={() => setSelectedClient(client.id)}
                    >
                      <div 
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: client.color || '#3B82F6' }}
                      />
                      <span className="font-medium flex-1">{client.name}</span>
                      <span className={`text-xs ${selectedClient === client.id ? 'text-white/70' : 'text-gray-400'}`}>
                        {permissions[client.id]?.length || 0}명
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 권한 있는 사용자 */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                사용자별 권한 설정
              </CardTitle>
              <CardDescription>
                {selectedClient && clients.find(c => c.id === selectedClient)?.name}에 접근할 수 있는 사용자를 설정합니다
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedClient ? (
                <p className="text-center text-muted-foreground py-8">
                  왼쪽에서 클라이언트를 선택하세요
                </p>
              ) : approvedAndAdminUsers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  승인된 사용자가 없습니다
                </p>
              ) : (
                <div className="space-y-2">
                  {approvedAndAdminUsers.map((user) => {
                    const hasPerm = hasPermission(user.id, selectedClient)
                    const isUserAdmin = user.role === 'admin'
                    
                    return (
                      <div 
                        key={user.id} 
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            hasPerm || isUserAdmin ? 'bg-green-100' : 'bg-gray-100'
                          }`}>
                            {hasPerm || isUserAdmin ? (
                              <Check className="h-5 w-5 text-green-600" />
                            ) : (
                              <X className="h-5 w-5 text-gray-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{user.name || '(이름 없음)'}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isUserAdmin ? (
                            <Badge variant="destructive">관리자 (전체 접근)</Badge>
                          ) : hasPerm ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRevokePermission(user.id, selectedClient)}
                              disabled={permissionUpdating === user.id}
                              className="text-red-500 border-red-200 hover:bg-red-50"
                            >
                              {permissionUpdating === user.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <X className="h-4 w-4 mr-1" />
                                  권한 해제
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleGrantPermission(user.id, selectedClient)}
                              disabled={permissionUpdating === user.id}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {permissionUpdating === user.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-4 w-4 mr-1" />
                                  권한 부여
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
