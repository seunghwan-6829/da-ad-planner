'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, ExternalLink, FolderPlus, FolderTree, Loader2, Pencil, PlaySquare, Plus, Trash2, Upload, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-context'
import {
  createVideoBoardCategory,
  createVideoBoardGroup,
  createVideoBoardItem,
  deleteVideoBoardItems,
  getVideoBoardCategories,
  getVideoBoardGroups,
  getVideoBoardItemsPaginated,
  updateVideoBoardItem,
  uploadVideoBoardFile,
} from '@/lib/api/video-board'
import { VideoBoardCategory, VideoBoardGroup, VideoBoardItem } from '@/lib/supabase'

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100]
const DEFAULT_VIDEO_TITLE = '영상 보드 항목'
const MAX_VIDEO_SIZE = 50 * 1024 * 1024
const MAX_BATCH_UPLOAD = 10

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

interface VideoMetadata {
  duration: number
  width: number
  height: number
  sizeBytes: number
  mimeType: string
}

interface VideoFrame {
  dataUrl: string
  timestampLabel: string
}

interface UploadCandidate {
  id: string
  file: File
  previewUrl: string
  title: string
  metadata: VideoMetadata
  posterDataUrl: string
  frames: VideoFrame[]
  status: UploadStatus
  error: string
}

function slugify(text: string) {
  return text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣_]/g, '')
}

function createShareId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '-'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(size: number | null) {
  if (!size) return '-'
  return `${(size / 1024 / 1024).toFixed(2)}MB`
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function onceEvent<T extends Event>(target: EventTarget, eventName: string) {
  return new Promise<T>((resolve, reject) => {
    const onSuccess = (event: Event) => {
      cleanup()
      resolve(event as T)
    }

    const onError = () => {
      cleanup()
      reject(new Error(`${eventName} 이벤트 처리에 실패했습니다.`))
    }

    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess)
      target.removeEventListener('error', onError)
    }

    target.addEventListener(eventName, onSuccess, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

async function prepareVideo(file: File): Promise<UploadCandidate> {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  await onceEvent(video, 'loadedmetadata')

  const metadata: VideoMetadata = {
    duration: video.duration || 0,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
    sizeBytes: file.size,
    mimeType: file.type || 'video/mp4',
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('영상 프레임을 처리하지 못했습니다.')
  }

  const targetWidth = Math.min(video.videoWidth || 1080, 720)
  const targetHeight = Math.max(1, Math.round(((video.videoHeight || 1920) / Math.max(video.videoWidth || 1080, 1)) * targetWidth))
  canvas.width = targetWidth
  canvas.height = targetHeight

  const timestamps: number[] = []
  if (metadata.duration <= 0) {
    timestamps.push(0)
  } else {
    const interval = Math.max(3, Math.round(metadata.duration / 6))
    for (let time = 0; time < metadata.duration && timestamps.length < 8; time += interval) {
      timestamps.push(Number(Math.min(time, Math.max(metadata.duration - 0.1, 0)).toFixed(2)))
    }
    const lastFrame = Number(Math.max(metadata.duration - 0.1, 0).toFixed(2))
    if (!timestamps.includes(lastFrame)) {
      timestamps.push(lastFrame)
    }
  }

  const frames: VideoFrame[] = []
  for (const timestamp of timestamps) {
    video.currentTime = timestamp
    await onceEvent(video, 'seeked')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const minutes = Math.floor(timestamp / 60)
    const seconds = Math.round(timestamp % 60)
    frames.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      timestampLabel: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    })
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: objectUrl,
    title: '',
    metadata,
    posterDataUrl: frames[0]?.dataUrl || '',
    frames,
    status: 'idle',
    error: '',
  }
}

async function createPosterFile(dataUrl: string, fileName: string) {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], fileName, { type: 'image/jpeg' })
}

