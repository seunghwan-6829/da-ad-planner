'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Folder, Search, Settings, Loader2, ChevronRight, Trash2, Edit2, Check, X, FileText, Calendar, Film, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-context'
import { 
  getClients, 
  getClientsForUser, 
  createClient, 
  updateClient, 
  deleteClient,
  getProjectPlans,
  createProjectPlan,
  deleteProjectPlan,
  Client,
  ProjectPlan
} from '@/lib/api/clients'

const CLIENT_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E', 
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'
]

const STATUS_CONFIG = {
  draft: { label: '초안', color: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '진행중', color: 'bg-orange-100 text-orange-600' },
  completed: { label: '완료됨', color: 'bg-green-100 text-green-600' }
}

export default function ProjectPlansPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, isAdmin } = useAuth()
  
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  
  // 선택된 클라이언트
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [plans, setPlans] = useState<ProjectPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  
  // 새 클라이언트 추가
  const [showAddForm, setShowAddForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientColor, setNewClientColor] = useState(CLIENT_COLORS[0])
  const [adding, setAdding] = useState(false)
  
  // 클라이언트 편집
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState('')
  
  // 새 기획안 추가
  const [showAddPlanModal, setShowAddPlanModal] = useState(false)
  const [newPlanTitle, setNewPlanTitle] = useState('')
  const [addingPlan, setAddingPlan] = useState(false)

  // URL 파라미터로 클라이언트 선택
  useEffect(() => {
    const clientId = searchParams.get('client')
    if (clientId && clients.length > 0 && !selectedClient) {
      const client = clients.find(c => c.id === clientId)
      if (client) {
        handleSelectClient(client)
      }
    }
  }, [searchParams, clients])

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
        data = await getClients()
      } else {
        data = await getClientsForUser(user.id)
      }
      setClients(data)
    } catch (error) {
      console.error('클라이언트 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setPlansLoading(true)
    try {
      const plansData = await getProjectPlans(client.id)
      setPlans(plansData)
    } catch (error) {
      console.error('기획안 로드 실패:', error)
    } finally {
      setPlansLoading(false)
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
      await updateClient(id, { name: editingName.trim(), color: editingColor })
      setEditingId(null)
      loadClients()
      if (selectedClient?.id === id) {
        setSelectedClient({ ...selectedClient, name: editingName.trim(), color: editingColor })
      }
    } catch (error) {
      console.error('클라이언트 수정 실패:', error)
    }
  }

  function startEditing(client: Client) {
    setEditingId(client.id)
    setEditingName(client.name)
    setEditingColor(client.color || CLIENT_COLORS[0])
  }

  async function handleDeleteClient(id: string) {
    if (!confirm('이 클라이언트와 관련된 모든 기획안이 삭제됩니다. 계속하시겠습니까?')) return
    
    try {
      await deleteClient(id)
      if (selectedClient?.id === id) {
        setSelectedClient(null)
        setPlans([])
      }
      loadClients()
    } catch (error) {
      console.error('클라이언트 삭제 실패:', error)
    }
  }

  async function handleAddPlan() {
    if (!newPlanTitle.trim() || !selectedClient) return
    
    setAddingPlan(true)
    try {
      const newPlan = await createProjectPlan({
        client_id: selectedClient.id,
        title: newPlanTitle.trim(),
        status: 'draft',
        scene_count: 0
      })
      setNewPlanTitle('')
      setShowAddPlanModal(false)
      router.push(`/project-plans/${selectedClient.id}/${newPlan.id}`)
    } catch (error) {
      console.error('기획안 생성 실패:', error)
      alert('기획안 생성에 실패했습니다.')
    } finally {
      setAddingPlan(false)
    }
  }

  async function handleDeletePlan(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 기획안을 삭제하시겠습니까?')) return
    
    try {
      await deleteProjectPlan(id)
      setPlans(plans.filter(p => p.id !== id))
    } catch (error) {
      console.error('기획안 삭제 실패:', error)
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
                  <div className="p-2 bg-white rounded-lg border space-y-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1 flex-wrap">
                      {CLIENT_COLORS.map(color => (
                        <button
                          key={color}
                          className={`w-5 h-5 rounded-full transition-transform ${editingColor === color ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => setEditingColor(color)}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" className="flex-1 h-7" onClick={() => handleUpdateClient(client.id)}>
                        <Check className="h-3 w-3 mr-1" />
                        저장
                      </Button>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setEditingId(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      selectedClient?.id === client.id 
                        ? 'bg-primary text-white shadow-md' 
                        : 'hover:bg-white hover:shadow-sm'
                    }`}
                    onClick={() => handleSelectClient(client)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: selectedClient?.id === client.id ? 'white' : (client.color || '#3B82F6') }}
                    />
                    <span className="text-sm font-medium flex-1 truncate">{client.name}</span>
                    <ChevronRight className={`h-4 w-4 transition-opacity ${
                      selectedClient?.id === client.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`} />
                    
                    {isAdmin && selectedClient?.id !== client.id && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditing(client)
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

      {/* 우측: 기획안 목록 */}
      <div className="flex-1 flex flex-col bg-gray-50/50">
        {selectedClient ? (
          <>
            {/* 헤더 */}
            <div className="p-6 border-b bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: selectedClient.color || '#3B82F6' }}
                  />
                  <h2 className="text-2xl font-bold">{selectedClient.name}</h2>
                  <span className="text-sm text-gray-500">기획안 {plans.length}개</span>
                </div>
                <Button onClick={() => setShowAddPlanModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  새 기획안
                </Button>
              </div>
            </div>

            {/* 기획안 목록 */}
            <div className="flex-1 overflow-y-auto p-6">
              {plansLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : plans.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <FileText className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500 mb-4">아직 기획안이 없습니다.</p>
                    <Button onClick={() => setShowAddPlanModal(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      첫 기획안 만들기
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {plans.map(plan => {
                    const status = STATUS_CONFIG[plan.status]
                    return (
                      <Card 
                        key={plan.id}
                        className="cursor-pointer hover:shadow-lg transition-shadow group"
                        onClick={() => router.push(`/project-plans/${selectedClient.id}/${plan.id}`)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <Badge className={status.color}>
                              {plan.status === 'completed' && <Check className="h-3 w-3 mr-1" />}
                              {status.label}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                              onClick={(e) => handleDeletePlan(plan.id, e)}
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                          
                          <h3 className="font-semibold text-lg mb-2 line-clamp-2">{plan.title}</h3>
                          
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <Film className="h-4 w-4" />
                              {plan.scene_count}개 장면
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {new Date(plan.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Folder className="h-20 w-20 mx-auto text-gray-200 mb-4" />
              <h3 className="text-xl font-medium text-gray-400 mb-2">클라이언트를 선택해주세요</h3>
              <p className="text-sm text-gray-400">좌측에서 클라이언트를 선택하면<br/>해당 기획안 목록이 표시됩니다.</p>
            </div>
          </div>
        )}
      </div>

      {/* 새 기획안 모달 */}
      {showAddPlanModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddPlanModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">새 기획안 만들기</h2>
            <Input
              placeholder="기획안 제목을 입력하세요"
              value={newPlanTitle}
              onChange={(e) => setNewPlanTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPlan()}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <Button className="flex-1" onClick={handleAddPlan} disabled={addingPlan || !newPlanTitle.trim()}>
                {addingPlan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                만들기
              </Button>
              <Button variant="outline" onClick={() => setShowAddPlanModal(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
