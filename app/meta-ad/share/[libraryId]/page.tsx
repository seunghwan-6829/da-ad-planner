'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Analysis = {
  summary?: string
  target?: string
  offer?: string
  strengths?: string[]
  phases?: { name?: string; weight?: number; desc?: string }[]
  segments?: { name?: string; t?: number; good?: string; bad?: string }[]
  markers?: { t?: number; label?: string; note?: string }[]
  userMarkers?: { t?: number; note?: string }[]
}

type PublicAd = {
  library_id: string
  brand: string | null
  page_name: string | null
  country: string | null
  started_on: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  ad_text: string | null
  media_type: string | null
  media_url: string | null
  media_urls: string[] | null
  poster_url: string | null
  landing_url: string | null
  status: string | null
  ai_analysis: string | null
  transcript: string | null
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function parseAnalysis(raw: string | null): Analysis | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? (o as Analysis) : null
  } catch {
    return null
  }
}

export default function PublicAdSharePage() {
  const params = useParams<{ libraryId: string }>()
  const libraryId = params?.libraryId
  const [ad, setAd] = useState<PublicAd | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (!libraryId) return
    let alive = true
    fetch(`/api/meta-ad/public/${libraryId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('nf')
        return r.json()
      })
      .then((d) => {
        if (alive) {
          setAd(d)
          setState('ready')
        }
      })
      .catch(() => {
        if (alive) setState('notfound')
      })
    return () => {
      alive = false
    }
  }, [libraryId])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
        불러오는 중…
      </div>
    )
  }

  if (state === 'notfound' || !ad) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="text-base font-bold text-gray-800">광고를 찾을 수 없어요</div>
          <p className="mt-1.5 text-sm text-gray-500">링크가 만료되었거나 삭제된 소재일 수 있습니다.</p>
        </div>
      </div>
    )
  }

  const brand = ad.brand || ad.page_name || '광고'
  const ended = ad.status === 'ended'
  const urls =
    ad.media_urls && ad.media_urls.length > 0
      ? ad.media_urls
      : ad.media_url
        ? [ad.media_url]
        : []
  const typeLabel = ad.media_type === 'video' ? '영상' : ad.media_type === 'carousel' ? '슬라이드' : '이미지'
  const sourceUrl = `https://www.facebook.com/ads/library/?id=${ad.library_id}`
  const analysis = parseAnalysis(ad.ai_analysis)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-6 sm:py-10">
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">
            {brand.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-gray-900">{brand}</div>
            <div className="flex items-center gap-1 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${ended ? 'bg-gray-400' : 'bg-green-500'}`} />
              <span className={ended ? 'text-gray-400' : 'text-green-600'}>{ended ? '종료됨' : '활성'}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">{typeLabel}</span>
            </div>
          </div>
        </div>

        {/* 미디어 */}
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-2xl bg-black shadow-sm">
          {ad.media_type === 'video' && ad.media_url ? (
            <video
              src={ad.media_url}
              poster={ad.poster_url || undefined}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-black object-contain"
            />
          ) : urls.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[idx]} alt="" className="h-full w-full bg-black object-contain" />
              {urls.length > 1 && (
                <>
                  <button
                    onClick={() => setIdx((i) => (i - 1 + urls.length) % urls.length)}
                    className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                    aria-label="이전"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => setIdx((i) => (i + 1) % urls.length)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                    aria-label="다음"
                  >
                    ›
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">
                    {idx + 1} / {urls.length}
                  </span>
                </>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">미디어 없음</div>
          )}
        </div>

        {/* 캡션 (T&D) */}
        {ad.ad_text && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">제목 · 캡션</div>
            <p className="whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-relaxed text-gray-700 shadow-sm">
              {ad.ad_text}
            </p>
          </div>
        )}

        {/* 대본 (나레이션) */}
        {ad.transcript && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">🎙️ 나레이션 대본</div>
            <p className="whitespace-pre-wrap rounded-xl border border-violet-100 bg-violet-50/60 p-4 text-sm leading-relaxed text-gray-700 shadow-sm">
              {ad.transcript}
            </p>
          </div>
        )}

        {/* AI 분석 */}
        {analysis && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">✨ AI 소재 분석</div>
            <div className="space-y-3 rounded-xl border border-violet-100 bg-white p-4 text-sm shadow-sm">
              {analysis.summary && (
                <p className="rounded-lg bg-violet-50 p-3 font-medium leading-relaxed text-violet-900">
                  {analysis.summary}
                </p>
              )}
              {(analysis.target || analysis.offer) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {analysis.target && (
                    <div className="rounded-lg bg-gray-50 p-2.5">
                      <div className="text-[11px] font-bold text-gray-400">추정 타겟</div>
                      <div className="text-gray-700">{analysis.target}</div>
                    </div>
                  )}
                  {analysis.offer && (
                    <div className="rounded-lg bg-gray-50 p-2.5">
                      <div className="text-[11px] font-bold text-gray-400">핵심 오퍼/소구점</div>
                      <div className="text-gray-700">{analysis.offer}</div>
                    </div>
                  )}
                </div>
              )}
              {Array.isArray(analysis.strengths) && analysis.strengths.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-gray-400">잘된 점</div>
                  <ul className="space-y-1">
                    {analysis.strengths.map((s, i) => (
                      <li key={i} className="flex gap-1.5 text-gray-700">
                        <span className="text-green-500">✓</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(analysis.phases) && analysis.phases.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-gray-400">소재 흐름</div>
                  <ul className="space-y-1">
                    {analysis.phases.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-gray-700">
                        <span className="font-semibold text-gray-900">{p.name}</span>
                        {typeof p.weight === 'number' && (
                          <span className="text-[11px] text-gray-400">({p.weight}%)</span>
                        )}
                        {p.desc && <span className="text-gray-500">— {p.desc}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(analysis.segments) && analysis.segments.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-gray-400">구간별 코멘트</div>
                  <ul className="space-y-1.5">
                    {analysis.segments.map((s, i) => (
                      <li key={i} className="rounded-lg bg-gray-50 p-2.5">
                        <div className="font-semibold text-gray-900">{s.name}</div>
                        {s.good && <div className="text-green-700">✓ {s.good}</div>}
                        {s.bad && <div className="text-amber-700">△ {s.bad}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(analysis.markers) && analysis.markers.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-gray-400">잘된 지점</div>
                  <ul className="space-y-1">
                    {analysis.markers.map((m, i) => (
                      <li key={i} className="text-gray-700">
                        <span className="font-semibold text-violet-700">{m.label}</span>
                        {m.note && <span className="text-gray-500"> — {m.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(analysis.userMarkers) && analysis.userMarkers.filter((m) => m.note).length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-gray-400">직접 표시한 구간</div>
                  <ul className="space-y-1">
                    {analysis.userMarkers
                      .filter((m) => m.note)
                      .map((m, i) => (
                        <li key={i} className="text-gray-700">
                          {typeof m.t === 'number' && (
                            <span className="mr-1 rounded bg-gray-100 px-1 text-[11px] font-bold text-gray-500">
                              {m.t}%
                            </span>
                          )}
                          {m.note}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 메타데이터 */}
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">메타데이터</div>
          <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
            <Meta k="시작일" v={ad.started_on ?? '—'} />
            <Meta k="최초 수집" v={fmtDate(ad.first_seen_at)} />
            <Meta k="최근 확인" v={fmtDate(ad.last_seen_at)} />
            <Meta k="국가" v={ad.country ?? '—'} />
            <Meta k="상태" v={ended ? '종료' : '활성'} />
            <Meta k="유형" v={typeLabel} />
            <Meta k="Library ID" v={ad.library_id} />
          </dl>
        </div>

        {/* 링크 */}
        <div className="mt-4 space-y-2.5 rounded-xl bg-white p-4 text-sm shadow-sm">
          <div>
            <div className="text-[11px] font-bold text-gray-400">Source (광고 라이브러리)</div>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 underline">
              {sourceUrl}
            </a>
          </div>
          <div>
            <div className="text-[11px] font-bold text-gray-400">랜딩 페이지</div>
            {ad.landing_url ? (
              <a href={ad.landing_url} target="_blank" rel="noopener noreferrer" className="block truncate text-blue-600 underline">
                {ad.landing_url}
              </a>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
          {ad.landing_url && (
            <a
              href={ad.landing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block rounded-lg bg-gray-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-700"
            >
              랜딩 페이지 열기 ↗
            </a>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-300">컨텐츠 디벨로퍼 · 광고 소재 공유</p>
      </div>
    </div>
  )
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400">{k}</dt>
      <dd className="break-all font-medium text-gray-800">{v}</dd>
    </div>
  )
}