export default function VideoBoardPage() {
  const { user, isAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<VideoBoardItem[]>([])
  const [categories, setCategories] = useState<VideoBoardCategory[]>([])
  const [groups, setGroups] = useState<VideoBoardGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveToastOpen, setSaveToastOpen] = useState(false)
  const [saveToastMessage, setSaveToastMessage] = useState('')
  const [saveToastError, setSaveToastError] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState('all')
  const [selectedGroupId, setSelectedGroupId] = useState('all')
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [previewItem, setPreviewItem] = useState<VideoBoardItem | null>(null)
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null)
  const [uploadQueue, setUploadQueue] = useState<UploadCandidate[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#E2E8F0')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#E2E8F0')
  const [editTarget, setEditTarget] = useState<VideoBoardItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editGroupId, setEditGroupId] = useState('')

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const canUseGroups = selectedCategoryId !== 'all' && selectedCategoryId !== 'uncategorized'

  const filterCategories = useMemo(
    () => [{ id: 'all', name: '전체' }, { id: 'uncategorized', name: '미분류' }, ...categories.map((category) => ({ id: category.id, name: category.name }))],
    [categories]
  )

  const filterGroups = useMemo(
    () => [{ id: 'all', name: '전체' }, { id: 'ungrouped', name: '그룹 없음' }, ...groups.map((group) => ({ id: group.id, name: group.name }))],
    [groups]
  )

  useEffect(() => {
    loadData()
  }, [currentPage, pageSize, selectedCategoryId, selectedGroupId])

  useEffect(() => {
    if (!canUseGroups) {
      setSelectedGroupId('all')
      setGroups([])
      return
    }

    getVideoBoardGroups(selectedCategoryId).then(setGroups)
  }, [canUseGroups, selectedCategoryId])

  useEffect(() => {
    if (!saveToastOpen) return
    const timer = window.setTimeout(() => setSaveToastOpen(false), 2600)
    return () => window.clearTimeout(timer)
  }, [saveToastOpen])

  async function loadData() {
    setLoading(true)
    const [categoryData, listResult] = await Promise.all([
      getVideoBoardCategories(),
      getVideoBoardItemsPaginated({
        page: currentPage,
        pageSize,
        categoryId: selectedCategoryId,
        groupId: canUseGroups ? selectedGroupId : 'all',
      }),
    ])

    setCategories(categoryData)
    setItems(listResult.data)
    setTotalCount(listResult.totalCount)
    setCategoryCounts(listResult.categoryCounts)
    setGroupCounts(listResult.groupCounts)
    setLoading(false)
  }

  function openToast(message: string, isError = false) {
    setSaveToastMessage(message)
    setSaveToastError(isError)
    setSaveToastOpen(true)
  }

  async function handleVideoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('video/'))
    if (!files.length) return

    const remainingSlots = Math.max(0, MAX_BATCH_UPLOAD - uploadQueue.length)
    const selectedFiles = files.slice(0, remainingSlots)

    if (files.length > remainingSlots) {
      openToast(`한 번에 최대 ${MAX_BATCH_UPLOAD}개까지만 추가할 수 있습니다.`, true)
    }

    setSaving(true)
    try {
      const prepared = await Promise.all(
        selectedFiles.map(async (file) => {
          if (file.size > MAX_VIDEO_SIZE) {
            throw new Error(`${file.name}: 최대 50MB까지만 업로드할 수 있습니다.`)
          }
          return prepareVideo(file)
        })
      )

      setUploadQueue((prev) => [...prev, ...prepared].slice(0, MAX_BATCH_UPLOAD))
      setShowUploadModal(true)
    } catch (error) {
      console.error(error)
      openToast(error instanceof Error ? error.message : '영상 준비 중 오류가 발생했습니다.', true)
    } finally {
      setSaving(false)
      event.target.value = ''
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return

    const created = await createVideoBoardCategory({
      name: newCategoryName.trim(),
      slug: slugify(newCategoryName),
      color: newCategoryColor,
    })

    if (created) {
      setCategories((prev) => [...prev, created])
      setNewCategoryName('')
      setNewCategoryColor('#E2E8F0')
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim() || !canUseGroups) return

    const created = await createVideoBoardGroup({
      category_id: selectedCategoryId,
      name: newGroupName.trim(),
      slug: slugify(`${selectedCategoryId}-${newGroupName}`),
      color: newGroupColor,
    })

    if (created) {
      setGroups((prev) => [...prev, created])
      setNewGroupName('')
      setNewGroupColor('#E2E8F0')
      setShowGroupModal(false)
    }
  }

  async function saveSingleCandidate(candidate: UploadCandidate) {
    const extension = candidate.file.name.includes('.') ? candidate.file.name.split('.').pop() || 'mp4' : 'mp4'
    const baseName = slugify(candidate.title || candidate.file.name.replace(/\.[^.]+$/, '')) || 'video'
    const shareId = createShareId()
    const videoPath = `${user?.id}/${Date.now()}-${baseName}.${extension}`
    const posterPath = `${user?.id}/posters/${Date.now()}-${baseName}.jpg`

    const [videoUrl, posterUrl] = await Promise.all([
      uploadVideoBoardFile(videoPath, candidate.file),
      uploadVideoBoardFile(posterPath, await createPosterFile(candidate.posterDataUrl, `${baseName}.jpg`)),
    ])

    if (!videoUrl) {
      throw new Error(`${candidate.file.name}: 영상 업로드 URL 생성에 실패했습니다.`)
    }

    await createVideoBoardItem({
      title: candidate.title.trim() || DEFAULT_VIDEO_TITLE,
      video_url: videoUrl,
      video_path: videoPath,
      poster_url: posterUrl,
      poster_path: posterUrl ? posterPath : null,
      category_id: null,
      group_id: null,
      ai_category: null,
      summary: null,
      timeline_notes: null,
      script_notes: null,
      duration: candidate.metadata.duration,
      width: candidate.metadata.width,
      height: candidate.metadata.height,
      file_size: candidate.metadata.sizeBytes,
      mime_type: candidate.metadata.mimeType,
      share_id: shareId,
      is_public: true,
      created_by: user?.id || null,
    })
  }

  async function handleSaveVideos() {
    if (!user || uploadQueue.length === 0) return

    setShowUploadModal(false)
    setSaving(true)
    openToast(`영상 ${uploadQueue.length}개 저장 중...`, false)

    let successCount = 0
    let failedMessage = ''

    for (const candidate of uploadQueue) {
      setUploadQueue((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, status: 'uploading', error: '' } : item)))

      try {
        await saveSingleCandidate(candidate)
        successCount += 1
        if (candidate.previewUrl) URL.revokeObjectURL(candidate.previewUrl)
        setUploadQueue((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, status: 'success' } : item)))
      } catch (error) {
        const message = error instanceof Error ? error.message : `${candidate.file.name}: 저장에 실패했습니다.`
        failedMessage = message
        setUploadQueue((prev) => prev.map((item) => (item.id === candidate.id ? { ...item, status: 'error', error: message } : item)))
      }
    }

    await loadData()
    setSaving(false)

    if (failedMessage) {
      openToast(failedMessage, true)
    } else {
      openToast(`${successCount}개 영상 저장 완료`, false)
    }

    if (successCount === uploadQueue.length) {
      setUploadQueue([])
    } else {
      setShowUploadModal(true)
    }
  }

  function removeCandidate(candidateId: string) {
    setUploadQueue((prev) => {
      const target = prev.find((item) => item.id === candidateId)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((item) => item.id !== candidateId)
    })
  }

  function closeUploadModal() {
    uploadQueue.forEach((candidate) => {
      if (candidate.previewUrl) URL.revokeObjectURL(candidate.previewUrl)
    })
    setUploadQueue([])
    setShowUploadModal(false)
  }

  function openEditModal(item: VideoBoardItem) {
    setEditTarget(item)
    setEditTitle(item.title)
    setEditNotes(item.summary || '')
    setEditCategoryId(item.category_id || '')
    setEditGroupId(item.group_id || '')
  }

  async function handleSaveEdit() {
    if (!editTarget) return

    const updated = await updateVideoBoardItem(editTarget.id, {
      title: editTitle.trim() || DEFAULT_VIDEO_TITLE,
      summary: editNotes.trim() || null,
      category_id: editCategoryId || null,
      group_id: editCategoryId ? editGroupId || null : null,
    })

    if (updated) {
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setEditTarget(null)
      await loadData()
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkMoveCategory(categoryId: string) {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await updateVideoBoardItem(id, { category_id: categoryId || null, group_id: null })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    await loadData()
  }

  async function handleBulkMoveGroup(groupId: string) {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await updateVideoBoardItem(id, { group_id: groupId || null })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    await loadData()
  }

  async function handleDeleteSelected() {
    const targetItems = items.filter((item) => selectedIds.has(item.id))
    const success = await deleteVideoBoardItems(targetItems)
    if (success) {
      setDeleteConfirmOpen(false)
      setSelectedIds(new Set())
      setSelectionMode(false)
      await loadData()
    }
  }

  async function handleCopyShareUrl(item: VideoBoardItem) {
    const url = `${window.location.origin}/video-board/share/${item.share_id}`
    await navigator.clipboard.writeText(url)
    setCopiedShareId(item.id)
    window.setTimeout(() => setCopiedShareId(null), 1500)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {saveToastOpen ? (
        <div className="fixed right-6 top-6 z-[70] w-[340px] rounded-2xl border bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-full p-1 ${saveToastError ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{saveToastError ? '저장 오류' : saving ? '저장 진행 중' : '저장 완료'}</div>
              <div className="mt-1 text-sm text-slate-600">{saveToastMessage}</div>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setSaveToastOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setShowCategoryModal(true)}>
            <FolderTree className="mr-2 h-4 w-4" />
            카테고리 보기
          </Button>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-sm">
            현재 카테고리: {filterCategories.find((item) => item.id === selectedCategoryId)?.name || '전체'}
          </Badge>
          {canUseGroups ? (
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
              현재 그룹: {filterGroups.find((item) => item.id === selectedGroupId)?.name || '전체'}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <>
              <Button variant="outline" onClick={() => setSelectionMode((prev) => !prev)}>
                {selectionMode ? '선택 종료' : '선택 모드'}
              </Button>
              {canUseGroups ? (
                <Button variant="outline" onClick={() => setShowGroupModal(true)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  그룹 추가
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  setShowUploadModal(true)
                  window.setTimeout(() => fileInputRef.current?.click(), 0)
                }}
                disabled={saving}
              >
                <Plus className="mr-2 h-4 w-4" />
                영상 추가
              </Button>
              <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleVideoSelect} />
            </>
          ) : null}
        </div>
      </div>

      {canUseGroups ? (
        <div className="rounded-3xl border bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <FolderTree className="h-4 w-4 text-primary" />
            세부 그룹
          </div>
          <div className="flex flex-wrap gap-2">
            {filterGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => {
                  setSelectedGroupId(group.id)
                  setCurrentPage(1)
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  selectedGroupId === group.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {group.name}
                <span className="ml-2 text-xs opacity-80">{groupCounts[group.id] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectionMode && isAdmin ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-sm text-slate-600">선택된 영상 {selectedIds.size}개</div>
            <div className="flex flex-wrap gap-2">
              <Select
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return
                  handleBulkMoveCategory(event.target.value === 'uncategorized' ? '' : event.target.value)
                  event.target.value = ''
                }}
                className="w-[220px]"
              >
                <option value="">카테고리로 이동</option>
                <option value="uncategorized">미분류로 이동</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
              {canUseGroups ? (
                <Select
                  defaultValue=""
                  onChange={(event) => {
                    if (!event.target.value) return
                    handleBulkMoveGroup(event.target.value === 'ungrouped' ? '' : event.target.value)
                    event.target.value = ''
                  }}
                  className="w-[220px]"
                >
                  <option value="">그룹으로 이동</option>
                  <option value="ungrouped">그룹 없음으로 이동</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={selectedIds.size === 0}>
                <Trash2 className="mr-2 h-4 w-4" />
                삭제
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex h-72 flex-col items-center justify-center gap-3 text-center">
            <Video className="h-10 w-10 text-slate-300" />
            <div className="text-lg font-semibold text-slate-700">아직 저장된 영상이 없습니다.</div>
            {isAdmin ? <Button onClick={() => setShowUploadModal(true)}>영상 추가</Button> : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((item) => (
            <Card
              key={item.id}
              className={`overflow-hidden transition hover:shadow-md ${selectionMode && isAdmin ? 'cursor-pointer' : ''} ${
                selectedIds.has(item.id) ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => {
                if (selectionMode && isAdmin) toggleSelected(item.id)
              }}
            >
              <CardContent className="space-y-4 p-4">
                <div className="overflow-hidden rounded-2xl border bg-slate-950">
                  <video
                    src={item.video_url}
                    poster={item.poster_url || undefined}
                    controls={!selectionMode}
                    className="aspect-[9/16] w-full object-cover"
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{item.title !== DEFAULT_VIDEO_TITLE ? item.title : '제목 없음'}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDuration(item.duration)} / {formatFileSize(item.file_size)} / {item.width || '-'}x{item.height || '-'}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant="outline">{item.category?.name || item.ai_category || '미분류'}</Badge>
                    {item.group?.name ? <Badge variant="secondary">{item.group.name}</Badge> : null}
                  </div>
                </div>

                {item.summary ? <p className="line-clamp-3 text-sm text-slate-700">{item.summary}</p> : null}

                <details className="rounded-2xl border bg-slate-50 p-3 text-sm text-slate-700">
                  <summary className="cursor-pointer font-medium">분석 메모 보기</summary>
                  <div className="mt-3 space-y-3 whitespace-pre-wrap">
                    {item.timeline_notes ? <div><div className="font-medium text-slate-900">타임코드</div><div>{item.timeline_notes}</div></div> : null}
                    {item.script_notes ? <div><div className="font-medium text-slate-900">대본 / 화면 구성</div><div>{item.script_notes}</div></div> : null}
                  </div>
                </details>

                <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => setPreviewItem(item)}>
                    크게 보기
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleCopyShareUrl(item)}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copiedShareId === item.id ? 'URL 복사됨' : '공유 URL 복사'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.open(`/video-board/share/${item.share_id}`, '_blank')}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    공유 페이지
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => triggerDownload(item.video_url, `${slugify(item.title) || 'video'}.${item.mime_type?.includes('quicktime') ? 'mov' : 'mp4'}`)}>
                    <Download className="mr-2 h-4 w-4" />
                    다운로드
                  </Button>
                  {isAdmin ? (
                    <Button variant="outline" size="sm" onClick={() => openEditModal(item)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      편집
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-sm text-slate-500">총 {totalCount}개 / 현재 카테고리: {filterCategories.find((item) => item.id === selectedCategoryId)?.name || '전체'}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">페이지당</span>
            <Select
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setCurrentPage(1)
              }}
              className="w-[150px]"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}개 보기
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((prev) => prev - 1)}>
              이전
            </Button>
            {Array.from({ length: totalPages }, (_, index) => index + 1)
              .filter((page) => Math.abs(page - currentPage) <= 2)
              .map((page) => (
                <Button key={page} variant={page === currentPage ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(page)}>
                  {page}
                </Button>
              ))}
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((prev) => prev + 1)}>
              다음
            </Button>
          </div>
        </div>
      ) : null}

      {showCategoryModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>카테고리 보기</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowCategoryModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 space-y-6 overflow-y-auto">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filterCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`rounded-3xl border p-4 text-left transition ${selectedCategoryId === category.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-slate-300'}`}
                    onClick={() => {
                      setSelectedCategoryId(category.id)
                      setSelectedGroupId('all')
                      setCurrentPage(1)
                      setShowCategoryModal(false)
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900">{category.name}</div>
                      <Badge variant="outline">{categoryCounts[category.id] || 0}</Badge>
                    </div>
                  </button>
                ))}
              </div>

              {isAdmin ? (
                <div className="rounded-3xl border bg-slate-50 p-4">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <FolderPlus className="h-4 w-4 text-primary" />
                    새 카테고리 추가
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1fr,160px,120px]">
                    <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="예: 반려동물" />
                    <Input type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} />
                    <Button onClick={handleCreateCategory}>추가</Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {showGroupModal && canUseGroups ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>그룹 추가</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowGroupModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>그룹명</Label>
                <Input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="예: 숏폼 후기, 제품 데모" />
              </div>
              <div className="space-y-2">
                <Label>색상</Label>
                <Input type="color" value={newGroupColor} onChange={(event) => setNewGroupColor(event.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowGroupModal(false)}>
                  취소
                </Button>
                <Button onClick={handleCreateGroup}>추가</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {showUploadModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Upload className="h-5 w-5 text-primary" />
                영상 추가
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                  <Plus className="mr-2 h-4 w-4" />
                  파일 선택
                </Button>
                <Button variant="ghost" size="icon" onClick={closeUploadModal} disabled={saving}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6">
              {uploadQueue.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {uploadQueue.map((candidate) => (
                    <div key={candidate.id} className="overflow-hidden rounded-2xl border bg-white">
                      <video src={candidate.previewUrl} poster={candidate.posterDataUrl} controls className="aspect-[9/16] w-full object-cover" />
                      <div className="space-y-3 p-4">
                        <Input
                          value={candidate.title}
                          onChange={(event) =>
                            setUploadQueue((prev) =>
                              prev.map((item) => (item.id === candidate.id ? { ...item, title: event.target.value } : item))
                            )
                          }
                          placeholder="제목 없이 저장해도 됩니다"
                        />
                        <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                          <div>{formatDuration(candidate.metadata.duration)}</div>
                          <div>{formatFileSize(candidate.metadata.sizeBytes)}</div>
                          <div>{candidate.metadata.width}x{candidate.metadata.height}</div>
                          <div>프레임 {candidate.frames.length}장</div>
                        </div>
                        <div className="grid gap-2 grid-cols-2">
                          {candidate.frames.slice(0, 4).map((frame) => (
                            <div key={frame.timestampLabel} className="overflow-hidden rounded-xl border">
                              <img src={frame.dataUrl} alt={frame.timestampLabel} className="aspect-video w-full object-cover" />
                              <div className="px-2 py-1 text-[11px] text-slate-500">{frame.timestampLabel}</div>
                            </div>
                          ))}
                        </div>
                        {candidate.error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{candidate.error}</div> : null}
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium text-slate-500">
                            {candidate.status === 'uploading' ? '저장 중...' : candidate.status === 'success' ? '저장 완료' : candidate.status === 'error' ? '오류' : '대기 중'}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removeCandidate(candidate.id)} disabled={saving}>
                            <X className="mr-1 h-4 w-4" />
                            제외
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-slate-50 text-center">
                  <PlaySquare className="h-10 w-10 text-slate-400" />
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-slate-900">업로드할 영상을 선택해 주세요</p>
                    <p className="text-sm text-slate-500">최대 50MB, 한 번에 최대 10개까지 저장할 수 있습니다.</p>
                  </div>
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <Plus className="mr-2 h-4 w-4" />
                    영상 선택
                  </Button>
                </div>
              )}
            </CardContent>
            <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={closeUploadModal} disabled={saving}>
                닫기
              </Button>
              <Button onClick={handleSaveVideos} disabled={uploadQueue.length === 0 || saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {saving ? '저장 중...' : `${uploadQueue.length}개 저장`}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>영상 편집</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setEditTarget(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>제목</Label>
                <Input value={editTitle === DEFAULT_VIDEO_TITLE ? '' : editTitle} onChange={(event) => setEditTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>카테고리</Label>
                <Select value={editCategoryId} onChange={(event) => setEditCategoryId(event.target.value)}>
                  <option value="">미분류</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>
              {editCategoryId ? (
                <div className="space-y-2">
                  <Label>그룹</Label>
                  <Select value={editGroupId} onChange={(event) => setEditGroupId(event.target.value)}>
                    <option value="">그룹 없음</option>
                    {groups.filter((group) => group.category_id === editCategoryId).map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>요약 메모</Label>
                <Textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="min-h-32" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditTarget(null)}>
                  취소
                </Button>
                <Button onClick={handleSaveEdit}>저장</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {previewItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewItem(null)}>
          <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
            <Card className="overflow-hidden">
              <CardContent className="space-y-4 p-4">
                <div className="overflow-hidden rounded-2xl border bg-slate-950">
                  <video src={previewItem.video_url} poster={previewItem.poster_url || undefined} controls className="aspect-[9/16] w-full object-cover" />
                </div>
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900">{previewItem.title !== DEFAULT_VIDEO_TITLE ? previewItem.title : '제목 없음'}</div>
                  {previewItem.summary ? <p className="text-sm text-slate-600">{previewItem.summary}</p> : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreviewItem(null)}>
                    닫기
                  </Button>
                  <Button variant="outline" onClick={() => handleCopyShareUrl(previewItem)}>
                    공유 URL 복사
                  </Button>
                  <Button onClick={() => triggerDownload(previewItem.video_url, `${slugify(previewItem.title) || 'video'}.${previewItem.mime_type?.includes('quicktime') ? 'mov' : 'mp4'}`)}>
                    다운로드
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>선택한 영상을 삭제할까요?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">선택된 영상 {selectedIds.size}개가 저장소와 목록에서 함께 삭제됩니다.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                  취소
                </Button>
                <Button variant="destructive" onClick={handleDeleteSelected}>
                  확인 삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
