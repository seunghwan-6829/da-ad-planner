'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  FolderPlus,
  FolderTree,
  Images,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-context'
import {
  createImageBoardCategory,
  createImageBoardGroup,
  createImageBoardItem,
  deleteImageBoardItems,
  getImageBoardCategories,
  getImageBoardGroups,
  getImageBoardItemsPaginated,
  updateImageBoardItem,
  uploadImageBoardFile,
} from '@/lib/api/image-board'
import { ImageBoardCategory, ImageBoardGroup, ImageBoardItem } from '@/lib/supabase'

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100]
const DEFAULT_IMAGE_BOARD_TITLE = '이미지 보드 항목'

interface UploadCandidate {
  id: string
  previewUrl: string
  file: File
  title: string
  width: number
  height: number
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣_]/g, '')
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

async function copyImageToClipboard(url: string) {
  const response = await fetch(url)
  const blob = await response.blob()
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob,
    }),
  ])
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
          reject(new Error('이미지를 처리하지 못했습니다.'))
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
                title: '',
                width,
                height,
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

function getCategoryLabel(categoryId: string, categories: ImageBoardCategory[]) {
  if (categoryId === 'all') return '전체'
  if (categoryId === 'uncategorized') return '미분류'
  return categories.find((category) => category.id === categoryId)?.name || '기타'
}

function getGroupLabel(groupId: string, groups: ImageBoardGroup[]) {
  if (groupId === 'all') return '전체'
  if (groupId === 'ungrouped') return '그룹 없음'
  return groups.find((group) => group.id === groupId)?.name || '그룹 없음'
}

