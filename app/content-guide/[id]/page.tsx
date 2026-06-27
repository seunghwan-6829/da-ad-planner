'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Copy, Check, Download, Camera, Sparkles, Wand2, AlertTriangle, Link2, X, Pencil, RefreshCw, Layers } from 'lucide-react'
import { getContentGuide, updateContentGuide, ContentGuide, CGScene, CGGenItem, toStacks } from '@/lib/api/content-guides'
import { aiFetch } from '@/lib/ai-fetch'
import { supabase } from '@/lib/supabase'

const uid = () => Math.random().toString(36).slice(2, 9)

function b64ToBlob(b64: string, type = 'image/png'): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type })
}

async function saveUrl(url: string, name: string) {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  } catch { window.open(url, '_blank') }
}

export default function ContentGuideDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [cg, setCg] = useState<ContentGuide | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    if (!params?.id) return
    let alive = true
    getContentGuide(params.id)
      .then((d) => { if (!alive) return; if (d) { setCg(d); setState('ready') } else setState('notfound') })
      .catch(() => alive && setState('notfound'))
    return () => { alive = false }
  }, [params?.id])

  // 씬별 생성 이미지(레이어 스택) 갱신 + 저장
  function updateScene(idx: number, generated: CGGenItem[]) {
    setCg((prev) => {
      if (!prev) return prev
      const scenes = prev.data.scenes.map((s, i) => (i === idx ? { ...s, generated } : s))
      const data = { ...prev.data, scenes }
      updateContentGuide(prev.id, { data }).catch(() => {})
      return { ...prev, data }
    })
  }

  function sendToModelGuide(s: CGScene, idx: number) {
    try {
      const prev = JSON.parse(sessionStorage.getItem('model-guide-extra') || '[]')
      prev.push({ image: s.image, description: s.description, scene: idx + 1, at: Date.now() })
      sessionStorage.setItem('model-guide-extra', JSON.stringify(prev))
    } catch {}
    if (confirm("이 컷을 '모델 촬영 가이드 · 기타'로 보냈어요. 지금 이동할까요?")) router.push('/shooting-guide')
  }

  if (state === 'loading') return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 불러오는 중…</div>
  if (state === 'notfound' || !cg) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
        <p>컨텐츠 가이드를 찾을 수 없어요.</p>
        <button onClick={() => router.push('/content-guide')} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">목록으로</button>
      </div>
    )
  }

  const scenes = cg.data?.scenes || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => router.push('/content-guide')} className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ArrowLeft className="h-3.5 w-3.5" /> 목록</button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold dark:text-gray-100">{cg.title || '컨텐츠 가이드'}</h1>
            {cg.source_brand && <p className="truncate text-xs text-gray-400">출처: {cg.source_brand} · 씬 {scenes.length}개</p>}
          </div>
        </div>
        <button
          onClick={() => {
            const url = `${window.location.origin}/content-guide/share/${cg.id}`
            navigator.clipboard?.writeText(url).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800) }).catch(() => window.prompt('공유 링크 (복사하세요)', url))
          }}
          title="외부 공개 링크 복사 (로그인 없이 볼 수 있는 읽기전용 페이지)"
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${linkCopied ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}`}
        >
          {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {linkCopied ? '복사됨' : '공유 URL'}
        </button>
      </div>

      <div className="space-y-4">
        {scenes.map((s, i) => (
          <SceneRow key={i} idx={i} scene={s} onSave={() => saveUrl(s.image, `scene-${i + 1}.jpg`)} onSend={() => sendToModelGuide(s, i)} onGenerated={(g) => updateScene(i, g)} />
        ))}
      </div>
    </div>
  )
}

function SceneRow({ idx, scene, onSave, onSend, onGenerated }: { idx: number; scene: CGScene; onSave: () => void; onSend: () => void; onGenerated: (g: CGGenItem[]) => void }) {
  const [copied, setCopied] = useState(false)
  const [count, setCount] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [nsfw, setNsfw] = useState(false)
  // 각 칸 = 레이어 스택([과거…, 최신]). 표시·다운로드는 최신(맨 끝).
  const [stacks, setStacks] = useState<string[][]>(() => toStacks(scene.generated))
  const [promptText, setPromptText] = useState(scene.prompt || '')

  // 라이트박스(플로팅) 상태
  const [lightbox, setLightbox] = useState<number | null>(null) // 열린 칸 index
  const [viewLayer, setViewLayer] = useState(0)                 // 그 칸에서 크게 보는 레이어
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [regening, setRegening] = useState(false)
  const [nsfwMode, setNsfwMode] = useState<null | 'edit' | 'regen'>(null)

  async function uploadGen(b64: string): Promise<string> {
    const path = `content-img/${uid()}.png`
    const { error } = await supabase.storage.from('shooting-guides').upload(path, b64ToBlob(b64), { contentType: 'image/png', upsert: true })
    if (error) throw error
    return supabase.storage.from('shooting-guides').getPublicUrl(path).data.publicUrl
  }

  // 특정 칸 스택 위에 새 레이어(URL) 쌓기 + 저장
  function pushLayer(stackIdx: number, url: string): string[][] {
    const next = stacks.map((s, i) => (i === stackIdx ? [...s, url] : s))
    setStacks(next)
    onGenerated(next)
    return next
  }

  async function generate(sanitize = false) {
    setGenerating(true)
    setNsfw(false)
    try {
      const usePrompt = promptText.trim() || scene.prompt
      const calls = Array.from({ length: count }, () =>
        aiFetch('/api/ai/content-image', { method: 'POST', body: JSON.stringify({ prompt: usePrompt, ratio: '9:16', sanitize }) })
      )
      const ress = await Promise.all(calls)
      const newUrls: string[] = []
      let nsfwHit = false
      let errMsg = ''
      for (const res of ress) {
        const j = await res.json().catch(() => ({}))
        if (j.nsfw) { nsfwHit = true; continue }
        if (!res.ok) { errMsg = j.error || '이미지 생성 실패'; continue }
        if (j.b64) { try { newUrls.push(await uploadGen(j.b64)) } catch { errMsg = '저장 실패' } }
      }
      if (newUrls.length) {
        const merged = [...stacks, ...newUrls.map((u) => [u])] // 각 신규 이미지는 새 칸
        setStacks(merged)
        onGenerated(merged)
      }
      if (!newUrls.length && nsfwHit) setNsfw(true)
      else if (!newUrls.length && errMsg) alert(errMsg)
    } finally {
      setGenerating(false)
    }
  }

  function openLightbox(i: number) {
    setLightbox(i)
    setViewLayer(stacks[i].length - 1)
    setEditText('')
    setNsfwMode(null)
  }
  function closeLightbox() { setLightbox(null) }

  // 편집: 현재 보는 레이어를 수정 프롬프트대로 고쳐 새 레이어로 위에 쌓음(image-to-image)
  async function editImage(sanitize = false) {
    if (lightbox == null) return
    if (!editText.trim()) { alert('수정 프롬프트를 입력해 주세요.'); return }
    const base = stacks[lightbox][viewLayer]
    setEditing(true); setNsfwMode(null)
    try {
      const res = await aiFetch('/api/ai/content-image-edit', { method: 'POST', body: JSON.stringify({ image_url: base, prompt: editText, ratio: '9:16', sanitize }) })
      const j = await res.json().catch(() => ({}))
      if (j.nsfw) { setNsfwMode('edit'); return }
      if (!res.ok) { alert(j.error || '편집에 실패했어요.'); return }
      if (j.b64) {
        const url = await uploadGen(j.b64)
        const next = pushLayer(lightbox, url)
        setViewLayer(next[lightbox].length - 1)
        setEditText('')
      }
    } catch { alert('편집 중 오류가 발생했어요.') } finally { setEditing(false) }
  }

  // 재생성: 프롬프트로 완전히 새 이미지(text-to-image)를 만들어 같은 칸 위에 레이어로 쌓음
  async function regenImage(sanitize = false) {
    if (lightbox == null) return
    setRegening(true); setNsfwMode(null)
    try {
      const usePrompt = editText.trim() || scene.prompt
      const res = await aiFetch('/api/ai/content-image', { method: 'POST', body: JSON.stringify({ prompt: usePrompt, ratio: '9:16', sanitize }) })
      const j = await res.json().catch(() => ({}))
      if (j.nsfw) { setNsfwMode('regen'); return }
      if (!res.ok) { alert(j.error || '재생성에 실패했어요.'); return }
      if (j.b64) {
        const url = await uploadGen(j.b64)
        const next = pushLayer(lightbox, url)
        setViewLayer(next[lightbox].length - 1)
      }
    } catch { alert('재생성 중 오류가 발생했어요.') } finally { setRegening(false) }
  }

  const openStack = lightbox != null ? stacks[lightbox] : null

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 lg:grid-cols-2">
      {/* 좌: 스토리보드(프리뷰 축소) */}
      <div className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{idx + 1}</span>
        <div className="w-[96px] shrink-0 space-y-2">
          <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scene.image} alt="" className="h-full w-full object-contain" />
          </div>
          <button onClick={onSave} className="flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 px-1.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Download className="h-3 w-3" /> 저장</button>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-bold text-gray-400"><Sparkles className="h-3 w-3" /> 프롬프트</span>
              <button onClick={() => { navigator.clipboard?.writeText(scene.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="flex items-center gap-1 text-[11px] text-primary hover:underline">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? '복사됨' : '복사'}</button>
            </div>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[12px] leading-relaxed text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">{scene.prompt || '—'}</p>
          </div>
          <div className="text-[12px]">
            <span className="font-bold text-gray-400">설명 </span><span className="text-gray-700 dark:text-gray-200">{scene.description || '—'}</span>
          </div>
          <div className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"><b>주의</b> {scene.caution || '—'}</div>
          <button onClick={onSend} className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"><Camera className="h-3.5 w-3.5" /> 모델 촬영 가이드로 보내기</button>
        </div>
      </div>

      {/* 우: 이미지 생성 (프롬프트 입력칸 + 컴팩트 컨트롤) */}
      <div className="space-y-2.5 lg:border-l lg:border-gray-100 lg:pl-4 dark:lg:border-gray-800">
        <span className="flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-gray-300"><Wand2 className="h-3.5 w-3.5 text-violet-500" /> 이미지 생성 (gpt-image-2, 9:16)</span>
        {/* 프롬프트(수정 가능 — 비워도 위 프롬프트가 기본으로 들어가 있음) */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5 dark:border-gray-700 dark:bg-gray-800/40">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">프롬프트</div>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={4}
            placeholder="이미지를 설명하세요 — 비우면 위 프롬프트로 생성됩니다"
            className="w-full resize-none rounded-lg border border-gray-200 bg-white p-2 text-[12px] leading-relaxed text-gray-700 outline-none focus:border-violet-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 4].map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`rounded-md border px-2 py-0.5 text-[11px] ${count === n ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'}`}>{n}장</button>
              ))}
            </div>
            <span className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">9:16</span>
            {/* 생성 이미지 정사각형 썸네일(클릭 → 플로팅으로 크게 보기·편집) */}
            {stacks.map((st, i) => (
              <button key={i} onClick={() => openLightbox(i)} title="클릭해서 크게 보기·편집" className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-gray-200 transition hover:ring-2 hover:ring-violet-400 dark:border-gray-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={st[st.length - 1]} alt="" className="h-full w-full object-cover" />
                {st.length > 1 && <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[9px] font-bold leading-tight text-white">{st.length}</span>}
              </button>
            ))}
            <button onClick={() => generate(false)} disabled={generating} className="ml-auto flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> 생성 중…</> : <><Wand2 className="h-4 w-4" /> 생성</>}
            </button>
          </div>
        </div>
        {nsfw && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <div className="mb-1.5 flex items-center gap-1 font-bold"><AlertTriangle className="h-3.5 w-3.5" /> 선정적 이슈로 생성되지 않았어요.</div>
            <button onClick={() => generate(true)} disabled={generating} className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50">순화해서 제작</button>
          </div>
        )}
      </div>

      {/* 플로팅 라이트박스: 큰 미리보기 + 레이어 + 편집/재생성 */}
      {lightbox != null && openStack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeLightbox}>
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col gap-4 overflow-hidden rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900 sm:flex-row" onClick={(e) => e.stopPropagation()}>
            {/* 좌: 큰 이미지 + 레이어 스트립 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Layers className="h-4 w-4 text-violet-500" /> 씬 {idx + 1} · 레이어 {viewLayer + 1}/{openStack.length}</span>
                <button onClick={closeLightbox} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={openStack[viewLayer]} alt="" className="max-h-[64vh] w-auto max-w-full object-contain" />
              </div>
              {openStack.length > 1 && (
                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
                  <span className="shrink-0 text-[10px] font-bold text-gray-400">레이어</span>
                  {openStack.map((u, li) => (
                    <button key={li} onClick={() => setViewLayer(li)} className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 ${li === viewLayer ? 'border-violet-500' : 'border-transparent hover:border-gray-300'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="h-full w-full object-cover" />
                      {li === openStack.length - 1 && <span className="absolute inset-x-0 bottom-0 bg-violet-600/85 text-center text-[8px] font-bold text-white">최신</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 우: 편집 패널 */}
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-64">
              <div className="text-xs font-bold text-gray-500 dark:text-gray-300">이미지 수정</div>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={5} placeholder="수정할 내용을 적어주세요. 예) 배경을 밝은 카페로 / 옷을 흰색으로 / 더 환하게" className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-[12px] leading-relaxed text-gray-700 outline-none focus:border-violet-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
              <div className="flex gap-2">
                <button onClick={() => editImage(false)} disabled={editing || regening} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-violet-600 px-2 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  {editing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 편집 중</> : <><Pencil className="h-3.5 w-3.5" /> 편집</>}
                </button>
                <button onClick={() => regenImage(false)} disabled={editing || regening} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  {regening ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 재생성</> : <><RefreshCw className="h-3.5 w-3.5" /> 재생성</>}
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-400">
                <b className="text-gray-500 dark:text-gray-300">편집</b> = 현재 이미지를 그대로 두고 수정 프롬프트만 반영해 고침. <b className="text-gray-500 dark:text-gray-300">재생성</b> = 프롬프트로 완전히 새 이미지. 둘 다 <b>기존은 아래 레이어로 보존</b>되고 새 결과가 위로 쌓여요.
              </p>
              {nsfwMode && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  <div className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="h-3 w-3" /> 선정적 이슈로 막혔어요.</div>
                  <button onClick={() => (nsfwMode === 'edit' ? editImage(true) : regenImage(true))} disabled={editing || regening} className="rounded-md bg-amber-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-700 disabled:opacity-50">순화해서 다시</button>
                </div>
              )}
              <button onClick={() => saveUrl(openStack[viewLayer], `gen-${idx + 1}-L${viewLayer + 1}.png`)} className="mt-auto flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Download className="h-3.5 w-3.5" /> 이 레이어 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
