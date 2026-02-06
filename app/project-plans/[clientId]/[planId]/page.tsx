'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, Plus, X, Upload, Image as ImageIcon, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-context'
import { 
  getClient,
  getProjectPlan,
  updateProjectPlan,
  getPlanScenes,
  createPlanScene,
  updatePlanScene,
  deletePlanScene,
  updateSceneCount,
  checkClientPermission,
  Client,
  ProjectPlan,
  PlanScene
} from '@/lib/api/clients'

interface SceneData {
  id?: string
  scene_number: number
  image_url: string
  timeline: string
  sources: string[]
  effect: string
  special_notes: string
  script: string
  source_info: string
}

export default function PlanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.clientId as string
  const planId = params.planId as string
  const { user, isAdmin } = useAuth()
  
  const [client, setClient] = useState<Client | null>(null)
  const [plan, setPlan] = useState<ProjectPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasPermission, setHasPermission] = useState(false)
  
  // 기획안 데이터
  const [title, setTitle] = useState('')
  const [reference, setReference] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [cardPreview, setCardPreview] = useState('')
  
  // 씬 데이터
  const [scenes, setScenes] = useState<SceneData[]>([])
  
  // 행 높이 관리 (기본값 설정)
  const [rowHeights, setRowHeights] = useState({
    video: 180,
    timeline: 50,
    sources: 80,
    effect: 50,
    special_notes: 50,
    script: 120,
    source_info: 80
  })
  const [resizing, setResizing] = useState<string | null>(null)
  const [startY, setStartY] = useState(0)
  const [startHeight, setStartHeight] = useState(0)
  
  // 저장 상태 추적
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showExitModal, setShowExitModal] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const initialLoadRef = useRef(true)
  
  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({})

  useEffect(() => {
    checkPermissionAndLoad()
  }, [clientId, planId, user, isAdmin])

  async function checkPermissionAndLoad() {
    if (!user) {
      setLoading(false)
      return
    }
    
    try {
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
      
      const [clientData, planData, scenesData] = await Promise.all([
        getClient(clientId),
        getProjectPlan(planId),
        getPlanScenes(planId)
      ])
      
      setClient(clientData)
      setPlan(planData)
      
      if (planData) {
        setTitle(planData.title)
      }
      
      if (scenesData.length > 0) {
        setScenes(scenesData.map(s => ({
          id: s.id,
          scene_number: s.scene_number,
          image_url: s.image_url || '',
          timeline: s.timeline || '',
          sources: s.sources || [''],
          effect: s.effect || '',
          special_notes: s.special_notes || '',
          script: s.script || '',
          source_info: s.source_info || ''
        })))
      } else {
        // 기본 5개 씬 추가
        setScenes([
          createEmptyScene(1),
          createEmptyScene(2),
          createEmptyScene(3),
          createEmptyScene(4),
          createEmptyScene(5)
        ])
      }
      initialLoadRef.current = false
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  function createEmptyScene(sceneNumber: number): SceneData {
    return {
      scene_number: sceneNumber,
      image_url: '',
      timeline: '',
      sources: [''],
      effect: '',
      special_notes: '',
      script: '',
      source_info: ''
    }
  }

  // 변경 감지
  useEffect(() => {
    if (!initialLoadRef.current) {
      setHasUnsavedChanges(true)
    }
  }, [title, scenes, reference, ctaText, cardPreview])

  // 페이지 이탈 감지 (브라우저)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // 뒤로가기 처리
  const handleGoBack = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowExitModal(true)
      setPendingNavigation('/project-plans')
    } else {
      router.push('/project-plans')
    }
  }, [hasUnsavedChanges, router])

  // 행 높이 조절 핸들러
  const handleResizeStart = useCallback((rowKey: string, e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(rowKey)
    setStartY(e.clientY)
    setStartHeight(rowHeights[rowKey as keyof typeof rowHeights])
  }, [rowHeights])

  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientY - startY
      const newHeight = Math.max(40, startHeight + diff) // 최소 40px
      setRowHeights(prev => ({
        ...prev,
        [resizing]: newHeight
      }))
    }

    const handleMouseUp = () => {
      setResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizing, startY, startHeight])

  function addScene() {
    const newSceneNumber = scenes.length + 1
    setScenes([...scenes, createEmptyScene(newSceneNumber)])
  }

  function removeScene(index: number) {
    if (scenes.length <= 1) return
    const newScenes = scenes.filter((_, i) => i !== index).map((s, i) => ({
      ...s,
      scene_number: i + 1
    }))
    setScenes(newScenes)
  }

  // 씬 위로 이동
  function moveSceneUp(index: number) {
    if (index === 0) return
    const newScenes = [...scenes]
    const temp = newScenes[index - 1]
    newScenes[index - 1] = { ...newScenes[index], scene_number: index }
    newScenes[index] = { ...temp, scene_number: index + 1 }
    setScenes(newScenes)
  }

  // 씬 아래로 이동
  function moveSceneDown(index: number) {
    if (index === scenes.length - 1) return
    const newScenes = [...scenes]
    const temp = newScenes[index + 1]
    newScenes[index + 1] = { ...newScenes[index], scene_number: index + 2 }
    newScenes[index] = { ...temp, scene_number: index + 1 }
    setScenes(newScenes)
  }

  function updateScene(index: number, field: keyof SceneData, value: string | string[]) {
    const newScenes = [...scenes]
    newScenes[index] = { ...newScenes[index], [field]: value }
    setScenes(newScenes)
  }

  function addSource(sceneIndex: number) {
    const newScenes = [...scenes]
    newScenes[sceneIndex].sources.push('')
    setScenes(newScenes)
  }

  function removeSource(sceneIndex: number, sourceIndex: number) {
    const newScenes = [...scenes]
    if (newScenes[sceneIndex].sources.length <= 1) return
    newScenes[sceneIndex].sources.splice(sourceIndex, 1)
    setScenes(newScenes)
  }

  function updateSource(sceneIndex: number, sourceIndex: number, value: string) {
    const newScenes = [...scenes]
    newScenes[sceneIndex].sources[sourceIndex] = value
    setScenes(newScenes)
  }

  function handleImageUpload(sceneIndex: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = () => {
      updateScene(sceneIndex, 'image_url', reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    if (!plan) return
    
    setSaving(true)
    try {
      // 기획안 정보 업데이트
      await updateProjectPlan(planId, {
        title,
        scene_count: scenes.length
      })
      
      // 기존 씬 삭제 후 새로 생성 (간단한 구현)
      const existingScenes = await getPlanScenes(planId)
      for (const scene of existingScenes) {
        await deletePlanScene(scene.id)
      }
      
      // 새 씬 생성
      for (const scene of scenes) {
        await createPlanScene({
          plan_id: planId,
          scene_number: scene.scene_number,
          image_url: scene.image_url || null,
          timeline: scene.timeline || null,
          sources: scene.sources.filter(s => s.trim()),
          effect: scene.effect || null,
          special_notes: scene.special_notes || null,
          script: scene.script || null,
          source_info: scene.source_info || null
        })
      }
      
      await updateSceneCount(planId)
      
      setHasUnsavedChanges(false)
      alert('저장되었습니다!')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!user || !hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">접근 권한이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className={`h-full flex flex-col bg-white ${resizing ? 'select-none' : ''}`} style={resizing ? { cursor: 'row-resize' } : {}}>
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleGoBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            돌아가기
          </Button>
          {client && (
            <span style={{ color: client.color || '#F97316' }} className="font-medium">{client.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <span className="text-sm text-orange-500">저장되지 않은 변경사항이 있습니다</span>
          )}
          <Button onClick={handleSave} disabled={saving} className="bg-orange-500 hover:bg-orange-600">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            저장하기
          </Button>
        </div>
      </div>

      {/* 기획안 제목 & 메타 정보 */}
      <div className="p-6 border-b">
        <div className="flex gap-6">
          <div className="flex-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="기획안 제목을 입력하세요"
              className="text-2xl font-bold border-0 border-b rounded-none px-0 focus-visible:ring-0"
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label className="text-sm text-gray-500 mb-1 block">레퍼런스</label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="레퍼런스 입력..."
                className="w-48"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500 mb-1 block">CTA 문장</label>
              <Input
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                placeholder="CTA 문장 입력..."
                className="w-48"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500 mb-1 block">카드 미리보기</label>
              <Input
                value={cardPreview}
                onChange={(e) => setCardPreview(e.target.value)}
                placeholder="카드에 표시될 설명..."
                className="w-48"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 씬 테이블 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-24" />
              {scenes.map((_, index) => (
                <col key={index} style={{ width: '200px', minWidth: '200px' }} />
              ))}
              <col className="w-12" />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="w-24 p-3 text-left text-sm font-medium text-gray-500 border-r"></th>
                {scenes.map((scene, index) => (
                  <th key={index} className="w-[200px] p-3 text-center text-sm font-medium border-r last:border-r-0 relative group">
                    <div className="flex items-center justify-center gap-1">
                      {/* 왼쪽 이동 버튼 */}
                      <button
                        className={`p-1 rounded transition-colors ${index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-200'}`}
                        onClick={() => moveSceneUp(index)}
                        disabled={index === 0}
                      >
                        <ChevronUp className="h-4 w-4 text-gray-500 rotate-[-90deg]" />
                      </button>
                      <span className="text-gray-700 font-semibold">#{scene.scene_number}</span>
                      {/* 오른쪽 이동 버튼 */}
                      <button
                        className={`p-1 rounded transition-colors ${index === scenes.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-200'}`}
                        onClick={() => moveSceneDown(index)}
                        disabled={index === scenes.length - 1}
                      >
                        <ChevronDown className="h-4 w-4 text-gray-500 rotate-[-90deg]" />
                      </button>
                    </div>
                    {scenes.length > 1 && (
                      <button
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded"
                        onClick={() => removeScene(index)}
                      >
                        <X className="h-3 w-3 text-red-500" />
                      </button>
                    )}
                  </th>
                ))}
                <th className="w-12 p-3">
                  <Button size="sm" variant="ghost" onClick={addScene} className="w-full">
                    <Plus className="h-4 w-4" />
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 영상 (이미지) */}
              <tr style={{ height: rowHeights.video }}>
                <td className="p-3 bg-orange-50 border-r font-medium text-sm text-gray-700 align-top">영상</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top overflow-hidden">
                    <div 
                      className="w-full bg-gray-100 rounded-lg flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors overflow-hidden"
                      style={{ height: rowHeights.video - 16 }}
                      onClick={() => fileInputRefs.current[index]?.click()}
                    >
                      {scene.image_url ? (
                        <img src={scene.image_url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-center">
                          <ImageIcon className="h-8 w-8 text-gray-400 mx-auto mb-1" />
                          <span className="text-xs text-gray-400">이미지 업로드</span>
                        </div>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      ref={el => { fileInputRefs.current[index] = el }}
                      onChange={(e) => handleImageUpload(index, e)}
                    />
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 영상 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('video', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 타임라인 */}
              <tr style={{ height: rowHeights.timeline }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 align-middle">타임라인</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-middle">
                    <Input
                      value={scene.timeline}
                      onChange={(e) => updateScene(index, 'timeline', e.target.value)}
                      placeholder="타임라인..."
                      className="text-sm"
                    />
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 타임라인 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('timeline', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 소스 */}
              <tr style={{ height: rowHeights.sources }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 align-top">소스</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top overflow-auto" style={{ maxHeight: rowHeights.sources - 8 }}>
                    <div className="space-y-1">
                      {scene.sources.map((source, sIndex) => (
                        <div key={sIndex} className="flex gap-1">
                          <Input
                            value={source}
                            onChange={(e) => updateSource(index, sIndex, e.target.value)}
                            placeholder="소스..."
                            className="text-sm h-8"
                          />
                          {scene.sources.length > 1 && (
                            <Button size="sm" variant="ghost" className="px-2 h-8" onClick={() => removeSource(index, sIndex)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" className="w-full text-xs h-7" onClick={() => addSource(index)}>
                        <Plus className="h-3 w-3 mr-1" />
                        추가
                      </Button>
                    </div>
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 소스 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('sources', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 효과 */}
              <tr style={{ height: rowHeights.effect }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 align-middle">효과</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-middle">
                    <Input
                      value={scene.effect}
                      onChange={(e) => updateScene(index, 'effect', e.target.value)}
                      placeholder="효과..."
                      className="text-sm"
                    />
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 효과 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('effect', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 특이사항 */}
              <tr style={{ height: rowHeights.special_notes }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 align-middle">특이사항</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-middle">
                    <Input
                      value={scene.special_notes}
                      onChange={(e) => updateScene(index, 'special_notes', e.target.value)}
                      placeholder="특이사항..."
                      className="text-sm"
                    />
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 특이사항 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('special_notes', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 대본 (나레이션) */}
              <tr style={{ height: rowHeights.script }}>
                <td className="p-3 bg-orange-50 border-r font-medium text-sm text-gray-700 align-top">
                  대본<br/><span className="text-xs text-gray-400">(나레이션)</span>
                </td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top">
                    <Textarea
                      value={scene.script}
                      onChange={(e) => updateScene(index, 'script', e.target.value)}
                      placeholder="대본/나레이션..."
                      className="text-sm resize-none"
                      style={{ height: rowHeights.script - 16 }}
                    />
                  </td>
                ))}
                <td></td>
              </tr>
              {/* 대본 리사이즈 핸들 */}
              <tr>
                <td colSpan={scenes.length + 2} className="p-0 h-1 relative">
                  <div
                    className="absolute inset-x-0 -top-1 h-3 cursor-row-resize hover:bg-blue-100 z-10 flex items-center justify-center group"
                    onMouseDown={(e) => handleResizeStart('script', e)}
                  >
                    <div className="w-16 h-1 bg-gray-200 rounded opacity-0 group-hover:opacity-100 group-hover:bg-blue-400 transition-opacity" />
                  </div>
                  <div className="border-b border-gray-200" />
                </td>
              </tr>

              {/* 소스 정보 */}
              <tr style={{ height: rowHeights.source_info }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 align-top">소스</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top">
                    <Textarea
                      value={scene.source_info}
                      onChange={(e) => updateScene(index, 'source_info', e.target.value)}
                      placeholder="소스 정보..."
                      className="text-sm resize-none"
                      style={{ height: rowHeights.source_info - 16 }}
                    />
                  </td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 저장 확인 모달 */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-3">저장 확인</h3>
            <p className="text-gray-600 mb-6">저장을 하지 않고 나가시겠습니까?</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowExitModal(false)
                  if (pendingNavigation) {
                    router.push(pendingNavigation)
                  }
                }}
              >
                예
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setShowExitModal(false)
                  setPendingNavigation(null)
                }}
              >
                아니오
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
