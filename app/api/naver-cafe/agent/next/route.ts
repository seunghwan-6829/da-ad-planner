import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { canAct, scheduleNext } from '@/lib/naver/pacing'

export const dynamic = 'force-dynamic'

// 로컬 발행 에이전트가 폴링하는 "다음 작업" 엔드포인트(리뉴얼 server.api_agent_next 포팅).
// 서버가 페이스(계정 밴 방지) 게이트를 걸고, 통과한 작업만 손(에이전트)에게 넘긴다.
//   응답: {none:true, reason} | {job:{...}}
//   계약 필드명은 원본(publisher.py/agent 소비자)과 호환되게 그대로 유지.
//
// ⚠️ publishing 항목의 자동 회수(approved 복귀)는 하지 않는다 —
//    발행됐지만 결과 보고만 실패한 항목을 재배정하면 '이중 발행'이 되어 계정 밴 위험.
//    크래시로 멈춘 publishing 은 웹에서 사람이 확인 후 수동 복귀(대기 취소)한다.

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true // 토큰 미설정(로컬) → 개방
  return req.headers.get('x-agent-token') === need
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const nowISO = new Date().toISOString()
  const nowMs = Date.now()

  // 1) 발행할 승인 항목(오래된 순). not_before 는 JS 에서 필터(PostgREST .or() 의 dot 파싱 이슈 회피).
  const { data: cands } = await supabaseAdmin
    .from('nc_posts')
    .select('*, nc_cafes(*)')
    .in('status', ['approved', 'queued']) // queued = v2 호환(승인과 동일 취급)
    .order('created_at', { ascending: true })
    .limit(50)
  const item = (cands || []).find((r) => {
    const nb = (r as { not_before?: string | null }).not_before
    const ms = nb ? Date.parse(nb) : NaN
    return Number.isNaN(ms) || ms <= nowMs
  })
  if (!item) return NextResponse.json({ none: true, reason: '발행할 승인 항목이 없습니다' })

  const cafe = (item as { nc_cafes?: Record<string, unknown> }).nc_cafes
  if (!cafe) {
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: '카페 설정 없음', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '카페 설정 없음' })
  }

  // 2) 페이스 게이트(활동시간·일/주 상한·랜덤 간격)
  const { pacing } = await getNaverSettings()
  const kind: 'post' | 'comment' = item.kind === 'comment' ? 'comment' : 'post'
  // 발행 미허용 발행처면 반려(헤드블록 방지)
  if ((kind === 'post' && cafe.allow_post === false) || (kind === 'comment' && cafe.allow_comment === false)) {
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: kind === 'post' ? '글 발행 미허용' : '댓글 미허용', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '발행 미허용' })
  }
  const gate = await canAct(kind, item.cafe_id, pacing, nowMs)
  if (!gate.ok) return NextResponse.json({ none: true, reason: gate.reason })

  // 3) 말머리 검증(post)
  if (kind === 'post' && cafe.require_prefix && !cafe.prefix) {
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: '말머리 미설정', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '말머리 미설정' })
  }

  // 4) 낙관적 잠금: approved/queued → publishing. 경합(0행)이면 none.
  const { data: locked } = await supabaseAdmin
    .from('nc_posts')
    .update({ status: 'publishing', updated_at: nowISO })
    .eq('id', item.id)
    .in('status', ['approved', 'queued'])
    .select('id')
  if (!locked?.length) return NextResponse.json({ none: true, reason: '다른 작업이 선점됨' })

  // 배정 즉시 다음 동작 간격 예약(페이스 예약) — 발행 실패/동시 폴링에도 상한·간격이 유지되게.
  await scheduleNext(pacing)

  // 5) job 구성(계약 필드명 원본 유지)
  const emphasis = Array.isArray(cafe.emphasis) ? cafe.emphasis : []
  const board =
    kind === 'post'
      ? {
          id: (cafe.board_id as string) || '',
          name: (cafe.board_name as string) || '',
          list_url: (cafe.list_url as string) || '',
          require_prefix: !!cafe.require_prefix,
          prefix: (cafe.prefix as string) || '',
          allow_post: cafe.allow_post !== false,
          allow_comment: cafe.allow_comment !== false,
          emphasis,
        }
      : null

  return NextResponse.json({
    job: {
      id: item.id,
      kind,
      cafe_id: item.cafe_id,
      board_id: (cafe.board_id as string) || '',
      title: item.title || '',
      body: item.body || '',
      source_url: item.source_url || null,
      mode: 'dom',
      cafe: { club_id: (cafe.club_id as string) || '', name: (cafe.name as string) || '', url: (cafe.cafe_url as string) || '' },
      board,
      prefix: kind === 'post' && cafe.require_prefix ? ((cafe.prefix as string) || '') : '',
    },
  })
}
