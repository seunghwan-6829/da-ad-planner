'use client'

/* 전역 생성 작업 큐 + 우측 하단 진행 토스트 (기획 마인드맵 · 컨텐츠 가이드).
   왜 전역인가: 제작 리스트에서 생성을 누르고 로딩을 붙잡고 기다릴 필요 없이,
   여러 소재를 연달아 눌러 '중첩'으로 돌리고 다른 페이지로 이동해도 진행 표시가 따라오게.
   - SPA(App Router) 클라이언트 이동에서는 fetch 가 끊기지 않으므로 레이아웃 전역에 상태를 두면 유지된다.
   - ⚠️ 새로고침·탭 닫기는 브라우저 특성상 진행 중인 생성이 끊긴다(토스트 툴팁으로 안내).
   동작: 실행 중=파란 진행바 → 완료=초록 체크 + 소요시간 + [열기] → 3초 뒤 서서히 사라짐(호버 시 유지),
        아래 것이 사라지면 위에 쌓인 토스트가 부드럽게 내려온다. 실패=빨강(수동 닫기).
        같은 소재를 또 누르면 새로 안 만들고 기존 토스트를 반짝 강조한다. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Film, ImageOff, Network, X } from 'lucide-react'
import { aiFetch } from '@/lib/ai-fetch'
import { createMindmap, type MindmapData } from '@/lib/api/mindmaps'
import { createContentGuide, type CGScene } from '@/lib/api/content-guides'

export type GenSource = 'meta' | 'google' | 'owned'
export type GenKind = 'mindmap' | 'guide'

// AI 라우트(loadCreative) source 매핑: 메타=기본(am), 구글=ga, 온드=om — 제작 리스트와 동일 규칙
const AI_SOURCE: Record<GenSource, string | undefined> = { meta: undefined, google: 'ga', owned: 'om' }
const TRANSCRIPT_EP: Record<GenSource, string> = {
  meta: '/api/meta-ad/transcript',
  google: '/api/google-ads/transcript',
  owned: '/api/owned-media/transcript',
}
const KIND_LABEL: Record<GenKind, string> = { mindmap: '기획 마인드맵', guide: '컨텐츠 가이드' }
const OPEN_PATH: Record<GenKind, (id: string) => string> = {
  mindmap: (id) => `/plan-mindmap/${id}`,
  guide: (id) => `/content-guide/${id}`,
}

export interface GenJobInput {
  kind: GenKind
  source: GenSource
  refId: string
  clientId: string
  label: string            // 토스트 제목(브랜드/소재명)
  sub?: string             // 부가 표시(클라이언트명 등)
  brand?: string | null    // source_brand 저장용(없으면 null 유지)
  thumb?: string | null
  isVideo?: boolean        // 영상 소재면 대본(나레이션)부터 추출
  /* (가이드 전용) 브라우저 씬 프레임 추출 — 크롤러 상세의 extractSceneFrames 클로저를 받는다.
     프레임이 나오면 장면별 병렬 생성(동시 4개, 크롤러 기존 로직 그대로), 실패/빈 배열이면 서버 배치 폴백. */
  getFrames?: () => Promise<string[]>
}

interface GenJob {
  id: string
  kind: GenKind
  key: string
  label: string
  sub?: string
  thumb?: string | null
  status: 'running' | 'done' | 'error'
  error?: string
  resultId?: string
  progress?: string // 진행 부가표시(예: "장면 3/8")
  startedAt: number
  endedAt?: number
  fading?: boolean
}

interface GenJobsCtx {
  /* 생성 시작. 같은 소재·같은 종류가 이미 실행 중이면 'exists'(기존 토스트 강조)를 돌려준다. */
  start: (input: GenJobInput) => 'started' | 'exists'
}

