'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Folder, Search, Settings, Loader2, ChevronRight, Trash2, Edit2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context'
import { 
  getClients, 
  getClientsForUser, 
  createClient, 
  updateClient, 
  deleteClient,
  Client 
} from '@/lib/api/clients'

const CLIENT_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E', 
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'
]

export default function ProjectPlansPage() {
  const router = useRouter()
  const { user, profile, isAdmin } = useAuth()
  
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  
  // 새 클라이언트 추가
  const [showAddForm, setShowAddForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientColor, setNewClientColor] = useState(CLIENT_COLORS[0])
  const [adding, setAdding] = useState(false)
  
  // 클라이언트 편집
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    loadClients()
  }, [user, isAdmin])

  async function loadClients() {
    if (!user) {
      setLoading(false)
      return
    }
    
    try {
      let data: Client[]
      if (isAdmin) {
        // 관리자는 모든 클라이언트 조회
        data = await getClients()
      } else {
        // 일반 사용자는 권한 있는 클라이언트만 조회
        data = await getClientsForUser(user.id)
      }
      setClients(data)
    } catch (error) {
      console.error('클라이언트 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddClient() {
    if (!newClientName.trim() || !isAdmin) return
    
    setAdding(true)
    try {
      await createClient({
        name: newClientName.trim(),
        color: newClientColor
      })
      setNewClientName('')
      setShowAddForm(false)
      loadClients()
    } catch (error) {
      console.error('클라이언트 추가 실패:', error)
      alert('클라이언트 추가에 실패했습니다.')
    } finally {
      setAdding(false)
    }
  }

  async function handleUpdateClient(id: string) {
    if (!editingName.trim()) return
    
    try {
      await updateClient(id, { name: editingName.trim() })
      setEditingId(null)
      loadClients()
    } catch (error) {
      console.error('클라이언트 수정 실패:', error)
    }
  }

  async function handleDeleteClient(id: string) {
    if (!confirm('이 클라이언트와 관련된 모든 기획안이 삭제됩니다. 계속하시겠습니까?')) return
    
    try {
      await deleteClient(id)
      loadClients()
    } catch (error) {
      console.error('클라이언트 삭제 실패:', error)
    }
  }

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">로그인이 필요합니다.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 클라이언트(프로젝트) 목록 */}
      <div className="w-72 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <Folder className="h-5 w-5 text-primary" />
              프로젝트 관리
            </h2>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => router.push('/admin?tab=clients')}>
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-8">
              <Folder className="h-12 w-12 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">
                {searchTerm ? '검색 결과 없음' : isAdmin ? '클라이언트를 추가해주세요' : '접근 가능한 클라이언트가 없습니다'}
              </p>
            </div>
          ) : (
            filteredClients.map(client => (
              <div
                key={client.id}
                className="group relative"
              >
                {editingId === client.id ? (
                  <div className="flex items-center gap-1 p-2 bg-white rounded-lg border">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleUpdateClient(client.id)}>
                      <Check className="h-4 w-4 text-green-500" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4 text-gray-400" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-white hover:shadow-sm cursor-pointer transition-all"
                    onClick={() => router.push(`/project-plans/${client.id}`)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: client.color || '#3B82F6' }}
                    />
                    <span className="text-sm font-medium flex-1 truncate">{client.name}</span>
                    <ChevronRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    {isAdmin && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingId(client.id)
                            setEditingName(client.name)
                          }}
                        >
                          <Edit2 className="h-3 w-3 text-gray-400" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteClient(client.id)
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-red-400" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 관리자만 클라이언트 추가 가능 */}
        {isAdmin && (
          <div className="p-3 border-t bg-white">
            {showAddForm ? (
              <div className="space-y-2">
                <Input
                  placeholder="클라이언트 이름"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-1 flex-wrap">
                  {CLIENT_COLORS.map(color => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full transition-transform ${newClientColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewClientColor(color)}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleAddClient} disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : '추가'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)}>
                    취소
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="w-full" variant="outline" onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                클라이언트 추가
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 우측: 안내 메시지 */}
      <div className="flex-1 flex items-center justify-center bg-gray-50/50">
        <div className="text-center">
          <Folder className="h-20 w-20 mx-auto text-gray-200 mb-4" />
          <h3 className="text-xl font-medium text-gray-400 mb-2">클라이언트를 선택해주세요</h3>
          <p className="text-sm text-gray-400">좌측에서 클라이언트를 선택하면<br/>해당 기획안 목록이 표시됩니다.</p>
        </div>
      </div>
    </div>
  )
}
