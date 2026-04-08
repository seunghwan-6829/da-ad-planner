'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  FolderPlus,
  Images,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-context'
import {
  createImageBoardCategory,
  createImageBoardItem,
  deleteImageBoardItems,
  getImageBoardCategories,
  getImageBoardItemsPaginated,
  updateImageBoardItem,
  uploadImageBoardFile,
} from '@/lib/api/image-board'
import { ImageBoardCategory, ImageBoardItem } from '@/lib/supabase'

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100]

interface VideoLikeImageMeta {
  width: number
  height: number
}

interface UploadCandidate {
  id: string
  previewUrl: string
  file: File
  title: string
  meta: VideoLikeImageMeta
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-_]/g, '')
}

async function compressImage(file: File): Promise<UploadCandidate> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const image = new window.Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        const maxDimension = 1800
        let width = image.width
        let height = image.height

        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        canvas.width = width
        canvas.height = height

        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('이미지 압축에 실패했습니다.'))
          return
        }

        context.drawImage(image, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('이미지 최적화에 실패했습니다.'))
              return
            }

            const optimizedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
              type: 'image/jpeg',
            })

            const previewReader = new FileReader()
            previewReader.onload = () => {
              resolve({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                previewUrl: previewReader.result as string,
                file: optimizedFile,
                title: file.name.replace(/\.[^.]+$/, ''),
                meta: { width, height },
              })
            }
            previewReader.readAsDataURL(optimizedFile)
          },
          'image/jpeg',
          0.78
        )
      }
      image.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
      image.src = event.target?.result as string
    }
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function getCategoryLabel(categoryId: string, categories: ImageBoardCategory[]) {
  if (categoryId === 'all') return '전체'
  if (categoryId === 'uncategorized') return '미분류'
  return categories.find((category) => category.id === categoryId)?.name || '기타'
}