const GenJobsContext = createContext<GenJobsCtx>({ start: () => 'started' })
export const useGenJobs = () => useContext(GenJobsContext)

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function GenJobsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [jobs, setJobs] = useState<GenJob[]>([])
  const [bumpId, setBumpId] = useState<string | null>(null)
  const jobsRef = useRef<GenJob[]>(jobs)
  jobsRef.current = jobs
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const aborts = useRef(new Map<string, AbortController>())
  const hovered = useRef(new Set<string>())

  // 실행 중 경과시간 표시용 1초 틱(도는 작업이 있을 때만)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'running')) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [jobs])

  const patch = useCallback((id: string, p: Partial<GenJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)))
  }, [])

  const removeJob = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    aborts.current.delete(id)
    hovered.current.delete(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  /* 2단계 퇴장: 접힘(fading: 높이·투명도 0) → 350ms 뒤 실제 제거.
     제거 순간이 아니라 접히는 동안 위 토스트들이 부드럽게 내려온다. */
  const fadeOut = useCallback((id: string) => {
    patch(id, { fading: true })
    const t = setTimeout(() => removeJob(id), 380)
    timers.current.set(id, t)
  }, [patch, removeJob])

  // 완료 3초 뒤 자동 퇴장. 마우스를 올려두면 유지(열기 버튼 누를 시간 확보), 떼면 다시 3초.
  const armAutoHide = useCallback((id: string) => {
    const prev = timers.current.get(id)
    if (prev) clearTimeout(prev)
    const t = setTimeout(() => {
      if (hovered.current.has(id)) return
      fadeOut(id)
    }, 3000)
    timers.current.set(id, t)
  }, [fadeOut])

  const run = useCallback(async (id: string, input: GenJobInput) => {
    const ctrl = new AbortController()
    aborts.current.set(id, ctrl)
    try {
      // 영상 소재면 대본(나레이션) 먼저 확보 — 이미 추출돼 있으면 캐시라 즉시 반환, 실패해도 생성은 진행.
      if (input.isVideo) {
        try {
          await aiFetch(TRANSCRIPT_EP[input.source], {
            method: 'POST',
            signal: ctrl.signal,
            body: JSON.stringify({ library_id: input.refId, post_id: input.refId }),
          })
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return
        }
      }
      let resultId = ''
      if (input.kind === 'mindmap') {
        const res = await aiFetch('/api/ai/mindmap', {
          method: 'POST',
          signal: ctrl.signal,
          body: JSON.stringify({ library_id: input.refId, source: AI_SOURCE[input.source] }),
        })
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) throw new Error((j.error as string) || '생성에 실패했어요.')
        const mm = await createMindmap({
          client_id: input.clientId,
          library_id: input.refId,
          title: input.label,
          source_brand: input.brand ?? null,
          source_thumb: input.thumb ?? null,
          data: j.data as MindmapData,
        })
        resultId = mm.id
      } else {
        /* 컨텐츠 가이드 — 크롤러와 동일한 2단 전략:
           ① getFrames(브라우저 씬 프레임)가 있으면 장면별 "따로따로 병렬 생성"(동시 4개)
           ② 프레임이 없거나 실패하면 서버 프레임(≤5) 배치 폴백 */
        let scenes: CGScene[] = []
        let brandForData = ''
        if (input.getFrames) {
          patch(id, { progress: '프레임 추출 중' })
          let frames: string[] = []
          try { frames = await input.getFrames() } catch {}
          if (ctrl.signal.aborted) return
          if (frames.length) {
            const out: CGScene[] = new Array(frames.length)
            let idx = 0
            let doneCount = 0
            const worker = async () => {
              while (idx < frames.length) {
                if (ctrl.signal.aborted) return
                const i = idx++
                const img = frames[i]
                try {
                  const r = await aiFetch('/api/ai/content-guide', {
                    method: 'POST',
                    signal: ctrl.signal,
                    body: JSON.stringify({ library_id: input.refId, source: AI_SOURCE[input.source], image: img }),
                  })
                  const jj = (await r.json().catch(() => ({}))) as Record<string, unknown>
                  out[i] = { image: img, prompt: (jj.prompt as string) || '', description: (jj.description as string) || '', caution: (jj.caution as string) || '' }
                } catch {
                  out[i] = { image: img, prompt: '', description: '', caution: '' }
                }
                doneCount++
                patch(id, { progress: `장면 ${doneCount}/${frames.length}` })
              }
            }
            await Promise.all(Array.from({ length: Math.min(4, frames.length) }, () => worker()))
            if (ctrl.signal.aborted) return
            scenes = out
            brandForData = input.brand || ''
          }
          patch(id, { progress: undefined })
        }
        if (!scenes.length) {
          const res = await aiFetch('/api/ai/content-guide', {
            method: 'POST',
            signal: ctrl.signal,
            body: JSON.stringify({ library_id: input.refId, source: AI_SOURCE[input.source] }),
          })
          const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
          if (!res.ok) throw new Error((j.error as string) || '생성에 실패했어요.')
          scenes = (j.scenes as CGScene[]) || []
          brandForData = (j.brand as string) || input.brand || ''
          if (!scenes.length) throw new Error('장면을 만들지 못했어요. 다시 시도해 주세요.')
        }
        const cg = await createContentGuide({
          client_id: input.clientId,
          library_id: input.refId,
          title: input.label,
          source_brand: input.brand ?? null,
          source_thumb: input.thumb ?? null,
          data: { scenes, brand: brandForData },
        })
        resultId = cg.id
      }
      if (ctrl.signal.aborted) return // X 로 취소된 뒤 저장까지 온 경우 — 토스트는 이미 제거됨
      patch(id, { status: 'done', resultId, endedAt: Date.now() })
      armAutoHide(id)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      if (ctrl.signal.aborted) return
      patch(id, { status: 'error', error: e instanceof Error ? e.message : '오류가 발생했어요.', endedAt: Date.now() })
    } finally {
      aborts.current.delete(id)
    }
  }, [armAutoHide, patch])

  const start = useCallback((input: GenJobInput): 'started' | 'exists' => {
    const key = `${input.kind}:${input.source}:${input.refId}`
    const dup = jobsRef.current.find((j) => j.key === key && j.status === 'running' && !j.fading)
    if (dup) {
      // 이미 돌고 있으면 새로 안 만들고 기존 토스트를 반짝 강조(중복 생성·중복 과금 방지)
      setBumpId(dup.id)
      setTimeout(() => setBumpId((cur) => (cur === dup.id ? null : cur)), 1200)
      return 'exists'
    }
    const id = newId()
    setJobs((prev) => [...prev, {
      id,
      kind: input.kind,
      key,
      label: input.label,
      sub: input.sub,
      thumb: input.thumb ?? null,
      status: 'running',
      startedAt: Date.now(),
    }])
    void run(id, input)
    return 'started'
  }, [run])

  // 언마운트 시 타이머 정리(작업 fetch 는 페이지 전체가 닫힐 때만 끊긴다)
  useEffect(() => {
    const t = timers.current
    return () => { t.forEach(clearTimeout); t.clear() }
  }, [])

  const closeToast = (j: GenJob) => {
    if (j.status === 'running') aborts.current.get(j.id)?.abort() // 실행 중 X = 취소
    fadeOut(j.id)
  }

  const openResult = (j: GenJob) => {
    if (!j.resultId) return
    router.push(OPEN_PATH[j.kind](j.resultId))
    fadeOut(j.id)
  }

  const secs = (ms: number) => Math.max(1, Math.round(ms / 1000))

  return (
    <GenJobsContext.Provider value={{ start }}>
      {children}

      {/* 우측 하단 스택 — 모달(z-50)보다 위. 오래된 것이 위, 새 작업이 아래에 쌓인다. */}
      {jobs.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[324px] max-w-[calc(100vw-2rem)] flex-col">
          {jobs.map((j) => {
            const running = j.status === 'running'
            const done = j.status === 'done'
            const dur = secs((j.endedAt ?? Date.now()) - j.startedAt)
            const Icon = j.kind === 'mindmap' ? Network : Film
            return (
              <div
                key={j.id}
                className={`overflow-hidden transition-all duration-300 ease-out ${
                  j.fading ? 'mt-0 max-h-0 translate-x-4 opacity-0' : 'mt-2 max-h-40 translate-x-0 opacity-100'
                }`}
              >
                <div
                  onMouseEnter={() => {
                    hovered.current.add(j.id)
                    const t = timers.current.get(j.id)
                    if (t && j.status === 'done' && !j.fading) clearTimeout(t)
                  }}
                  onMouseLeave={() => {
                    hovered.current.delete(j.id)
                    if (j.status === 'done' && !j.fading) armAutoHide(j.id)
                  }}
                  title={running ? '생성 중 — 페이지를 이동해도 계속 돼요 (새로고침·탭 닫기는 끊겨요)' : undefined}
                  className={`pointer-events-auto rounded-xl border bg-white p-3 shadow-lg transition-shadow dark:bg-gray-900 ${
                    bumpId === j.id ? 'border-primary ring-2 ring-primary/60' : 'border-gray-200 dark:border-gray-700'
                  }`}
                  style={{ animation: 'genToastIn .25s ease-out' }}
                >
                  <div className="flex items-start gap-2.5">
                    {/* 썸네일(없으면 종류 아이콘) */}
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                      {j.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={j.thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
                          <ImageOff className="h-4 w-4" />
                        </div>
                      )}
                      <div className={`absolute -bottom-0.5 -right-0.5 rounded-md p-0.5 text-white ${done ? 'bg-emerald-500' : j.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}>
                        <Icon className="h-2.5 w-2.5" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold dark:text-gray-100">
                        {KIND_LABEL[j.kind]} — {j.label}
                      </p>
                      <p className={`mt-0.5 truncate text-[11px] ${j.status === 'error' ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                        {running
                          ? `생성 중… ${secs(Date.now() - j.startedAt)}초${j.progress ? ` · ${j.progress}` : ''}${j.sub ? ` · ${j.sub}` : ''}`
                          : done
                            ? `완료 · ${dur}초${j.sub ? ` · ${j.sub}` : ''}`
                            : j.error || '생성에 실패했어요.'}
                      </p>
                    </div>

                    {/* 상태 아이콘 + 닫기(실행 중엔 취소) */}
                    <div className="flex shrink-0 items-center gap-1">
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : j.status === 'error' ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : null}
                      <button
                        onClick={() => closeToast(j)}
                        title={running ? '생성 취소' : '닫기'}
                        className="rounded-md p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 진행바: 실행 중=파란 인디케이터 왕복 / 완료=초록 가득 / 실패=빨강 가득 */}
                  <div className={`mt-2 h-1 overflow-hidden rounded-full ${running ? 'bg-blue-100 dark:bg-blue-950/60' : done ? 'bg-emerald-500' : 'bg-red-400'}`}>
                    {running && <div className="h-full w-1/3 rounded-full bg-blue-500" style={{ animation: 'genBarSlide 1.15s ease-in-out infinite' }} />}
                  </div>

                  {done && (
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => openResult(j)}
                        className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                      >
                        열기 →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes genBarSlide { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
        @keyframes genToastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      `}</style>
    </GenJobsContext.Provider>
  )
}
