import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
// 영상 다운로드 + 전사(STT)는 시간이 걸리므로 함수 타임아웃을 늘린다.
export const maxDuration = 60

const OPENAI_STT_URL = 'https://api.openai.com/v1/audio/transcriptions'

// 영상 소재의 나레이션을 텍스트로 받아쓰기(리메이크용 대본).
// 사용자 OpenAI 키(x-user-openai-key)로 Whisper 호출. 결과는 am_ads.transcript 에 캐시.
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-openai-key') || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API 키가 없습니다. 마이페이지에서 OpenAI 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const libraryId = (body.library_id || '').toString().trim()
  const force = !!body.force
  if (!libraryId) {
    return NextResponse.json({ error: 'library_id 가 필요합니다.' }, { status: 400 })
  }

  const { data: ad, error } = await supabaseAdmin
    .from('am_ads')
    .select('library_id, media_type, media_url, transcript')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) {
    return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })
  }

  // 이미 받아쓴 대본이 있으면 그대로(재요청 비용 절약). force=true 면 다시 전사.
  if (ad.transcript && !force) {
    return NextResponse.json({ transcript: ad.transcript, cached: true })
  }

  if (ad.media_type !== 'video' || !ad.media_url) {
    return NextResponse.json(
      { error: '영상 소재만 대본(나레이션)을 추출할 수 있어요.' },
      { status: 400 }
    )
  }

  // 영상 다운로드
  let videoBuf: Buffer
  try {
    const vr = await fetch(ad.media_url)
    if (!vr.ok) throw new Error(`status ${vr.status}`)
    videoBuf = Buffer.from(await vr.arrayBuffer())
  } catch {
    return NextResponse.json({ error: '영상을 불러오지 못했어요.' }, { status: 502 })
  }

  // Whisper 업로드 한도(25MB)
  if (videoBuf.byteLength > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: '영상이 너무 커서(25MB 이상) 대본 추출이 어려워요.' },
      { status: 413 }
    )
  }

  // OpenAI 전사
  let transcript = ''
  try {
    const form = new FormData()
    form.append('file', new Blob([videoBuf], { type: 'video/mp4' }), `${libraryId}.mp4`)
    form.append('model', 'whisper-1')
    form.append('language', 'ko') // 한국어 광고 기준(정확도↑). 다른 언어도 대체로 처리됨.
    form.append('response_format', 'text')

    const res = await fetch(OPENAI_STT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return NextResponse.json(
        { error: 'OpenAI 전사 오류: ' + t.slice(0, 200) },
        { status: res.status }
      )
    }
    transcript = (await res.text()).trim()
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '전사 실패' },
      { status: 500 }
    )
  }

  if (!transcript) {
    return NextResponse.json({ transcript: '', empty: true })
  }

  // 캐시 저장(실패해도 결과는 반환)
  try {
    await supabaseAdmin.from('am_ads').update({ transcript }).eq('library_id', libraryId)
  } catch {}

  return NextResponse.json({ transcript })
}