export default function ImageBoardPage() {
  const { user, isAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<ImageBoardItem[]>([])
  const [categories, setCategories] = useState<ImageBoardCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState('all')
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [uploadQueue, setUploadQueue] = useState<UploadCandidate[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [showCategoryPanel, setShowCategoryPanel] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#E2E8F0')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ImageBoardItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const filterCategories = useMemo(
    () => [
      { id: 'all', name: '전체' },
      { id: 'uncategorized', name: '미분류' },
      ...categories.map((category) => ({ id: category.id, name: category.name })),
    ],
    [categories]
  )

  useEffect(() => {
    const savedPageSize = window.localStorage.getItem('image-board-page-size')
    const savedCategoryId = window.localStorage.getItem('image-board-category')

    if (savedPageSize && PAGE_SIZE_OPTIONS.includes(Number(savedPageSize))) {
      setPageSize(Number(savedPageSize))
    }
    if (savedCategoryId) {
      setSelectedCategoryId(savedCategoryId)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('image-board-page-size', String(pageSize))
  }, [pageSize])

  useEffect(() => {
    window.localStorage.setItem('image-board-category', selectedCategoryId)
  }, [selectedCategoryId])

  useEffect(() => {
    loadData()
  }, [currentPage, pageSize, selectedCategoryId])

  async function loadData() {
    setLoading(true)
    const [categoryData, listResult] = await Promise.all([
      getImageBoardCategories(),
      getImageBoardItemsPaginated({
        page: currentPage,
        pageSize,
        categoryId: selectedCategoryId,
      }),
    ])

    setCategories(categoryData)
    setItems(listResult.data)
    setTotalCount(listResult.totalCount)
    setCategoryCounts(listResult.categoryCounts)
    setLoading(false)
  }

  function resetEditModal() {
    setEditTarget(null)
    setEditTitle('')
    setEditNotes('')
    setEditCategoryId('')
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return

    const remainingSlots = Math.max(0, 30 - uploadQueue.length)
    const selectedFiles = files.slice(0, remainingSlots)
    const compressed = await Promise.all(selectedFiles.map((file) => compressImage(file)))

    setUploadQueue((prev) => [...prev, ...compressed].slice(0, 30))
    setShowUploadPanel(true)
    event.target.value = ''
  }

  async function classifyImage(previewUrl: string) {
    try {
      const response = await fetch('/api/ai/image-board-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: previewUrl }),
      })

      if (!response.ok) return '기타'
      const data = await response.json()
      return data.category || '기타'
    } catch {
      return '기타'
    }
  }

  async function handleUploadImages() {
    if (!user || uploadQueue.length === 0) return

    setUploading(true)
    try {
      const latestCategories = await getImageBoardCategories()
      setCategories(latestCategories)

      for (const candidate of uploadQueue) {
        const categoryName = await classifyImage(candidate.previewUrl)
        const matchedCategory =
          latestCategories.find((category) => category.name === categoryName) ||
          latestCategories.find((category) => category.name === '기타') ||
          null

        const filePath = `${user.id}/${Date.now()}-${slugify(candidate.title)}-${Math.random().toString(36).slice(2, 8)}.jpg`
        const imageUrl = await uploadImageBoardFile(filePath, candidate.file)
        if (!imageUrl) continue

        await createImageBoardItem({
          title: candidate.title,
          image_url: imageUrl,
          image_path: filePath,
          category_id: matchedCategory?.id || null,
          ai_category: categoryName,
          notes: null,
          width: candidate.meta.width,
          height: candidate.meta.height,
          file_size: candidate.file.size,
          created_by: user.id,
        })
      }

      setUploadQueue([])
      setShowUploadPanel(false)
      setCurrentPage(1)
      setSelectedCategoryId('all')
      await loadData()
    } finally {
      setUploading(false)
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return

    const created = await createImageBoardCategory({
      name: newCategoryName.trim(),
      slug: slugify(newCategoryName),
      color: newCategoryColor,
    })

    if (created) {
      setCategories((prev) => [...prev, created])
      setNewCategoryName('')
      setShowCategoryPanel(false)
    }
  }

  function openEditModal(item: ImageBoardItem) {
    setEditTarget(item)
    setEditTitle(item.title)
    setEditNotes(item.notes || '')
    setEditCategoryId(item.category_id || '')
  }

  async function handleSaveEdit() {
    if (!editTarget) return

    const updated = await updateImageBoardItem(editTarget.id, {
      title: editTitle.trim() || editTarget.title,
      notes: editNotes.trim() || null,
      category_id: editCategoryId || null,
    })

    if (updated) {
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      resetEditModal()
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

  async function handleBulkMove(categoryId: string) {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await updateImageBoardItem(id, { category_id: categoryId || null })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    await loadData()
  }

  async function handleDeleteSelected() {
    const targetItems = items.filter((item) => selectedIds.has(item.id))
    const success = await deleteImageBoardItems(targetItems)
    if (success) {
      setDeleteConfirmOpen(false)
      setSelectedIds(new Set())
      setSelectionMode(false)
      await loadData()
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">이미지 보드</h1>
          <p className="mt-1 text-muted-foreground">
            Pinterest 스타일로 이미지를 저장하고 분류하는 보드입니다. 데이터는 Supabase에 저장되어 다른 PC에서도 동일하게 보입니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => setShowCategoryPanel((prev) => !prev)}>
                <FolderPlus className="mr-2 h-4 w-4" />
                카테고리 추가
              </Button>
              <Button variant="outline" onClick={() => setSelectionMode((prev) => !prev)}>
                {selectionMode ? '선택 종료' : '선택 모드'}
              </Button>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Plus className="mr-2 h-4 w-4" />
                이미지 추가
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            </>
          )}
        </div>
      </div>

      {showCategoryPanel && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>새 카테고리 만들기</CardTitle>
            <CardDescription>기본 대분류 외에 원하는 카테고리를 직접 추가할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr,160px,120px]">
            <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="예: 해외 무드보드" />
            <Input type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} />
            <Button onClick={handleCreateCategory}>추가</Button>
          </CardContent>
        </Card>
      )}

      {showUploadPanel && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              다중 업로드
            </CardTitle>
            <CardDescription>최대 30장까지 업로드됩니다. 저장 전 자동 최적화하고 AI가 1차 대분류를 지정합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {uploadQueue.map((file, index) => (
                <div key={file.id} className="overflow-hidden rounded-2xl border bg-white">
                  <img src={file.previewUrl} alt={file.title} className="aspect-[4/5] w-full object-cover" />
                  <div className="space-y-2 p-3">
                    <Input
                      value={file.title}
                      onChange={(event) =>
                        setUploadQueue((prev) =>
                          prev.map((item) => (item.id === file.id ? { ...item, title: event.target.value } : item))
                        )
                      }
                    />
                    <div className="text-xs text-slate-500">
                      {(file.file.size / 1024 / 1024).toFixed(2)}MB / {file.meta.width}x{file.meta.height}
                    </div>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setUploadQueue((prev) => prev.filter((_, i) => i !== index))}>
                      <X className="mr-2 h-4 w-4" />
                      제외
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUploadQueue([])} disabled={uploading}>
                초기화
              </Button>
              <Button onClick={handleUploadImages} disabled={uploading || uploadQueue.length === 0}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploading ? '업로드 중...' : `${uploadQueue.length}장 업로드`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {filterCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => {
                setSelectedCategoryId(category.id)
                setCurrentPage(1)
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                selectedCategoryId === category.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {category.name}
              <span className="ml-2 text-xs opacity-80">{categoryCounts[category.id] || 0}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">페이지당 보기</span>
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
                {option}개씩 보기
              </option>
            ))}
          </Select>
        </div>
      </div>

      {selectionMode && isAdmin && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-slate-600">선택된 이미지 {selectedIds.size}장</div>
            <div className="flex flex-wrap gap-2">
              <Select
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) {
                    handleBulkMove(event.target.value === 'uncategorized' ? '' : event.target.value)
                    event.target.value = ''
                  }
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
              <Button variant="destructive" disabled={selectedIds.size === 0} onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                삭제
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex h-60 flex-col items-center justify-center gap-3 text-center">
            <Images className="h-10 w-10 text-slate-300" />
            <div className="text-lg font-semibold text-slate-700">아직 저장된 이미지가 없습니다.</div>
            <p className="text-sm text-slate-500">업로드하면 Supabase에 저장되어 다른 PC에서도 그대로 보입니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-5">
          {items.map((item) => (
            <div key={item.id} className="mb-4 break-inside-avoid overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="relative">
                <img src={item.image_url} alt={item.title} className="w-full object-cover" />
                {selectionMode && isAdmin && (
                  <label className="absolute left-3 top-3 rounded-full bg-white/90 p-2 shadow">
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} />
                  </label>
                )}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.width || '-'}x{item.height || '-'} / {item.file_size ? `${(item.file_size / 1024 / 1024).toFixed(2)}MB` : '-'}
                    </p>
                  </div>
                  <Badge variant="outline">{item.category?.name || item.ai_category || '미분류'}</Badge>
                </div>

                {item.notes ? <p className="text-sm text-slate-600">{item.notes}</p> : null}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => triggerDownload(item.image_url, `${slugify(item.title) || 'image'}.jpg`)}>
                    <Download className="mr-2 h-4 w-4" />
                    다운로드
                  </Button>
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={() => openEditModal(item)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      편집
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-slate-500">
            총 {totalCount}장 / 현재 카테고리: {getCategoryLabel(selectedCategoryId, categories)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
      )}

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>정말 삭제하시겠습니까?</CardTitle>
              <CardDescription>선택한 이미지 {selectedIds.size}장은 Supabase 저장소와 보드 목록에서 함께 삭제됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                취소
              </Button>
              <Button variant="destructive" onClick={handleDeleteSelected}>
                확인 삭제
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>이미지 편집</CardTitle>
              <CardDescription>제목, 메모, 카테고리를 수정할 수 있습니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>제목</Label>
                <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
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
              <div className="space-y-2">
                <Label>메모</Label>
                <Textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="min-h-32" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetEditModal}>
                  취소
                </Button>
                <Button onClick={handleSaveEdit}>저장</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
