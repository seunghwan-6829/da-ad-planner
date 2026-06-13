'use client'

import { useRef, useState } from 'react'
import {
  X,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Image as ImageIcon,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-context'
import { aiFetch } from '@/lib/ai-fetch'
import {
  ShootingGuide,
  ShootingGuideShot,
  updateShootingGuide,
  updateShootingGuideShot,
  createShootingGuideShots,
  deleteShootingGuideShot,
  uploadShootingGuideImage,
} from '@/lib/api/shooting-guides'

interface EditShot {
  id?: string
  name: string
  description: string
  framing: string
  angle: string
  duration: string
  direction: string
  image_url: string | null
  image_path: string | null
  pendingDataUrl?: string // 새 이미지(미업로드) 미리보기
  regenBusy?: boolean
}

function dataUrlToFile(dataUrl: string, baseName: string): File {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(head)?.[1] || 'image/png'
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], `${baseName}.${ext}`, { type: mime })
}

export function ShootingGuideEditor({
  guide,
  onClose,
  onSaved,
}: {
  guide: ShootingGuide
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState(guide.title)
  const [ratio, setRatio] = useState(guide.ratio || '9:16')
  const [tips, setTips] = useState(guide.tips || '')
  const [shots, setShots] = useState<EditShot[]>(
    (guide.shots || []).map((s) => ({
      id: s.id,
      name: s.name || '',
      description: s.description || '',
      framing: s.framing || '',
      angle: s.angle || '',
      duration: s.duration || '',
      direction: s.direction || '',
      image_url: s.image_url,
      image_path: s.image_path,
    }))
  )
  const [removed, setRemoved] = useState<ShootingGuideShot[]>([])
  const [saving, setSaving] = useState(false)
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({})

  function setShot(idx: number, patch: Partial<EditShot>) {
    setShots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function readImageFile(idx: number, file: File) {
    const reader = new FileReader()
    reader.onload = () => setShot(idx, { pendingDataUrl: reader.result as string })
    reader.readAsDataURL(file)
  }

  function handleShotPaste(idx: number, e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type.startsWith('image/')) {
        const file = it.getAsFile()
        if (file) {
          e.preventDefault()
          readImageFile(idx, file)
        }
        return
      }
    }
  }

  async function regenImage(idx: number) {
    const s = shots[idx]
    const prompt =
      `Vertical 9:16 photorealistic reference shot. ` +
      [s.name, s.description, s.framing, s.angle].filter(Boolean).join('. ')
    setShot(idx, { regenBusy: true })
    try {
      const res = await aiFetch('/api/ai/shooting-guide-image', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(
          data.code === 'safety'
            ? '안전 필터에 막혔습니다. 설명을 완곡하게 바꾸거나 이미지를 직접 업로드/붙여넣기 해주세요.'
            : data.error || '이미지 생성 실패'
        )
        return
      }
      setShot(idx, { pendingDataUrl: `data:image/png;base64,${data.b64}` })
    } catch (err: any) {
      alert(`이미지 생성 실패: ${err?.message || '오류'}`)
    } finally {
      setShot(idx, { regenBusy: false })
    }
  }

  function addShot() {
    setShots((prev) => [
      ...prev,
      {
        name: '',
        description: '',
        framing: '',
        angle: '',
        duration: '',
        direction: '',
        image_url: null,
        image_path: null,
      },
    ])
  }

  function removeShot(idx: number) {
    const s = shots[idx]
    if (s.id) {
      const original = (guide.shots || []).find((o) => o.id === s.id)
      if (original) setRemoved((prev) => [...prev, original])
    }
    setShots((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await updateShootingGuide(guide.id, { title: title.trim() || guide.title, ratio, tips: tips.trim() || null })

      // 삭제된 컷
      for (const shot of removed) {
        await deleteShootingGuideShot(shot)
      }

      // 순서대로 업서트
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i]
        let id = s.id

        if (!id) {
          const [created] = await createShootingGuideShots([
            {
              guide_id: guide.id,
              shot_number: i + 1,
              name: s.name,
              description: s.description,
              framing: s.framing,
              angle: s.angle,
              duration: s.duration,
              direction: s.direction,
              image_url: null,
              image_path: null,
            },
          ])
          id = created?.id
        }
        if (!id) continue

        let image_url = s.image_url
        let image_path = s.image_path
        if (s.pendingDataUrl) {
          const file = dataUrlToFile(s.pendingDataUrl, `edit-${Date.now()}-${i + 1}`)
          const path = `${user?.id || 'anon'}/${guide.id}/${file.name}`
          const uploaded = await uploadShootingGuideImage(path, file)
          if (uploaded) {
            image_url = uploaded.url
            image_path = uploaded.path
          }
        }

        await updateShootingGuideShot(id, {
          shot_number: i + 1,
          name: s.name,
          description: s.description,
          framing: s.framing,
          angle: s.angle,
          duration: s.duration,
          direction: s.direction,
          image_url,
          image_path,
        })
      }

      onSaved()
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || '오류'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3.5">
          <h2 className="text-base font-bold dark:text-white">촬영 가이드 수정</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="dark:border-gray-700 dark:text-gray-300">
              취소
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" />저장</>}
            </Button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 가이드 기본 정보 */}
          <div className="space-y-3 rounded-xl border dark:border-gray-800 p-4">
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400">제목</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
            </div>
            <div className="flex gap-3">
              <div className="w-28">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">화면 비율</label>
                <Input value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="9:16" className="mt-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">촬영 팁</label>
                <Input value={tips} onChange={(e) => setTips(e.target.value)} placeholder="공통 촬영 팁" className="mt-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
              </div>
            </div>
          </div>

          {/* 컷 목록 */}
          {shots.map((s, idx) => (
            <div key={s.id || `new-${idx}`} className="flex gap-4 rounded-xl border dark:border-gray-800 p-4">
              {/* 이미지 */}
              <div className="w-32 shrink-0" onPaste={(e) => handleShotPaste(idx, e)} tabIndex={0}>
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                  {s.pendingDataUrl || s.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.pendingDataUrl || s.image_url || ''} alt={s.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-7 w-7 text-gray-300 dark:text-gray-600" />
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white">
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  {s.regenBusy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  <input
                    ref={(el) => {
                      fileInputs.current[idx] = el
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) readImageFile(idx, f)
                      e.target.value = ''
                    }}
                  />
                  <Button variant="outline" size="sm" className="h-7 text-xs dark:border-gray-700 dark:text-gray-300" onClick={() => fileInputs.current[idx]?.click()}>
                    <Upload className="h-3 w-3 mr-1" />업로드
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs dark:border-gray-700 dark:text-gray-300" onClick={() => regenImage(idx)} disabled={s.regenBusy}>
                    <Sparkles className="h-3 w-3 mr-1" />AI 재생성
                  </Button>
                </div>
                <p className="mt-1 text-[10px] leading-tight text-gray-400">이미지 영역 클릭 후 Ctrl+V로 붙여넣기 가능</p>
              </div>

              {/* 텍스트 필드 */}
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex gap-2">
                  <Input value={s.name} onChange={(e) => setShot(idx, { name: e.target.value })} placeholder="컷 이름" className="flex-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
                  <button onClick={() => removeShot(idx)} className="shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 px-2 text-gray-400 hover:text-red-500 hover:border-red-300" title="컷 삭제">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Textarea value={s.description} onChange={(e) => setShot(idx, { description: e.target.value })} placeholder="화면 설명" className="min-h-[52px] dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
                <div className="grid grid-cols-3 gap-2">
                  <Input value={s.framing} onChange={(e) => setShot(idx, { framing: e.target.value })} placeholder="구도" className="dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
                  <Input value={s.angle} onChange={(e) => setShot(idx, { angle: e.target.value })} placeholder="앵글" className="dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
                  <Input value={s.duration} onChange={(e) => setShot(idx, { duration: e.target.value })} placeholder="길이" className="dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
                </div>
                <Input value={s.direction} onChange={(e) => setShot(idx, { direction: e.target.value })} placeholder="촬영 디렉션" className="dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200" />
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addShot} className="w-full dark:border-gray-700 dark:text-gray-300">
            <Plus className="h-4 w-4 mr-1.5" />컷 추가
          </Button>
        </div>
      </div>
    </div>
  )
}
