'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, Plus, X, Upload, Image as ImageIcon, Trash2, ChevronUp, ChevronDown, GripVertical, FileUp, File, Download, FileSpreadsheet } from 'lucide-react'
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
  PlanScene,
  RowHeights
} from '@/lib/api/clients'

interface SceneFile {
  name: string
  url: string
  size: number
}

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
  files: SceneFile[]
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
  const DEFAULT_ROW_HEIGHTS: RowHeights = {
    video: 180,
    timeline: 80,
    effect: 50,
    special_notes: 50,
    script: 120,
    source_info: 140
  }
  const [rowHeights, setRowHeights] = useState<RowHeights>(DEFAULT_ROW_HEIGHTS)
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
        // 저장된 행 높이가 있으면 로드
        if (planData.row_heights) {
          setRowHeights({ ...DEFAULT_ROW_HEIGHTS, ...planData.row_heights })
        }
        // reference, cta_text, card_preview 로드
        setReference((planData as any).reference || '')
        setCtaText((planData as any).cta_text || '')
        setCardPreview((planData as any).card_preview || '')
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
          source_info: s.source_info || '',
          files: (s as any).files || []
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
      source_info: '',
      files: []
    }
  }

  // 변경 감지
  useEffect(() => {
    if (!initialLoadRef.current) {
      setHasUnsavedChanges(true)
    }
  }, [title, scenes, reference, ctaText, cardPreview, rowHeights])

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

  // 파일 업로드 핸들러 (슬롯별 업로드, 5MB)
  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
  const MAX_FILES = 3

  function handleFileUploadSlot(sceneIndex: number, slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      alert(`${file.name}: 파일 크기가 5MB를 초과합니다.`)
      e.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const newFile: SceneFile = {
        name: file.name,
        url: reader.result as string,
        size: file.size
      }
      
      const newScenes = [...scenes]
      // 슬롯 배열이 부족하면 확장
      while (newScenes[sceneIndex].files.length <= slotIndex) {
        newScenes[sceneIndex].files.push({ name: '', url: '', size: 0 })
      }
      newScenes[sceneIndex].files[slotIndex] = newFile
      setScenes(newScenes)
    }
    reader.readAsDataURL(file)
    
    // input 초기화
    e.target.value = ''
  }

  function removeFile(sceneIndex: number, fileIndex: number) {
    const newScenes = [...scenes]
    newScenes[sceneIndex].files[fileIndex] = { name: '', url: '', size: 0 }
    setScenes(newScenes)
  }

  // 파일 다운로드
  function downloadFile(file: SceneFile) {
    if (!file.url || !file.name) return
    
    const link = document.createElement('a')
    link.href = file.url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 각 씬의 각 슬롯에 대한 ref
  const sourceFileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  async function handleSave() {
    if (!plan) return
    
    setSaving(true)
    try {
      // 기획안 정보 업데이트 (행 높이, reference, cta_text, card_preview 포함)
      try {
        await updateProjectPlan(planId, {
          title,
          scene_count: scenes.length,
          row_heights: rowHeights,
          reference: reference || null,
          cta_text: ctaText || null,
          card_preview: cardPreview || null
        } as any)
      } catch (planError: any) {
        console.error('기획안 정보 업데이트 실패:', planError)
        // 새 컬럼이 없을 수 있으므로 기본 필드만 저장 시도
        await updateProjectPlan(planId, {
          title,
          scene_count: scenes.length,
          row_heights: rowHeights
        } as any)
      }
      
      // 기존 씬 삭제 후 새로 생성 (간단한 구현)
      const existingScenes = await getPlanScenes(planId)
      for (const scene of existingScenes) {
        await deletePlanScene(scene.id)
      }
      
      // 새 씬 생성 (files 포함)
      for (const scene of scenes) {
        const sceneData: any = {
          plan_id: planId,
          scene_number: scene.scene_number,
          image_url: scene.image_url || null,
          timeline: scene.timeline || null,
          sources: scene.sources.filter(s => s.trim()),
          effect: scene.effect || null,
          special_notes: scene.special_notes || null,
          script: scene.script || null,
          source_info: scene.source_info || null
        }
        
        // files가 있으면 추가
        const validFiles = scene.files?.filter(f => f && f.name && f.url) || []
        if (validFiles.length > 0) {
          sceneData.files = validFiles
        }
        
        await createPlanScene(sceneData)
      }
      
      await updateSceneCount(planId)
      
      setHasUnsavedChanges(false)
      alert('저장되었습니다!')
    } catch (error: any) {
      console.error('저장 실패:', error)
      alert(`저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    } finally {
      setSaving(false)
    }
  }

  // Excel 내보내기
  function exportToExcel() {
    // CSV 형식으로 데이터 생성
    const headers = ['구분', ...scenes.map(s => `#${s.scene_number}`)].join(',')
    
    const rows = [
      ['타임라인', ...scenes.map(s => `"${(s.timeline || '').replace(/"/g, '""')}"`)].join(','),
      ['효과', ...scenes.map(s => `"${(s.effect || '').replace(/"/g, '""')}"`)].join(','),
      ['특이사항', ...scenes.map(s => `"${(s.special_notes || '').replace(/"/g, '""')}"`)].join(','),
      ['대본', ...scenes.map(s => `"${(s.script || '').replace(/"/g, '""')}"`)].join(','),
      ['소스정보', ...scenes.map(s => `"${(s.source_info || '').replace(/"/g, '""')}"`)].join(','),
    ]
    
    const csvContent = [headers, ...rows].join('\n')
    
    // BOM 추가 (한글 깨짐 방지)
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
    
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${title || '기획안'}_${new Date().toLocaleDateString()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
      {/* 통합 상단 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div className="flex items-center gap-4 flex-1">
          <Button variant="ghost" size="sm" onClick={handleGoBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            돌아가기
          </Button>
          {client && (
            <span style={{ color: client.color || '#F97316' }} className="font-medium">{client.name}</span>
          )}
          <div className="h-6 w-px bg-gray-200" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="기획안 제목"
            className="text-lg font-bold border-0 bg-transparent px-2 w-64 focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="레퍼런스..."
              className="w-36 h-8 text-sm"
            />
            <Input
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="CTA 문장..."
              className="w-44 h-8 text-sm"
            />
            <Input
              value={cardPreview}
              onChange={(e) => setCardPreview(e.target.value)}
              placeholder="카드 미리보기..."
              className="w-40 h-8 text-sm"
            />
          </div>
          {hasUnsavedChanges && (
            <span className="text-xs text-orange-500 whitespace-nowrap">변경사항 있음</span>
          )}
          <Button onClick={exportToExcel} size="sm" variant="outline">
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            내보내기
          </Button>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-orange-500 hover:bg-orange-600">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      {/* 씬 테이블 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="border rounded-lg overflow-x-auto">
          <table className="table-fixed" style={{ minWidth: `${100 + scenes.length * 180 + 48}px` }}>
            <colgroup>
              <col style={{ width: '100px' }} />
              {scenes.map((_, index) => (
                <col key={index} style={{ width: '180px' }} />
              ))}
              <col style={{ width: '48px' }} />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="p-3 text-left text-sm font-medium text-gray-500 border-r" style={{ width: '100px' }}></th>
                {scenes.map((scene, index) => (
                  <th key={index} className="p-3 text-center text-sm font-medium border-r last:border-r-0 relative group" style={{ width: '180px' }}>
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
                <th className="p-3" style={{ width: '48px' }}>
                  <Button size="sm" variant="ghost" onClick={addScene} className="w-full">
                    <Plus className="h-4 w-4" />
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 영상 (이미지) */}
              <tr style={{ height: rowHeights.video }}>
                <td className="p-3 bg-orange-50 border-r font-medium text-sm text-gray-700 text-center align-middle">영상</td>
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

              {/* 타임라인 - Textarea로 변경 */}
              <tr style={{ height: rowHeights.timeline }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 text-center align-middle">타임라인</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top">
                    <Textarea
                      value={scene.timeline}
                      onChange={(e) => updateScene(index, 'timeline', e.target.value)}
                      placeholder="타임라인..."
                      className="text-sm resize-none"
                      style={{ height: rowHeights.timeline - 16 }}
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

              {/* 효과 */}
              <tr style={{ height: rowHeights.effect }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 text-center align-middle">효과</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top">
                    <Textarea
                      value={scene.effect}
                      onChange={(e) => updateScene(index, 'effect', e.target.value)}
                      placeholder="효과..."
                      className="text-sm resize-none"
                      style={{ height: rowHeights.effect - 16 }}
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
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 text-center align-middle">특이사항</td>
                {scenes.map((scene, index) => (
                  <td key={index} className="p-2 border-r last:border-r-0 align-top">
                    <Textarea
                      value={scene.special_notes}
                      onChange={(e) => updateScene(index, 'special_notes', e.target.value)}
                      placeholder="특이사항..."
                      className="text-sm resize-none"
                      style={{ height: rowHeights.special_notes - 16 }}
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
                <td className="p-3 bg-orange-50 border-r font-medium text-sm text-gray-700 text-center align-middle">
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

              {/* 소스 파일 업로드 - 3개 슬롯 */}
              <tr style={{ height: rowHeights.source_info }}>
                <td className="p-3 bg-gray-50 border-r font-medium text-sm text-gray-700 text-center align-middle">
                  소스<br/><span className="text-xs text-gray-400">(파일)</span>
                </td>
                {scenes.map((scene, sceneIndex) => (
                  <td key={sceneIndex} className="p-2 border-r last:border-r-0 align-top">
                    <div className="space-y-1" style={{ height: rowHeights.source_info - 16, overflow: 'auto' }}>
                      {/* 3개의 파일 슬롯 */}
                      {[0, 1, 2].map((slotIndex) => {
                        const file = scene.files[slotIndex]
                        const hasFile = file && file.name && file.url
                        const refKey = `${sceneIndex}-${slotIndex}`
                        
                        return (
                          <div key={slotIndex}>
                            {hasFile ? (
                              <div className="flex items-center gap-1 p-1.5 bg-gray-50 rounded text-xs group border">
                                <File className="h-3 w-3 text-blue-500 flex-shrink-0" />
                                <span className="truncate flex-1" title={file.name}>{file.name}</span>
                                <span className="text-gray-400 flex-shrink-0">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                                <button 
                                  className="p-0.5 hover:bg-blue-100 rounded"
                                  onClick={() => downloadFile(file)}
                                  title="다운로드"
                                >
                                  <Download className="h-3 w-3 text-blue-500" />
                                </button>
                                <button 
                                  className="p-0.5 hover:bg-red-100 rounded"
                                  onClick={() => removeFile(sceneIndex, slotIndex)}
                                  title="삭제"
                                >
                                  <X className="h-3 w-3 text-red-500" />
                                </button>
                              </div>
                            ) : (
                              <button
                                className="w-full flex items-center justify-center gap-1 p-1.5 border border-dashed border-gray-300 rounded hover:border-blue-400 hover:bg-blue-50 transition-colors"
                                onClick={() => sourceFileInputRefs.current[refKey]?.click()}
                              >
                                <FileUp className="h-3 w-3 text-gray-400" />
                                <span className="text-xs text-gray-500">소스 {slotIndex + 1}</span>
                              </button>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              ref={el => { sourceFileInputRefs.current[refKey] = el }}
                              onChange={(e) => handleFileUploadSlot(sceneIndex, slotIndex, e)}
                            />
                          </div>
                        )
                      })}
                    </div>
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
