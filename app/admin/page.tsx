'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, Users, Check, X, Clock, Loader2, RefreshCw, Folder, UserCheck, Megaphone, Trash2, Search, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth, UserRole } from '@/lib/auth-context'
import { TrialAccountsPanel } from '@/components/admin/trial-accounts-panel'
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
  can_meta_ad?: boolean
}

export default function AdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isAdmin, loading: authLoading } = useAuth()

  // 탭 관리
  const [activeTab, setActiveTab] = useState<'users' | 'clients' | 'metaAd' | 'trial'>('users')
  const [metaUpdating, setMetaUpdating] = useState<string | null>(null)

  // 사용자 관리
  const [users, setUsers] = useState<UserProfile[]>([])
  const [activity, setActivity] = useState<Record<string, { last_sign_in_at: string | null; created_at: string | null }>>({})
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  
  // 클라이언트 권한 관리
  const [clients, setClients] = useState<Client[]>([])
  const [permissions, setPermissions] = useState<{ [clientId: string]: ClientPermission[] }>({})
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [clientLoading, setClientLoading] = useState(false)
  const [permissionUpdating, setPermissionUpdating] = useState<string | null>(null)

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'clients' || tab === 'metaAd') {
      setActiveTab(tab)
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
      // 마지막 로그인 등 활동(관리자 전용 API — auth.users 의 last_sign_in_at 조회)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        const res = await fetch('/api/admin/users-activity', { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) { const j = await res.json(); setActivity(j.activity || {}) }
      } catch {}
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

  async function updateMetaAccess(userId: string, value: boolean) {
    if (!supabase) return
    setMetaUpdating(userId)
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ can_meta_ad: value })
        .eq('id', userId)
      if (error) throw error
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, can_meta_ad: value } : u)))
    } catch (error) {
      console.error('메타 광고 권한 변경 실패:', error)
      alert('권한 변경에 실패했습니다. (can_meta_ad 컬럼 마이그레이션을 실행했는지 확인하세요)')
    } finally {
      setMetaUpdating(null)
    }
  }

  // 사용자 강퇴(완전 삭제). Auth 계정까지 삭제되어 다시 로그인 불가.
  async function handleDeleteUser(target: UserProfile) {
    if (!supabase) return
    if (target.id === user?.id) {
      alert('자기 자신은 삭제할 수 없습니다.')
      return
    }
    if (!confirm(`'${target.email}' 사용자를 완전히 삭제(강퇴)할까요?\n\n계정이 삭제되어 다시 로그인할 수 없게 됩니다. 되돌릴 수 없습니다.`)) {
      return
    }
    setDeleting(target.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ userId: target.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || '삭제 실패')
      setUsers((prev) => prev.filter((u) => u.id !== target.id))
    } catch (error) {
      console.error('사용자 삭제 실패:', error)
      alert('사용자 삭제에 실패했습니다.\n' + (error instanceof Error ? error.message : ''))
    } finally {
      setDeleting(null)
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

  // 전체 사용자 목록: 역할 필터 + 검색
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    const q = userSearch.trim().toLowerCase()
    if (q && !((u.email || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))) return false
    return true
  })

  const roleLabel = (r: UserRole) => (r === 'admin' ? '관리자' : r === 'approved' ? '승인됨' : '대기중')

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
        <button
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'metaAd'
              ? 'border-b-2 border-primary text-primary'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('metaAd')}
        >
          <Megaphone className="h-4 w-4 inline mr-2" />
          메타 광고 크롤러
        </button>
        <button
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'trial'
              ? 'border-b-2 border-primary text-primary'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('trial')}
        >
          <Ticket className="h-4 w-4 inline mr-2" />
          체험 계정
        </button>
      </div>

      {activeTab === 'trial' && <TrialAccountsPanel />}

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
                        <p className="font-medium text-lg">{user.email}</p>
                        <p className="text-xs text-muted-foreground">
                          가입일: {new Date(user.created_at).toLocaleDateString('ko-KR')}
                          {' · '}마지막 로그인: {activity[user.id]?.last_sign_in_at ? new Date(activity[user.id].last_sign_in_at!).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '없음'}
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
            <CardHeader className="gap-3">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                전체 사용자 ({users.length}명)
              </CardTitle>
              {/* 검색 + 역할 필터 */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="이메일·이름 검색"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['all', `전체 ${users.length}`],
                    ['pending', `대기 ${pendingUsers.length}`],
                    ['approved', `승인 ${approvedUsers.length}`],
                    ['admin', `관리자 ${adminUsers.length}`],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setRoleFilter(key as 'all' | UserRole)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        roleFilter === key
                          ? 'bg-primary text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {users.length === 0 ? '등록된 사용자가 없습니다.' : '조건에 맞는 사용자가 없습니다.'}
                </p>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto rounded-lg border dark:border-gray-800">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === user?.id
                    return (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-3 border-b last:border-b-0 dark:border-gray-800 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium dark:text-gray-100">
                            {u.name || u.email}
                            {isSelf && <span className="ml-1 text-xs text-gray-400">(나)</span>}
                          </p>
                          {u.name && <p className="truncate text-xs text-gray-400">{u.email}</p>}
                        </div>
                        <span className="hidden whitespace-nowrap text-right text-xs text-gray-400 md:block">
                          <span className="block">가입 {new Date(u.created_at).toLocaleDateString('ko-KR')}</span>
                          <span className="block">로그인 {activity[u.id]?.last_sign_in_at ? new Date(activity[u.id].last_sign_in_at!).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '없음'}</span>
                        </span>
                        <Badge
                          variant={u.role === 'admin' ? 'destructive' : u.role === 'approved' ? 'default' : 'secondary'}
                          className="flex-shrink-0"
                        >
                          {roleLabel(u.role)}
                        </Badge>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          {u.role === 'pending' && (
                            <Button size="sm" variant="outline" onClick={() => updateUserRole(u.id, 'approved')} disabled={updating === u.id}>
                              승인
                            </Button>
                          )}
                          {u.role === 'approved' && (
                            <Button size="sm" variant="outline" onClick={() => updateUserRole(u.id, 'pending')} disabled={updating === u.id}>
                              취소
                            </Button>
                          )}
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteUser(u)}
                              disabled={deleting === u.id}
                              title="사용자 강퇴(완전 삭제)"
                              className="text-red-500 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/40"
                            >
                              {deleting === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
                            <p className="font-medium text-lg">{user.email}</p>
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

      {/* 메타 광고 크롤러 권한 탭 */}
      {activeTab === 'metaAd' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              메타 광고 크롤러 접근 권한
            </CardTitle>
            <CardDescription>
              경쟁사 메타 광고 크롤러 메뉴를 볼 수 있는 사용자를 설정합니다. (관리자는 항상 접근 가능)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : approvedAndAdminUsers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">승인된 사용자가 없습니다</p>
            ) : (
              <div className="space-y-2">
                {approvedAndAdminUsers.map((user) => {
                  const isUserAdmin = user.role === 'admin'
                  const has = isUserAdmin || !!user.can_meta_ad
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${has ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {has ? <Check className="h-5 w-5 text-green-600" /> : <X className="h-5 w-5 text-gray-400" />}
                        </div>
                        <p className="font-medium text-lg">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isUserAdmin ? (
                          <Badge variant="destructive">관리자 (항상 접근)</Badge>
                        ) : user.can_meta_ad ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateMetaAccess(user.id, false)}
                            disabled={metaUpdating === user.id}
                            className="text-red-500 border-red-200 hover:bg-red-50"
                          >
                            {metaUpdating === user.id ? (
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
                            onClick={() => updateMetaAccess(user.id, true)}
                            disabled={metaUpdating === user.id}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {metaUpdating === user.id ? (
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
      )}
    </div>
  )
}
