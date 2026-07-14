// 스크랩 viral 판정(원본 scoring.py::summarize_scraps 포팅).
// threads_topic: 반복 노출/최고 순위로 점수·hot. css: 시간당 조회 증가(views_per_hour) 상위 25%가 hot.

export interface Scrap {
  key: string
  brand_id: string
  category_id: string | null
  source_type: string // 'threads_topic' | 'css'
  title: string
  url: string
  author: string
  first_seen: string
}
export interface ScrapMetric {
  scrap_key: string
  ts: string
  rank?: number | null
  views?: number | null
  likes?: number | null
  comments?: number | null
}
export interface ScoredScrap extends Scrap {
  age_hours: number
  judgeable: boolean
  snapshots: number
  hot: boolean
  score: number
  signal: string
  best_rank?: number | null
  top_appearances?: number
  views?: number | null
  likes?: number | null
  comments?: number | null
  views_per_hour?: number | null
}

export const JUDGE_AFTER_HOURS = 12

function hoursBetween(aISO: string, bISO: string): number {
  return Math.abs(Date.parse(bISO) - Date.parse(aISO)) / 3600_000
}

export function summarizeScraps(scraps: Scrap[], metrics: ScrapMetric[], nowMs: number = Date.now()): ScoredScrap[] {
  const byKey = new Map<string, ScrapMetric[]>()
  for (const m of metrics) {
    const arr = byKey.get(m.scrap_key) || []
    arr.push(m)
    byKey.set(m.scrap_key, arr)
  }

  // 1차: css vph 계산 + 그룹별 분포 수집
  const vphByKey = new Map<string, number>()
  const groupVph = new Map<string, number[]>() // `${brand}|${cat}` → vph[]
  for (const s of scraps) {
    if (s.source_type !== 'css') continue
    const snaps = (byKey.get(s.key) || []).slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    if (snaps.length < 1) continue
    const latest = snaps[snaps.length - 1]
    const first = snaps[0]
    const dv = (latest.views ?? 0) - (first.views ?? 0)
    const dh = Math.max(0.5, hoursBetween(first.ts, latest.ts))
    const vph = dv / dh
    vphByKey.set(s.key, vph)
    if (vph > 0) {
      const g = `${s.brand_id}|${s.category_id || ''}`
      const arr = groupVph.get(g) || []
      arr.push(vph)
      groupVph.set(g, arr)
    }
  }
  // 그룹별 상위 25% 임계(75퍼센타일)
  const groupThreshold = new Map<string, number>()
  for (const [g, arr] of groupVph) {
    const sorted = arr.slice().sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.75)
    groupThreshold.set(g, sorted[Math.min(idx, sorted.length - 1)])
  }

  const out: ScoredScrap[] = scraps.map((s) => {
    const snaps = byKey.get(s.key) || []
    const ageHours = (nowMs - Date.parse(s.first_seen)) / 3600_000
    const judgeable = ageHours >= JUDGE_AFTER_HOURS
    const base: ScoredScrap = { ...s, age_hours: Math.round(ageHours * 10) / 10, judgeable, snapshots: snaps.length, hot: false, score: 0, signal: '' }

    if (s.source_type === 'threads_topic') {
      const ranks = snaps.map((m) => m.rank).filter((r): r is number => r != null && Number.isFinite(r))
      const topAppearances = ranks.length
      const bestRank = ranks.length ? Math.min(...ranks) : 999
      base.top_appearances = topAppearances
      base.best_rank = ranks.length ? bestRank : null
      base.score = topAppearances * 10 + (25 - bestRank)
      base.hot = judgeable && (topAppearances >= 2 || bestRank <= 5)
      base.signal = ranks.length ? `TOP ${topAppearances}회 노출 (최고 ${bestRank}위)` : '노출 기록 없음'
    } else {
      const sorted = snaps.slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      const latest = sorted[sorted.length - 1]
      const vph = vphByKey.get(s.key) ?? 0
      base.views = latest?.views ?? null
      base.likes = latest?.likes ?? null
      base.comments = latest?.comments ?? null
      base.views_per_hour = Math.round(vph * 10) / 10
      base.score = vph
      const g = `${s.brand_id}|${s.category_id || ''}`
      const thr = groupThreshold.get(g) ?? Infinity
      base.hot = judgeable && vph > 0 && vph >= thr
      base.signal = `${base.views_per_hour} views/hour` + (base.views != null ? ` · 조회 ${base.views.toLocaleString()}` : '')
    }
    return base
  })

  out.sort((a, b) => (Number(b.hot) - Number(a.hot)) || (b.score - a.score))
  return out
}
