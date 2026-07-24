import { supabaseAdmin } from '@/lib/supabase-admin'

/* 중복 발행 방지.
   자동 초안이 하루에도 여러 건 만들어지다 보니 "상세페이지 ○○ 바꿨더니 전환율 △△%" 처럼
   주제가 겹치는 글이 쌓인다. 같은 카페에 비슷한 글이 연달아 올라가면 사람 눈에도 티가 나고
   카페에서 도배로 볼 위험도 있다. 그래서 발행 직전에 최근 글과 비교해 너무 비슷하면 보류한다. */

/** 제목을 비교용으로 정규화 — 조사·공백·기호·숫자를 걷어내고 의미 있는 토큰만 남긴다. */
function tokens(title: string): Set<string> {
  const cleaned = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // 기호 제거
    .replace(/\d+/g, ' ') // 숫자(전환율 23% 같은 것)는 주제가 아니라 변주라 제외
    .replace(/\s+/g, ' ')
    .trim()
  const stop = new Set(['그리고', '하는', '했다', '합니다', '이유', '얘기', '이야기', '방법', '정도', '그냥', '진짜'])
  return new Set(
    cleaned
      .split(' ')
      .map((w) => w.replace(/(으로|에서|에게|까지|부터|이라|라고|하고|이나|하다|한다|했던|하면|해서|들이|들을|이는|은는|를|을|이|가|는|은|의|에|도|만)$/u, ''))
      .filter((w) => w.length >= 2 && !stop.has(w))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/** 글자 2-그램 집합 — 공백·기호·감정표기(ㅠㅜㅋㅎ)를 걷어낸 글자열 기준.
   토큰(의미)만 보면 "어디" vs "어디다", "맡기세요" vs "맡기세요ㅠ" 를 다른 걸로 놓쳐서,
   거의 똑같은 제목(문구만 살짝 다른 것)을 못 잡는다 — 글자 단위로 이를 보완한다. */
function charBigrams(s: string): Set<string> {
  const n = String(s || '').toLowerCase().replace(/[ㅠㅜㅋㅎ]/g, '').replace(/[^\p{L}\p{N}]/gu, '')
  const set = new Set<string>()
  if (n.length === 1) set.add(n)
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2))
  return set
}

/** 두 제목의 유사도(0~1). "의미(토큰) 유사"와 "문구(글자) 유사" 중 큰 값 —
   같은 주제(토큰)든 거의 같은 문구(글자)든 어느 쪽으로 겹쳐도 중복으로 본다. */
export function titleSimilarity(a: string, b: string): number {
  return Math.max(jaccard(tokens(a), tokens(b)), jaccard(charBigrams(a), charBigrams(b)))
}

export type DupHit = { title: string; published_at: string | null; similarity: number }

/**
 * 같은 카페에 최근 windowDays 안에 비슷한 제목이 이미 발행됐는지 확인.
 * 비슷한 게 있으면 그중 가장 비슷한 것을 돌려준다(없으면 null).
 */
export async function findRecentDuplicate(
  cafeId: string,
  title: string,
  windowDays: number,
  threshold: number,
  excludeId?: string
): Promise<DupHit | null> {
  if (!title?.trim() || !cafeId || windowDays <= 0) return null
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString()

  let q = supabaseAdmin
    .from('nc_posts')
    .select('id, title, published_at')
    .eq('cafe_id', cafeId)
    .eq('status', 'published')
    .gte('published_at', since)
    .limit(100)
  if (excludeId) q = q.neq('id', excludeId)

  const { data } = await q
  let best: DupHit | null = null
  for (const row of data || []) {
    const s = titleSimilarity(title, row.title || '')
    if (s >= threshold && (!best || s > best.similarity)) {
      best = { title: row.title || '', published_at: row.published_at, similarity: s }
    }
  }
  return best
}
