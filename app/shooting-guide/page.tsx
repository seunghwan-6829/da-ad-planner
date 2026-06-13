'use client'

import { useState, useEffect } from 'react'
import {
  Camera,
  Loader2,
  X,
  Send,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Image as ImageIcon,
  FileText,
  Paperclip,
  Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import { aiFetch } from '@/lib/ai-fetch'
import { getClients, getClientsForUser, Client } from '@/lib/api/clients'
import {
  getShootingGuides,
  getShootingGuideWithShots,
  createShootingGuide,
  createShootingGuideShots,
  updateShootingGuideShot,
  publishGuide,
  deleteShootingGuide,
  uploadShootingGuideImage,
  createShareId,
  ShootingGuide,
} from '@/lib/api/shooting-guides'
import { ShootingGuideEditor } from '@/components/shooting-guide-editor'

interface PlanShot {
  name?: string
  description?: string
  framing?: string
  angle?: string
  duration?: string
  direction?: string
  imagePrompt?: string
}

// 컷 = 텍스트 + (선택) 붙여넣은 레퍼런스 이미지
interface CutItem {
  text: string
  imageDataUrl?: string
}

function b64ToFile(b64: string, name: string): File {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'image/png' })
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

async function requestImage(
  prompt: string
): Promise<{ ok: boolean; b64?: string; code?: string; status: number; error?: string }> {
  const res = await aiFetch('/api/ai/shooting-guide-image', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
  const data = await res.json()
  return { ok: res.ok, b64: data.b64, code: data.code, status: res.status, error: data.error }
}

export default function ShootingGuidePage() {
  const { user, isAdmin } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)

  const [guides, setGuides] = useState<ShootingGuide[]>([])
  const [guidesLoading, setGuidesLoading] = useState(false)

  // 제작기
  const [cutInput, setCutInput] = useState('')
  const [cuts, setCuts] = useState<CutItem[]>([])
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ step: string; done: number; total: number } | null>(null)

  const [copied, setCopied] = useState<string | null>(null)
  const [editingGuide, setEditingGuide] = useState<ShootingGuide | null>(null)

  useEffect(() => {
    loadClients()
  }, [user, isAdmin])

  async function loadClients() {
    if (!user) return
    try {
      const data = isAdmin ? await getClients() : await getClientsForUser(user.id)
      setClients(data)
    } catch (err) {
      console.error('클라이언트 로드 실패:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectClient(client: Client) {
    setSelectedClient(client)
    setCuts([])
    setCutInput('')
    setPendingImage(null)
    setProgress(null)
    setGuidesLoading(true)
    try {
      const data = await getShootingGuides(client.id)
      setGuides(data)
    } catch (err) {
      console.error('가이드 로드 실패:', err)
      setGuides([])
    } finally {
      setGuidesLoading(false)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type.startsWith('image/')) {
        const file = it.getAsFile()
        if (file) {
          e.preventDefault()
          const reader = new FileReader()
          reader.onload = () => setPendingImage(reader.result as string)
          reader.readAsDataURL(file)
        }
        return
      }
    }
  }

  function addCut() {
    const v = cutInput.trim()
    if (!v && !pendingImage) return
    setCuts((prev) => [...prev, { text: v, imageDataUrl: pendingImage || undefined }])
    setCutInput('')
    setPendingImage(null)
  }

  function removeCut(index: number) {
    setCuts((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleCreateList() {
    if (!selectedClient || cuts.length === 0 || busy) return

    setBusy(true)
    setProgress({ step: 'AI가 컷을 설계하는 중...', done: 0, total: cuts.length })

    try {
      // 1) 텍스트 기획 (제목 + 컷 설명) — 붙여넣은 이미지 컷도 설명/구도는 AI가 작성
      const planRes = await aiFetch('/api/ai/shooting-guide-plan', {
        method: 'POST',
        body: JSON.stringify({
          clientName: selectedClient.name,
          cuts: cuts.map((c) => c.text || '레퍼런스 이미지 컷'),
        }),
      })
      const plan = await planRes.json()
      if (!planRes.ok) throw new Error(plan.error || '컷 설계 실패')

      const shots: PlanShot[] = plan.shots || []
      if (shots.length === 0) throw new Error('AI가 컷을 생성하지 못했습니다.')

      // 2) 가이드 + 컷 행 생성 (이미지 전)
      const shareId = createShareId()
      const guide = await createShootingGuide({
        client_id: selectedClient.id,
        title: plan.title || `${selectedClient.name} 촬영 가이드`,
        ratio: plan.ratio || '9:16',
        tips: plan.tips || null,
        share_id: shareId,
        created_by: user?.id || null,
      })
      if (!guide) throw new Error('가이드 생성 실패')

      const shotRows = await createShootingGuideShots(
        shots.map((s, i) => ({
          guide_id: guide.id,
          shot_number: i + 1,
          name: s.name || `컷 ${i + 1}`,
          description: s.description || '',
          framing: s.framing || '',
          angle: s.angle || '',
          duration: s.duration || '',
          direction: s.direction || '',
          image_url: null,
          image_path: null,
        }))
      )

      // 3) 컷별 이미지: 붙여넣은 레퍼런스가 있으면 그걸 업로드, 없으면 AI 생성
      let failed = 0
      let safetyBlocked = false
      for (let i = 0; i < shotRows.length; i++) {
        const pasted = cuts[i]?.imageDataUrl
        setProgress({
          step: pasted ? '레퍼런스 이미지 업로드 중...' : '레퍼런스 컷 생성 중...',
          done: i,
          total: shotRows.length,
        })

        let file: File | null = null

        if (pasted) {
          // 붙여넣은 이미지 사용 (AI 생성 안 함)
          file = dataUrlToFile(pasted, `shot-${i + 1}`)
        } else {
          const prompt = shots[i]?.imagePrompt || shots[i]?.description || ''
          if (!prompt) {
            failed++
            continue
          }
          const r = await requestImage(prompt)
          if (!r.ok && r.status === 401) throw new Error(r.error || 'OpenAI API 키 오류')
          if (!r.ok || !r.b64) {
            if (r.code === 'safety') safetyBlocked = true
            failed++
            continue // 막힌 컷은 건너뛰고 진행 (전체 중단 X, 재시도 X)
          }
          file = b64ToFile(r.b64, `shot-${i + 1}.png`)
        }

        try {
          const path = `${user?.id || 'anon'}/${guide.id}/${file.name}`
          const uploaded = await uploadShootingGuideImage(path, file)
          if (uploaded) {
            await updateShootingGuideShot(shotRows[i].id, {
              image_url: uploaded.url,
              image_path: uploaded.path,
            })
          } else {
            failed++
          }
        } catch {
          failed++
        }
      }

      // 4) 발행 (일부 컷이 실패해도 발행)
      setProgress({ step: '발행 중...', done: shotRows.length, total: shotRows.length })
      await publishGuide(guide.id)

      // 5) 정리 + 뷰어 열기
      setCuts([])
      setCutInput('')
      setPendingImage(null)
      const data = await getShootingGuides(selectedClient.id)
      setGuides(data)
      setProgress(null)
      window.open(`${window.location.origin}/guide/${shareId}`, '_blank')

      if (failed > 0) {
        alert(
          `${shotRows.length}컷 중 ${failed}컷은 이미지 생성에 실패했습니다.\n` +
            `가이드는 발행됐고 해당 컷은 이미지 없이 표시됩니다.` +
            (safetyBlocked
              ? `\n\nOpenAI 안전 필터에 막힌 컷이 있습니다. 해당 컷 설명을 더 완곡하게(신체·노출·포즈 표현 제거) 바꾸거나, 직접 레퍼런스 이미지를 붙여넣어(Ctrl+V) 다시 시도해 보세요.`
              : '')
        )
      }
    } catch (err: any) {
      alert(`제작 실패: ${err?.message || '알 수 없는 오류'}`)
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  function copyLink(shareId: string) {
    const url = `${window.location.origin}/guide/${shareId}`
    navigator.clipboard.writeText(url)
    setCopied(shareId)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleEditGuide(guide: ShootingGuide) {
    const full = await getShootingGuideWithShots(guide.id)
    if (full) setEditingGuide(full)
    else alert('가이드를 불러오지 못했습니다.')
  }

  async function handleEditorSaved() {
    setEditingGuide(null)
    if (selectedClient) {
      const data = await getShootingGuides(selectedClient.id)
      setGuides(data)
    }
  }

  async function handleDeleteGuide(guide: ShootingGuide) {
    if (!confirm(`"${guide.title}" 가이드를 삭제할까요?`)) return
    try {
      await deleteShootingGuide(guide)
      setGuides((prev) => prev.filter((g) => g.id !== guide.id))
    } catch (err: any) {
      alert(`삭제 실패: ${err?.message || '오류'}`)
    }
  }

  function thumbnailOf(guide: ShootingGuide): string | null {
    const withImg = (guide.shots || []).find((s) => s.image_url)
    return withImg?.image_url || null
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex h-screen">
        {/* 좌측 브랜드 폴더 */}
        <div className="w-64 border-r bg-white dark:bg-gray-900 dark:border-gray-800 flex flex-col">
          <div className="p-4 border-b dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold dark:text-white">촬영 가이드</h1>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">브랜드별 모델 촬영 샷 리스트</p>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {clients.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  기획안 제작에서
                  <br />
                  클라이언트를 추가하세요
                </p>
              </div>
            ) : (
              clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1 ${
                    selectedClient?.id === client.id
                      ? 'bg-primary text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: client.color }} />
                  <span className="truncate">{client.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 우측 메인 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedClient ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Camera className="h-16 w-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-400 dark:text-gray-500 mb-2">브랜드를 선택하세요</h2>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  찍을 컷을 적으면 AI가 제목과 레퍼런스 컷을 자동으로 만들어
                  <br />
                  모델이 받는 촬영 가이드 페이지로 발행합니다
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* 제작기 */}
              <div className="border-b dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedClient.color }} />
                  <h2 className="text-lg font-bold dark:text-white">{selectedClient.name}</h2>
                  <span className="text-xs text-gray-400 dark:text-gray-500">새 촬영 가이드 만들기</span>
                </div>

                {/* 칩 입력 */}
                <div className="flex gap-2">
                  <Input
                    value={cutInput}
                    onChange={(e) => setCutInput(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCut()
                      }
                    }}
                    placeholder="찍을 컷을 적고 Enter · 이미지는 Ctrl+V로 붙여넣기"
                    disabled={busy}
                    className="flex-1 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
                  />
                  <Button
                    onClick={handleCreateList}
                    disabled={busy || cuts.length === 0}
                    className="bg-primary text-white px-5"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-1.5" />리스트 제작</>}
                  </Button>
                </div>

                {/* 붙여넣은 이미지 대기 미리보기 */}
                {pendingImage && (
                  <div className="mt-2 flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pendingImage} alt="첨부 이미지" className="h-12 w-12 rounded-md object-cover border dark:border-gray-700" />
                      <button
                        type="button"
                        onClick={() => setPendingImage(null)}
                        className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white shadow hover:bg-red-500"
                        aria-label="이미지 제거"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      레퍼런스 이미지 첨부됨 — 설명을 입력하고 Enter (이 컷은 AI 생성 대신 이 이미지를 사용합니다)
                    </span>
                  </div>
                )}

                {/* 칩 목록 (클릭 비활성, hover 시 ✕) */}
                {cuts.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {cuts.map((cut, i) => (
                      <div
                        key={i}
                        className={`group relative flex items-center gap-2 select-none cursor-default rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 ${
                          cut.imageDataUrl ? 'pl-1.5' : 'pl-3'
                        } pr-7 py-1.5 text-sm text-gray-700 dark:text-gray-200 max-w-xs`}
                      >
                        {cut.imageDataUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cut.imageDataUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                        )}
                        <span className="truncate">
                          <span className="text-gray-400 mr-1">{i + 1}.</span>
                          {cut.text || (
                            <span className="inline-flex items-center gap-1 text-gray-500">
                              <Paperclip className="h-3 w-3" />
                              레퍼런스 컷
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCut(i)}
                          disabled={busy}
                          className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center h-5 w-5 rounded-full bg-gray-700 dark:bg-gray-600 text-white shadow hover:bg-red-500"
                          aria-label="컷 삭제"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 진행률 / 안내 */}
                {progress && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {progress.step}
                      {progress.total > 0 && ` (${progress.done}/${progress.total} 컷)`}
                    </span>
                  </div>
                )}
                {!progress && cuts.length === 0 && (
                  <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                    컷을 1개 이상 추가한 뒤 "리스트 제작"을 누르세요. 컷 1개당 레퍼런스 이미지 1장이 생성되며,
                    이미지를 직접 붙여넣은(Ctrl+V) 컷은 그 이미지를 그대로 사용합니다.
                  </p>
                )}
              </div>

              {/* 기존 가이드 목록 (컴팩트) */}
              <div className="flex-1 overflow-y-auto p-6">
                {guidesLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : guides.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <ImageIcon className="h-12 w-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                      <p className="text-gray-400 dark:text-gray-500">아직 만든 촬영 가이드가 없습니다</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 max-w-3xl">
                    {guides.map((guide) => {
                      const thumb = thumbnailOf(guide)
                      return (
                        <div
                          key={guide.id}
                          className="flex items-center gap-3 bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-xl p-2.5"
                        >
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb} alt={guide.title} className="h-full w-full object-cover" />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold dark:text-gray-100">{guide.title}</p>
                            <p className="text-xs text-gray-400 flex items-center gap-1.5">
                              <span>{new Date(guide.created_at).toLocaleDateString('ko-KR')}</span>
                              <span>·</span>
                              <span>{guide.shots?.length || 0}컷</span>
                              {guide.status !== 'ready' && (
                                <span className="rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 text-[10px] font-bold">
                                  {guide.status === 'generating' ? '생성중' : '임시'}
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs dark:border-gray-700 dark:text-gray-300"
                              onClick={() => handleEditGuide(guide)}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              수정
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs dark:border-gray-700 dark:text-gray-300"
                              onClick={() => window.open(`${window.location.origin}/guide/${guide.share_id}`, '_blank')}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-1" />
                              뷰어
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 dark:border-gray-700 dark:text-gray-300"
                              onClick={() => copyLink(guide.share_id)}
                              title="링크 복사"
                            >
                              {copied === guide.share_id ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 dark:border-gray-700"
                              onClick={() => handleDeleteGuide(guide)}
                              title="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editingGuide && (
        <ShootingGuideEditor
          guide={editingGuide}
          onClose={() => setEditingGuide(null)}
          onSaved={handleEditorSaved}
        />
      )}
    </div>
  )
}
