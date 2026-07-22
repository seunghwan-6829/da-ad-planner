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

  /* ?dry=1 — 점검 전용 시뮬레이션.
     "지금 발행하면 어떤 글이 어느 카페로 나가는지"만 계산해서 돌려준다.
     ⚠️ 이 모드는 DB 를 절대 바꾸지 않는다 — 잠금(publishing)도, 간격 예약도, 반려도 하지 않는다.
     승인된 글이 없으면 최신 초안 1건으로 대신 계산해(simulated) 경로 검증을 할 수 있게 한다. */
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const note = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail })

  // 1) 발행할 승인 항목(오래된 순). not_before 는 JS 에서 필터(PostgREST .or() 의 dot 파싱 이슈 회피).
  const { data: cands } = await supabaseAdmin
    .from('nc_posts')
    .select('*, nc_cafes(*)')
    .in('status', ['approved', 'queued']) // queued = v2 호환(승인과 동일 취급)
    .order('created_at', { ascending: true })
    .limit(50)
  const ready = (cands || []).filter((r) => {
    const nb = (r as { not_before?: string | null }).not_before
    const ms = nb ? Date.parse(nb) : NaN
    return Number.isNaN(ms) || ms <= nowMs
  })
  // '지금 바로 발행'으로 찍힌 글이 있으면 그것부터. (페이스 게이트도 이 건만 건너뛴다)
  let item = ready.find((r) => (r as { force_publish?: boolean }).force_publish === true) || ready[0]

  let simulated = false
  if (!item && dry) {
    // 승인된 글이 없어도 경로를 점검할 수 있게 최신 초안으로 대신 계산한다(발행 대상 아님).
    const { data: drafts } = await supabaseAdmin
      .from('nc_posts')
      .select('*, nc_cafes(*)')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
    item = drafts?.[0]
    simulated = !!item
    note('승인된 글', false, '승인 대기 0건 — 최신 초안으로 대신 점검합니다(실제 발행 대상 아님)')
  } else if (item) {
    note('승인된 글', true, `${(cands || []).length}건 중 가장 오래된 건부터 발행`)
  }

  if (!item) {
    if (dry) return NextResponse.json({ dry: true, none: true, reason: '승인된 글도 초안도 없습니다', checks })
    return NextResponse.json({ none: true, reason: '발행할 승인 항목이 없습니다' })
  }
  if (!dry && simulated) return NextResponse.json({ none: true, reason: '발행할 승인 항목이 없습니다' })

  const cafe = (item as { nc_cafes?: Record<string, unknown> }).nc_cafes
  if (!cafe) {
    if (dry) {
      note('발행처 연결', false, '이 글에 연결된 카페 설정이 없습니다(실제 배정 시 반려됨)')
      return NextResponse.json({ dry: true, simulated, none: true, reason: '카페 설정 없음', checks })
    }
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: '카페 설정 없음', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '카페 설정 없음' })
  }
  note('발행처 연결', true, String(cafe.name || ''))

  // 2) 페이스 게이트(활동시간·일/주 상한·랜덤 간격)
  const { pacing } = await getNaverSettings()
  const kind: 'post' | 'comment' = item.kind === 'comment' ? 'comment' : 'post'
  // 발행 미허용 발행처면 반려(헤드블록 방지)
  const notAllowed = (kind === 'post' && cafe.allow_post === false) || (kind === 'comment' && cafe.allow_comment === false)
  if (notAllowed) {
    if (dry) {
      note('발행 허용', false, kind === 'post' ? '이 발행처는 글 발행이 꺼져 있습니다' : '이 발행처는 댓글이 꺼져 있습니다')
      return NextResponse.json({ dry: true, simulated, none: true, reason: '발행 미허용', checks })
    }
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: kind === 'post' ? '글 발행 미허용' : '댓글 미허용', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '발행 미허용' })
  }
  note('발행 허용', true, kind === 'post' ? '글 발행 켜짐' : '댓글 켜짐')

  /* 페이스 게이트. '지금 바로 발행'(force_publish)로 찍힌 글은 이 게이트를 건너뛴다.
     ⚠️ 계정 보호 장치를 일부러 우회하는 것이라, 화면에서 경고하고 발행 후 자동으로 해제한다. */
  const forced = (item as { force_publish?: boolean }).force_publish === true
  const gate = forced ? { ok: true, reason: '' } : await canAct(kind, item.cafe_id, pacing, nowMs)
  // 점검 모드에서는 게이트가 닫혀 있어도 멈추지 않고, 왜 닫혔는지 알려준 뒤 나머지도 계속 본다.
  if (dry) note('페이스 게이트(계정 밴 방지)', gate.ok, forced ? '지금 바로 발행 지정 — 페이스 규칙을 건너뜁니다' : gate.ok ? '지금 발행 가능한 시간대·한도입니다' : String(gate.reason || ''))
  else if (!gate.ok) return NextResponse.json({ none: true, reason: gate.reason })

  // 3) 말머리 검증(post)
  const prefixMissing = kind === 'post' && !!cafe.require_prefix && !cafe.prefix
  if (prefixMissing) {
    if (dry) {
      note('말머리', false, '말머리가 필수인데 설정돼 있지 않습니다(실제 배정 시 반려됨)')
      return NextResponse.json({ dry: true, simulated, none: true, reason: '말머리 미설정', checks })
    }
    await supabaseAdmin.from('nc_posts').update({ status: 'rejected', note: '말머리 미설정', updated_at: nowISO }).eq('id', item.id)
    return NextResponse.json({ none: true, reason: '말머리 미설정' })
  }
  if (dry) note('말머리', true, cafe.require_prefix ? `필수 · "${cafe.prefix}"` : '필요 없음')

  // 4) 낙관적 잠금: approved/queued → publishing. 경합(0행)이면 none.
  //    ⚠️ 점검 모드는 여기부터 전부 건너뛴다 — 잠금·간격예약 같은 상태 변경을 하지 않는다.
  if (!dry) {
    // 배정과 동시에 force_publish 를 내린다 — '지금 바로 발행'은 1회용이라 재시도까지 게이트를 뚫으면 안 된다.
    const lockPatch: Record<string, unknown> = { status: 'publishing', updated_at: nowISO, force_publish: false }
    let lockRes = await supabaseAdmin.from('nc_posts').update(lockPatch).eq('id', item.id).in('status', ['approved', 'queued']).select('id')
    if (lockRes.error && /force_publish/.test(lockRes.error.message)) {
      delete lockPatch.force_publish // 컬럼 미존재(마이그레이션 전) 폴백
      lockRes = await supabaseAdmin.from('nc_posts').update(lockPatch).eq('id', item.id).in('status', ['approved', 'queued']).select('id')
    }
    if (!lockRes.data?.length) return NextResponse.json({ none: true, reason: '다른 작업이 선점됨' })

    // 배정 즉시 다음 동작 간격 예약(페이스 예약) — 발행 실패/동시 폴링에도 상한·간격이 유지되게.
    await scheduleNext(pacing)
  }

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

  const job = {
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
  }

  if (dry) {
    // 워커가 실제로 열게 될 글쓰기 주소를 미리 계산해 보여준다(카페 URL 파싱까지 검증됨).
    const m = String(cafe.cafe_url || '').match(/cafe\.naver\.com\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)(?:\/menus\/(\d+))?/i)
    const clubId = (cafe.club_id as string) || m?.[1] || ''
    const menuId = (cafe.board_id as string) || m?.[2] || ''
    note('카페 주소 해석', !!clubId, clubId ? `클럽 ${clubId}${menuId ? ` · 게시판 ${menuId}` : ' · 게시판 미지정(기본 게시판)'}` : `club_id 도 cafe_url 도 못 읽음 (${cafe.cafe_url || '주소 없음'})`)
    note('본문 준비', !!job.title && !!job.body, `제목 ${job.title.length}자 · 본문 ${job.body.length}자`)
    return NextResponse.json({
      dry: true,
      simulated,
      checks,
      writeUrl: clubId ? `https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/write?boardType=L${menuId ? `&menuId=${menuId}` : ''}` : null,
      job,
    })
  }

  return NextResponse.json({ job })
}
