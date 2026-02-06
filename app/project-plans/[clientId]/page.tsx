'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 이 페이지는 메인 페이지로 리다이렉트합니다
export default function ClientPlansPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/project-plans')
  }, [router])

  return null
}
  
  const [client, setClient] = useState<Client | null>(null)
  const [plans, setPlans] = useState<ProjectPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  
  // 새 기획안 추가
  const [showAddModal, setShowAddModal] = useState(false)
  const [newPlanTitle, setNewPlanTitle] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    checkPermissionAndLoad()
  }, [clientId, user, isAdmin])

  async function checkPermissionAndLoad() {
    if (!user) {
      setLoading(false)
      return
    }
    
    try {
      // 관리자이거나 권한이 있는 경우에만 접근 가능
      if (isAdmin) {
        setHasPermission(true)
      } else {
        const permitted = await checkClientPermission(user.id, clientId)
        setHasPermission(permitted)
        if (!permitted) {
          setLoading(false)
          return
        }
      }
      
      const [clientData, plansData] = await Promise.all([
        getClient(clientId),
        getProjectPlans(clientId)
      ])
      
      setClient(clientData)
      setPlans(plansData)
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddPlan() {
    if (!newPlanTitle.trim()) return
    
    setAdding(true)
    try {
      const newPlan = await createProjectPlan({
        client_id: clientId,
        title: newPlanTitle.trim(),
        status: 'draft',
        scene_count: 0
      })
      setNewPlanTitle('')
      setShowAddModal(false)
      // 새로 생성된 기획안 페이지로 이동
      router.push(`/project-plans/${clientId}/${newPlan.id}`)
    } catch (error) {
      console.error('기획안 생성 실패:', error)
      alert('기획안 생성에 실패했습니다.')
    } finally {
      setAdding(false)
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

  const filteredPlans = plans.filter(p => 
    p.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">로그인이 필요합니다.</p>
      </div>
    )
  }

  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Folder className="h-16 w-16 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">이 클라이언트에 대한 접근 권한이 없습니다.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/project-plans')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            돌아가기
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="p-6 border-b bg-white">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/project-plans')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            돌아가기
          </Button>
          {client && (
            <div className="flex items-center gap-2">
              <div 
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: client.color || '#3B82F6' }}
              />
              <span className="font-bold text-lg">{client.name}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">기획안 목록</h1>
            <span className="text-sm text-gray-500">총 {plans.length}개</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex border rounded-lg overflow-hidden">
              <Button 
                variant={viewMode === 'grid' ? 'default' : 'ghost'} 
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button 
                variant={viewMode === 'list' ? 'default' : 'ghost'} 
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              새 기획안
            </Button>
          </div>
        </div>
      </div>

      {/* 기획안 목록 */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {filteredPlans.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileText className="h-16 w-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-4">
                {searchTerm ? '검색 결과가 없습니다.' : '아직 기획안이 없습니다.'}
              </p>
              {!searchTerm && (
                <Button onClick={() => setShowAddModal(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  첫 기획안 만들기
                </Button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredPlans.map(plan => {
              const status = STATUS_CONFIG[plan.status]
              return (
                <Card 
                  key={plan.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow group"
                  onClick={() => router.push(`/project-plans/${clientId}/${plan.id}`)}
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
        ) : (
          <div className="space-y-2">
            {filteredPlans.map(plan => {
              const status = STATUS_CONFIG[plan.status]
              return (
                <Card 
                  key={plan.id}
                  className="cursor-pointer hover:shadow-md transition-shadow group"
                  onClick={() => router.push(`/project-plans/${clientId}/${plan.id}`)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <Badge className={status.color}>
                      {plan.status === 'completed' && <Check className="h-3 w-3 mr-1" />}
                      {status.label}
                    </Badge>
                    
                    <h3 className="font-semibold flex-1">{plan.title}</h3>
                    
                    <div className="flex items-center gap-6 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Film className="h-4 w-4" />
                        {plan.scene_count}개 장면
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {new Date(plan.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleDeletePlan(plan.id, e)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* 새 기획안 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
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
              <Button className="flex-1" onClick={handleAddPlan} disabled={adding || !newPlanTitle.trim()}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                만들기
              </Button>
              <Button variant="outline" onClick={() => setShowAddModal(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
