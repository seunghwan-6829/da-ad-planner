import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* 체험 계정(1일/7일) 발급·조회·회수 — 관리자 전용.
   ⚠️ 관리자 확인은 middleware.ts 가 /api/admin/* 전체에 대해 먼저 수행한다.
      (체험 계정·비로그인은 여기 도달하지 못한다)

   비밀번호는 서버가 만들어 "응답에서 한 번만" 돌려준다. DB 에는 Supabase 가 해시로만 보관하므로
   나중에 다시 볼 수 없다 — 화면에서 복사해 전달해야 한다. */

const DEFAULT_DOMAIN = process.env.TRIAL_EMAIL_DOMAIN || 'trial.contents-developer.kr'

// 사람이 불러주기 쉬운 문자만 사용(0/O, 1/l 같은 헷갈리는 글자 제외)
const SAFE = 'abcdefghjkmnpqrstuvwxyz23456789'
const PW_SAFE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function pick(pool: string, n: number) {
  const buf = new Uint32Array(n)
  crypto.getRandomValues(buf)
  return Array.from(buf, (v) => pool[v % pool.length]).join('')
}

export async function GET() {
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 })
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, name, trial_label, trial_expires_at, created_at')
    .eq('role', 'trial')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = Date.now()
  const accounts = (data || []).map((a) => {
    const endsAt = a.trial_expires_at ? Date.parse(a.trial_expires_at) : 0
    return { ...a, expired: !!endsAt && endsAt <= now, hours_left: endsAt ? Math.max(0, Math.round((endsAt - now) / 3600000)) : null }
  })
  return NextResponse.json({ accounts })
}

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 })
  const body = await req.json().catch(() => ({}))
  const days = Number(body.days)
  if (![1, 7].includes(days)) return NextResponse.json({ error: '기간은 1일 또는 7일만 가능합니다.' }, { status: 400 })
  const label = String(body.label || '').trim().slice(0, 60)

  const email = `che-${pick(SAFE, 6)}@${DEFAULT_DOMAIN}`
  const password = `${pick(PW_SAFE, 10)}${pick('23456789', 2)}`
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString()

  // 1) 인증 계정 생성 (메일 발송 없이 바로 사용 가능)
  const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: label || `체험 ${days}일` },
  })
  if (cErr || !created?.user) {
    return NextResponse.json({ error: `계정 생성 실패: ${cErr?.message || '알 수 없음'}` }, { status: 500 })
  }

  // 2) 프로필에 역할·만료 기록. 실패하면 방금 만든 인증 계정을 되돌린다(권한 없는 계정이 남지 않게).
  const { error: pErr } = await supabaseAdmin.from('user_profiles').upsert(
    {
      id: created.user.id,
      email,
      name: label || `체험 ${days}일`,
      role: 'trial',
      trial_expires_at: expiresAt,
      trial_label: label || null,
    },
    { onConflict: 'id' }
  )
  if (pErr) {
    try { await supabaseAdmin.auth.admin.deleteUser(created.user.id) } catch {}
    return NextResponse.json({ error: `권한 설정 실패(계정 생성 취소됨): ${pErr.message}` }, { status: 500 })
  }

  // 비밀번호는 이 응답이 유일한 전달 기회다.
  return NextResponse.json({ ok: true, account: { id: created.user.id, email, password, days, expires_at: expiresAt, label } })
}

export async function DELETE(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  // 체험 계정만 지울 수 있게 확인 — 실수로 정식 계정을 지우는 사고 방지.
  const { data: target } = await supabaseAdmin.from('user_profiles').select('id, role').eq('id', id).maybeSingle()
  if (!target) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 })
  if (target.role !== 'trial') return NextResponse.json({ error: '체험 계정이 아닙니다.' }, { status: 400 })

  try { await supabaseAdmin.auth.admin.deleteUser(id) } catch {}
  await supabaseAdmin.from('user_profiles').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
