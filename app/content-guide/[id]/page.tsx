'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Copy, Check, Download, Camera, Sparkles, Wand2, AlertTriangle, Link2 } from 'lucide-react'
import { getContentGuide, updateContentGuide, ContentGuide, CGScene } from '@/lib/api/content-guides'
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

  // 씬별 생성 이미지 갱신 + 저장
  function updateScene(idx: number, generated: string[]) {
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
          <SceneRow key={i} idx={i} scene={s} onSave={() => saveUrl(s.image, `scene-${i + 1}.jpg`)} onSend={() => sendToModelGuide(s, i)} onGenerated={(urls) => updateScene(i, urls)} />
        ))}
      </div>
    </div>
  )
}

function SceneRow({ idx, scene, onSave, onSend, onGenerated }: { idx: number; scene: CGScene; onSave: () => void; onSend: () => void; onGenerated: (urls: string[]) => void }) {
  const [copied, setCopied] = useState(false)
  const [count, setCount] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [nsfw, setNsfw] = useState(false)
  const [gen, setGen] = useState<string[]>(scene.generated || [])
  const [promptText, setPromptText] = useState(scene.prompt || '')

  async function uploadGen(b64: string): Promise<string> {
    const path = `content-img/${uid()}.png`
    const { error } = await supabase.storage.from('shooting-guides').upload(path, b64ToBlob(b64), { contentType: 'image/png', upsert: true })
    if (error) throw error
    return supabase.storage.from('shooting-guides').getPublicUrl(path).data.publicUrl
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
        const merged = [...gen, ...newUrls]
        setGen(merged)
        onGenerated(merged)
      }
      if (!newUrls.length && nsfwHit) setNsfw(true)
      else if (!newUrls.length && errMsg) alert(errMsg)
    } finally {
      setGenerating(false)
    }
  }

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
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              {[1, 2, 4].map((n) => (
                <button key={n} onClick={() => setCount(n)} className={`rounded-md border px-2 py-0.5 text-[11px] ${count === n ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'}`}>{n}장</button>
              ))}
            </div>
            <span className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">9:16</span>
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
        {gen.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {gen.map((url, i) => (
              <div key={i} className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="aspect-[9/16] w-full object-cover" />
                <button onClick={() => saveUrl(url, `gen-${idx + 1}-${i + 1}.png`)} className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white opacity-0 hover:bg-black/70 group-hover:opacity-100" title="저장"><Download className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
