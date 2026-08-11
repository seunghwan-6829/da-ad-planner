import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveClubId, cafeArticleUrl } from '@/lib/naver/observe-rules'

/* 수집된 글 목록 조회(보호 라우트) — '글 수집 현황'의 하위 페이지들이 쓴다.
     GET ?verdict=keep         좋은 원고 모음
     GET ?verdict=ad,noise     걸러진 글(광고·잡글)
     GET ?verdict=all          전체 수집 로그
   공통 옵션: &cafe=<id|all> &q=<제목검색> &sort=recent|score|views|old &page=1 &limit=50

   ⚠️ 삭제 기능은 두지 않는다 — 광고로 걸러진 글도 '데이터로는 남겨야 한다'는 운영 원칙. */

export const dynamic = 'force-dynamic'

const VALID_VERDICTS = ['keep', 'drop', 'ad', 'noise', 'unrated', 'pending'] as const
const MAX_LIMIT = 100

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const verdictParam = (searchParams.get('verdict') || 'all').trim()
    const cafe = (searchParams.get('cafe') || 'all').trim()
    const q = (searchParams.get('q') || '').trim().slice(0, 80)
    const sort = (searchParams.get('sort') || 'recent').trim()
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(10, Number(searchParams.get('limit')) || 50))

    let query = supabaseAdmin.from('nc_cafe_posts').select('*', { count: 'exact' })

    // 판정 필터(쉼표로 여러 개). 'all' 이면 필터 없음.
    if (verdictParam && verdictParam !== 'all') {
      const list = verdictParam.split(',').map((v) => v.trim()).filter((v) => (VALID_VERDICTS as readonly string[]).includes(v))
      if (list.length === 1) query = query.eq('verdict', list[0])
      else if (list.length > 1) query = query.in('verdict', list)
    }
    if (cafe && cafe !== 'all') query = query.eq('cafe_id', cafe)
    /* 제목 검색 — 와일드카드 문자를 그대로 넘기면 "아무거나 매칭"이 된다.
       %,_,\ 는 LIKE 이스케이프하고, PostgREST 가 %로 바꾸는 * 는 아예 제거한다. */
    if (q) {
      const safe = q.replace(/\*/g, '').replace(/[%_\\]/g, (m) => `\\${m}`)
      if (safe) query = query.ilike('title', `%${safe}%`)
    }

    // 정렬 — 점수/증가폭은 아직 평가 전(null)이 뒤로 가게 한다.
    if (sort === 'score') query = query.order('score', { ascending: false, nullsFirst: false })
    else if (sort === 'views') query = query.order('views_delta', { ascending: false, nullsFirst: false })
    else if (sort === 'old') query = query.order('last_seen', { ascending: true })
    else query = query.order('last_seen', { ascending: false })

    const from = (page - 1) * limit
    const { data, count, error } = await query.range(from, from + limit - 1)
    if (error) {
      // 테이블/컬럼 미생성(마이그레이션 전)이면 빈 목록 + 안내
      return NextResponse.json({ ok: true, items: [], total: 0, page, limit, tableMissing: true })
    }

    // 카페 이름 + 원문 주소 조립용 클럽 ID(목록에서 어느 카페 글인지 보이고, 눌러서 원문을 열 수 있게)
    const { data: cafes } = await supabaseAdmin.from('nc_cafes').select('id, name, cafe_url, club_id')
    const nameOf = new Map<string, string>()
    const clubOf = new Map<string, string | null>()
    for (const c of (cafes ?? []) as { id: string; name: string; cafe_url: string | null; club_id: string | null }[]) {
      nameOf.set(String(c.id), String(c.name ?? ''))
      clubOf.set(String(c.id), resolveClubId(c.cafe_url, c.club_id))
    }

    const items = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      cafe_id: String(r.cafe_id ?? ''),
      cafe_name: nameOf.get(String(r.cafe_id ?? '')) ?? '(삭제된 발행처)',
      url: cafeArticleUrl(clubOf.get(String(r.cafe_id ?? '')) ?? null, r.article_id ? String(r.article_id) : null),
      title: String(r.title ?? ''),
      verdict: String(r.verdict ?? 'pending'),
      verdict_reason: r.verdict_reason ? String(r.verdict_reason) : null,
      views: typeof r.views === 'number' ? r.views : null,
      comments: typeof r.comments === 'number' ? r.comments : null,
      views_delta: typeof r.views_delta === 'number' ? r.views_delta : null,
      comments_delta: typeof r.comments_delta === 'number' ? r.comments_delta : null,
      score: typeof r.score === 'number' ? r.score : null,
      is_popular: r.is_popular === true,
      first_seen: String(r.first_seen ?? r.last_seen ?? ''),
      last_seen: String(r.last_seen ?? r.first_seen ?? ''),
      evaluated_at: r.evaluated_at ? String(r.evaluated_at) : null,
    }))

    return NextResponse.json({ ok: true, items, total: count ?? items.length, page, limit })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : '조회 실패' }, { status: 500 })
  }
}
