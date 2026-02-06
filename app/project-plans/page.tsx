'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Folder, Search, Settings, Loader2, ChevronRight, Trash2, Edit2, Check, X, FileText, Calendar, Film, Palette, GripVertical, RotateCcw, CheckCircle2, ArrowUp, ArrowDown } from 'lucide-react'
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
  updateClientOrder,
  getProjectPlans,
  getDeletedProjectPlans,
  createProjectPlan,
  deleteProjectPlan,
  restoreProjectPlan,
  permanentDeleteProjectPlan,
  updateProjectPlan,
  Client,
  ProjectPlan
} from '@/lib/api/clients'

const CLIENT_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E', 
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'
]

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
  
  // 휴지통 모드
  const [showTrash, setShowTrash] = useState(false)
  const [deletedPlans, setDeletedPlans] = useState<ProjectPlan[]>([])
  
  // 새 클라이언트 추가
  const [showAddForm, setShowAddForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientColor, setNewClientColor] = useState(CLIENT_COLORS[0])
  const [adding, setAdding] = useState(false)
  
  // 클라이언트 편집 모드
  const [editMode, setEditMode] = useState(false)
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
    setShowTrash(false)
    try {
      const plansData = await getProjectPlans(client.id)
      setPlans(plansData)
    } catch (error) {
      console.error('기획안 로드 실패:', error)
    } finally {
      setPlansLoading(false)
    }
  }

  async function loadDeletedPlans() {
    if (!selectedClient) return
    setPlansLoading(true)
    try {
      const deleted = await getDeletedProjectPlans(selectedClient.id)
      setDeletedPlans(deleted)
      setShowTrash(true)
    } catch (error) {
      console.error('휴지통 로드 실패:', error)
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
        color: newClientColor,
        sort_order: clients.length
      } as any)
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

  // 클라이언트 순서 변경
  async function moveClient(index: number, direction: 'up' | 'down') {
    const newClients = [...clients]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    
    if (targetIndex < 0 || targetIndex >= clients.length) return
    
    // 위치 교환
    [newClients[index], newClients[targetIndex]] = [newClients[targetIndex], newClients[index]]
    
    // sort_order 업데이트
    const updates = newClients.map((c, i) => ({ id: c.id, sort_order: i }))
    
    setClients(newClients)
    try {
      await updateClientOrder(updates)
    } catch (error) {
      console.error('순서 변경 실패:', error)
      loadClients() // 실패 시 원복
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
        scene_count: 0,
        is_completed: false
      } as any)
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
    if (!confirm('이 기획안을 휴지통으로 이동하시겠습니까?')) return
    
    try {
      await deleteProjectPlan(id)
      setPlans(plans.filter(p => p.id !== id))
    } catch (error) {
      console.error('기획안 삭제 실패:', error)
    }
  }

  async function handleRestorePlan(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await restoreProjectPlan(id)
      setDeletedPlans(deletedPlans.filter(p => p.id !== id))
      // 복원된 기획안을 다시 로드
      if (selectedClient) {
        const plansData = await getProjectPlans(selectedClient.id)
        setPlans(plansData)
      }
    } catch (error) {
      console.error('복원 실패:', error)
    }
  }

  async function handlePermanentDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 기획안을 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return
    
    try {
      await permanentDeleteProjectPlan(id)
      setDeletedPlans(deletedPlans.filter(p => p.id !== id))
    } catch (error) {
      console.error('영구 삭제 실패:', error)
    }
  }

  // 완료 토글
  async function toggleComplete(plan: ProjectPlan, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const newStatus = !(plan as any).is_completed
      await updateProjectPlan(plan.id, { 
        is_completed: newStatus,
        status: newStatus ? 'completed' : 'in_progress'
      } as any)
      setPlans(plans.map(p => 
        p.id === plan.id 
          ? { ...p, is_completed: newStatus, status: newStatus ? 'completed' : 'in_progress' } as ProjectPlan
          : p
      ))
    } catch (error) {
      console.error('상태 변경 실패:', error)
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
            <div className="flex items-center gap-1">
              {isAdmin && (
                <>
                  <Button 
                    size="sm" 
                    variant={editMode ? "default" : "ghost"} 
                    onClick={() => setEditMode(!editMode)}
                    className="h-8"
                  >
                    <Edit2 className="h-4 w-4" />
                    {editMode && <span className="ml-1 text-xs">편집중</span>}
                  </Button>
                </>
              )}
            </div>
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
            filteredClients.map((client, index) => (
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
                    className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-all ${
                      selectedClient?.id === client.id 
                        ? 'bg-primary text-white shadow-md' 
                        : 'hover:bg-white hover:shadow-sm'
                    }`}
                    onClick={() => !editMode && handleSelectClient(client)}
                  >
                    {/* 편집 모드에서 순서 변경 버튼 */}
                    {editMode && isAdmin && (
                      <div className="flex flex-col gap-0.5">
                        <button
                          className={`p-0.5 rounded hover:bg-gray-200 ${index === 0 ? 'opacity-30' : ''}`}
                          onClick={(e) => { e.stopPropagation(); moveClient(index, 'up') }}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-3 w-3 text-gray-500" />
                        </button>
                        <button
                          className={`p-0.5 rounded hover:bg-gray-200 ${index === clients.length - 1 ? 'opacity-30' : ''}`}
                          onClick={(e) => { e.stopPropagation(); moveClient(index, 'down') }}
                          disabled={index === clients.length - 1}
                        >
                          <ArrowDown className="h-3 w-3 text-gray-500" />
                        </button>
                      </div>
                    )}
                    
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: selectedClient?.id === client.id ? 'white' : (client.color || '#3B82F6') }}
                    />
                    <span className="text-sm font-medium flex-1 truncate">{client.name}</span>
                    
                    {!editMode && (
                      <ChevronRight className={`h-4 w-4 transition-opacity ${
                        selectedClient?.id === client.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`} />
                    )}
                    
                    {/* 편집 모드에서 수정/삭제 버튼 */}
                    {editMode && isAdmin && (
                      <div className="flex gap-1">
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
                <div className="flex items-center gap-2">
                  <Button 
                    variant={showTrash ? "default" : "outline"} 
                    size="sm"
                    onClick={() => showTrash ? handleSelectClient(selectedClient) : loadDeletedPlans()}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    휴지통 {showTrash && deletedPlans.length > 0 && `(${deletedPlans.length})`}
                  </Button>
                  {!showTrash && (
                    <Button onClick={() => setShowAddPlanModal(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      새 기획안
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* 기획안 목록 */}
            <div className="flex-1 overflow-y-auto p-6">
              {plansLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : showTrash ? (
                // 휴지통
                deletedPlans.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Trash2 className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                      <p className="text-gray-500">휴지통이 비어있습니다.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {deletedPlans.map(plan => (
                      <Card key={plan.id} className="opacity-60 hover:opacity-100 transition-opacity">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <Badge className="bg-red-100 text-red-600">삭제됨</Badge>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={(e) => handleRestorePlan(plan.id, e)}
                                title="복원"
                              >
                                <RotateCcw className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={(e) => handlePermanentDelete(plan.id, e)}
                                title="영구 삭제"
                              >
                                <X className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                          <h3 className="font-semibold text-lg mb-2 line-clamp-2">{plan.title}</h3>
                          <p className="text-xs text-gray-400">
                            삭제일: {plan.deleted_at ? new Date(plan.deleted_at).toLocaleDateString() : ''}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
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
                    const isCompleted = (plan as any).is_completed
                    return (
                      <Card 
                        key={plan.id}
                        className="cursor-pointer hover:shadow-lg transition-shadow group relative"
                        onClick={() => router.push(`/project-plans/${selectedClient.id}/${plan.id}`)}
                      >
                        <CardContent className="p-4">
                          {/* 카드 미리보기 - 우상단 */}
                          {(plan as any).card_preview && (
                            <div className="absolute top-2 right-2 max-w-[120px]">
                              <span className="text-xs text-gray-400 truncate block" title={(plan as any).card_preview}>
                                {(plan as any).card_preview}
                              </span>
                            </div>
                          )}
                          
                          <div className="flex items-start justify-between mb-3">
                            {/* 완료 체크 버튼 */}
                            <button
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                isCompleted 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-amber-100 text-amber-700'
                              }`}
                              onClick={(e) => toggleComplete(plan, e)}
                            >
                              {isCompleted ? (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  완료됨
                                </>
                              ) : (
                                <>
                                  <Film className="h-3.5 w-3.5" />
                                  제작 완료
                                </>
                              )}
                            </button>
                            
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                              onClick={(e) => handleDeletePlan(plan.id, e)}
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                          
                          <h3 className="font-semibold text-lg mb-2 line-clamp-2 pr-8">{plan.title}</h3>
                          
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