export default function ImageBoardPage() {
  const { user, isAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<ImageBoardItem[]>([])
  const [categories, setCategories] = useState<ImageBoardCategory[]>([])
  const [groups, setGroups] = useState<ImageBoardGroup[]>([])
  const [editGroups, setEditGroups] = useState<ImageBoardGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(30)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState('all')
  const [selectedGroupId, setSelectedGroupId] = useState('all')
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [uploadQueue, setUploadQueue] = useState<UploadCandidate[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#E2E8F0')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#E2E8F0')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ImageBoardItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editGroupId, setEditGroupId] = useState('')
  const [previewItem, setPreviewItem] = useState<ImageBoardItem | null>(null)
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const canUseGroups = selectedCategoryId !== 'all' && selectedCategoryId !== 'uncategorized'
  const canCreateGroup = isAdmin && canUseGroups

  const filterCategories = useMemo(
    () => [
      { id: 'all', name: '전체' },
      { id: 'uncategorized', name: '미분류' },
      ...categories.map((category) => ({ id: category.id, name: category.name })),
    ],
    [categories]
  )

  const filterGroups = useMemo(
    () => [
      { id: 'all', name: '전체' },
      { id: 'ungrouped', name: '그룹 없음' },
      ...groups.map((group) => ({ id: group.id, name: group.name })),
    ],
    [groups]
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
    if (!canUseGroups) {
      setSelectedGroupId('all')
      setGroups([])
      return
    }

    getImageBoardGroups(selectedCategoryId).then(setGroups)
  }, [canUseGroups, selectedCategoryId])

  useEffect(() => {
    if (!editTarget) {
      setEditGroups([])
      return
    }

    if (!editCategoryId) {
      setEditGroupId('')
      setEditGroups([])
      return
    }

    getImageBoardGroups(editCategoryId).then((data) => {
      setEditGroups(data)
      if (!data.some((group) => group.id === editGroupId)) {
        setEditGroupId('')
      }
    })
  }, [editTarget, editCategoryId])

  useEffect(() => {
    loadData()
  }, [currentPage, pageSize, selectedCategoryId, selectedGroupId])

  async function loadData() {
    setLoading(true)

    const [categoryData, listResult] = await Promise.all([
      getImageBoardCategories(),
      getImageBoardItemsPaginated({
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

  function resetEditModal() {
    setEditTarget(null)
    setEditTitle('')
    setEditNotes('')
    setEditCategoryId('')
    setEditGroupId('')
    setEditGroups([])
  }

  function closeUploadModal() {
    setShowUploadModal(false)
    setUploadQueue([])
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return

    const remainingSlots = Math.max(0, 30 - uploadQueue.length)
    const selectedFiles = files.slice(0, remainingSlots)

    if (files.length > remainingSlots) {
      alert('한 번에 최대 30장까지 업로드할 수 있습니다.')
    }

    const compressed = await Promise.all(selectedFiles.map((file) => compressImage(file)))
    setUploadQueue((prev) => [...prev, ...compressed].slice(0, 30))
    setShowUploadModal(true)
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

        const filePath = `${user.id}/${Date.now()}-${slugify(candidate.title || 'image')}-${Math.random().toString(36).slice(2, 8)}.jpg`
        const imageUrl = await uploadImageBoardFile(filePath, candidate.file)
        if (!imageUrl) continue

        await createImageBoardItem({
          title: candidate.title.trim() || DEFAULT_IMAGE_BOARD_TITLE,
          image_url: imageUrl,
          image_path: filePath,
          category_id: matchedCategory?.id || null,
          group_id: null,
          ai_category: categoryName,
          notes: null,
          width: candidate.width,
          height: candidate.height,
          file_size: candidate.file.size,
          created_by: user.id,
        })
      }

      closeUploadModal()
      setCurrentPage(1)
      setSelectedCategoryId('all')
      setSelectedGroupId('all')
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
      setNewCategoryColor('#E2E8F0')
      setShowCategoryModal(false)
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim() || !canUseGroups) return

    const created = await createImageBoardGroup({
      category_id: selectedCategoryId,
      name: newGroupName.trim(),
      slug: slugify(`${selectedCategoryId}-${newGroupName}`),
      color: newGroupColor,
    })

    if (created) {
      setGroups((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewGroupName('')
      setNewGroupColor('#E2E8F0')
      setShowGroupModal(false)
      setSelectedGroupId(created.id)
      setCurrentPage(1)
    }
  }

  function openEditModal(item: ImageBoardItem) {
    setEditTarget(item)
    setEditTitle(item.title)
    setEditNotes(item.notes || '')
    setEditCategoryId(item.category_id || '')
    setEditGroupId(item.group_id || '')
  }

  async function handleSaveEdit() {
    if (!editTarget) return

    const updated = await updateImageBoardItem(editTarget.id, {
      title: editTitle.trim() || DEFAULT_IMAGE_BOARD_TITLE,
      notes: editNotes.trim() || null,
      category_id: editCategoryId || null,
      group_id: editCategoryId ? editGroupId || null : null,
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
      await updateImageBoardItem(id, {
        category_id: categoryId || null,
        group_id: null,
      })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    await loadData()
  }

  async function handleBulkMoveGroup(groupId: string) {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await updateImageBoardItem(id, {
        group_id: groupId || null,
      })
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

  async function handleCopyImage(item: ImageBoardItem) {
    try {
      await copyImageToClipboard(item.image_url)
      setCopiedItemId(item.id)
      window.setTimeout(() => setCopiedItemId(null), 1600)
    } catch (error) {
      console.error(error)
      alert('이미지 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.')
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {filterCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => {
                setSelectedCategoryId(category.id)
                setSelectedGroupId('all')
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
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => setSelectionMode((prev) => !prev)}>
                {selectionMode ? '선택 종료' : '선택 모드'}
              </Button>
              <Button variant="outline" onClick={() => setShowCategoryModal(true)}>
                <FolderPlus className="mr-2 h-4 w-4" />
                카테고리 추가
              </Button>
              {canCreateGroup && (
                <Button variant="outline" onClick={() => setShowGroupModal(true)}>
                  <FolderTree className="mr-2 h-4 w-4" />
                  그룹 추가
                </Button>
              )}
              <Button
                onClick={() => {
                  setShowUploadModal(true)
                  window.setTimeout(() => fileInputRef.current?.click(), 0)
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                이미지 추가
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
            </>
          )}
        </div>
      </div>

      {canUseGroups && (
        <div className="rounded-3xl border bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <FolderTree className="h-4 w-4 text-primary" />
            {getCategoryLabel(selectedCategoryId, categories)} 그룹
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
      )}

      {selectionMode && isAdmin && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-sm text-slate-600">선택된 이미지 {selectedIds.size}개</div>
            <div className="flex flex-wrap gap-2">
              <Select
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return
                  handleBulkMove(event.target.value === 'uncategorized' ? '' : event.target.value)
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
              {canUseGroups && (
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
              )}
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
            {isAdmin ? <Button onClick={() => setShowUploadModal(true)}>이미지 추가</Button> : null}
          </CardContent>
        </Card>
      ) : (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4 2xl:columns-5">
          {items.map((item) => {
            const isSelected = selectedIds.has(item.id)

            return (
              <div
                key={item.id}
                className={`mb-4 break-inside-avoid overflow-hidden rounded-3xl border bg-white shadow-sm transition hover:shadow-md ${
                  isSelected ? 'ring-2 ring-primary' : ''
                } ${selectionMode && isAdmin ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (selectionMode && isAdmin) {
                    toggleSelected(item.id)
                    return
                  }

                  setPreviewItem(item)
                }}
              >
                <div className="relative">
                  <img src={item.image_url} alt={item.title} className="w-full object-cover" />
                  {selectionMode && isAdmin ? <div className="absolute inset-0 bg-primary/5" /> : null}
                  {selectionMode && isAdmin && (
                    <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold shadow">
                      {isSelected ? '선택됨' : '클릭해서 선택'}
                    </div>
                  )}
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {item.title !== DEFAULT_IMAGE_BOARD_TITLE ? <h3 className="font-semibold text-slate-900">{item.title}</h3> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {item.width || '-'}x{item.height || '-'} / {formatFileSize(item.file_size)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Badge variant="outline">{item.category?.name || item.ai_category || '미분류'}</Badge>
                      {item.group?.name ? <Badge variant="secondary">{item.group.name}</Badge> : null}
                    </div>
                  </div>

                  {item.notes ? <p className="text-sm text-slate-600">{item.notes}</p> : null}

                  <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => setPreviewItem(item)}>
                      크게 보기
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => triggerDownload(item.image_url, `${slugify(item.title) || 'image'}.jpg`)}>
                      <Download className="mr-2 h-4 w-4" />
                      다운로드
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleCopyImage(item)}>
                      <Copy className="mr-2 h-4 w-4" />
                      {copiedItemId === item.id ? '복사됨' : '복사'}
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
            )
          })}
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-sm text-slate-500">
            총 {totalCount}개 / 현재 카테고리: {getCategoryLabel(selectedCategoryId, categories)}
            {canUseGroups ? ` / 현재 그룹: ${getGroupLabel(selectedGroupId, groups)}` : ''}
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

      {showUploadModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Upload className="h-5 w-5 text-primary" />
                이미지 추가
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Plus className="mr-2 h-4 w-4" />
                  파일 더 추가
                </Button>
                <Button variant="ghost" size="icon" onClick={closeUploadModal} disabled={uploading}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6">
              {uploadQueue.length === 0 ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-slate-50 text-center">
                  <Upload className="h-10 w-10 text-slate-400" />
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-slate-900">업로드할 이미지를 선택해 주세요</p>
                    <p className="text-sm text-slate-500">한 번에 최대 30장까지 추가할 수 있습니다.</p>
                  </div>
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <Plus className="mr-2 h-4 w-4" />
                    이미지 선택
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {uploadQueue.map((file) => (
                      <div key={file.id} className="overflow-hidden rounded-2xl border bg-white">
                        <img src={file.previewUrl} alt="업로드 미리보기" className="aspect-[4/5] w-full object-cover" />
                        <div className="space-y-3 p-4">
                          <Input
                            value={file.title}
                            onChange={(event) =>
                              setUploadQueue((prev) =>
                                prev.map((item) => (item.id === file.id ? { ...item, title: event.target.value } : item))
                              )
                            }
                            placeholder="제목 없이 저장해도 됩니다"
                          />
                          <div className="text-xs text-slate-500">
                            {formatFileSize(file.file.size)} / {file.width}x{file.height}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={() => setUploadQueue((prev) => prev.filter((item) => item.id !== file.id))}
                          >
                            <X className="mr-2 h-4 w-4" />
                            제외
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={closeUploadModal} disabled={uploading}>
                닫기
              </Button>
              <Button variant="outline" onClick={() => setUploadQueue([])} disabled={uploading || uploadQueue.length === 0}>
                전체 비우기
              </Button>
              <Button onClick={handleUploadImages} disabled={uploading || uploadQueue.length === 0}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploading ? '업로드 중...' : `${uploadQueue.length}장 저장`}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showCategoryModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>카테고리 추가</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowCategoryModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>카테고리명</Label>
                <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="예: 무드보드" />
              </div>
              <div className="space-y-2">
                <Label>카테고리 색상</Label>
                <Input type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCategoryModal(false)}>
                  취소
                </Button>
                <Button onClick={handleCreateCategory}>추가</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showGroupModal && canCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>그룹 폴더 추가</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowGroupModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                현재 카테고리: <span className="font-medium text-slate-900">{getCategoryLabel(selectedCategoryId, categories)}</span>
              </div>
              <div className="space-y-2">
                <Label>그룹명</Label>
                <Input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="예: 상의, 하의, 가디건" />
              </div>
              <div className="space-y-2">
                <Label>그룹 색상</Label>
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
      )}

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>정말 삭제하시겠습니까?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">선택된 이미지 {selectedIds.size}개가 Supabase 저장소와 보드 목록에서 함께 삭제됩니다.</p>
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
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>이미지 편집</CardTitle>
              <Button variant="ghost" size="icon" onClick={resetEditModal}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>제목</Label>
                <Input
                  value={editTitle === DEFAULT_IMAGE_BOARD_TITLE ? '' : editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  placeholder="제목 없이 저장할 수 있습니다"
                />
              </div>
              <div className="space-y-2">
                <Label>카테고리</Label>
                <Select
                  value={editCategoryId}
                  onChange={(event) => {
                    setEditCategoryId(event.target.value)
                    setEditGroupId('')
                  }}
                >
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
                  <Label>그룹 폴더</Label>
                  <Select value={editGroupId} onChange={(event) => setEditGroupId(event.target.value)}>
                    <option value="">그룹 없음</option>
                    {editGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
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

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewItem(null)}>
          <div className="max-h-[92vh] max-w-[92vw]" onClick={(event) => event.stopPropagation()}>
            <img src={previewItem.image_url} alt={previewItem.title} className="max-h-[80vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl" />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="bg-white" onClick={() => setPreviewItem(null)}>
                닫기
              </Button>
              <Button className="bg-white text-slate-900 hover:bg-slate-100" onClick={() => handleCopyImage(previewItem)}>
                <Copy className="mr-2 h-4 w-4" />
                {copiedItemId === previewItem.id ? '복사됨' : '복사'}
              </Button>
              <Button
                className="bg-white text-slate-900 hover:bg-slate-100"
                onClick={() => triggerDownload(previewItem.image_url, `${slugify(previewItem.title) || 'image'}.jpg`)}
              >
                <Download className="mr-2 h-4 w-4" />
                다운로드
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
