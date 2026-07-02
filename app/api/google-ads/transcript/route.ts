import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPENAI_STT_URL = 'https://api.openai.com/v1/audio/transcriptions'

// 구글 영상 광고 나레이션 받아쓰기(메타 transcript 미러).
// 사용자 OpenAI 키(x-user-openai-key)로 Whisper 호출. 결과는 ga_ads.transcript 캐시.
// ⚠️ media_url 이 우리 스토리지 mp4(크롤러가 다운로드한 것)일 때 동작. 유튜브 URL 그대로면 불가.
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
  if (!libraryId) return NextResponse.json({ error: 'library_id 가 필요합니다.' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_type, media_url, transcript')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  if (ad.transcript && !force) return NextResponse.json({ transcript: ad.transcript, cached: true })
  if (ad.media_type !== 'video' || !ad.media_url) {
    return NextResponse.json({ error: '영상 광고만 대본(나레이션)을 추출할 수 있어요.' }, { status: 400 })
  }
  if (/youtube\.com|youtu\.be/i.test(ad.media_url)) {
    return NextResponse.json(
      { error: '이 영상은 아직 파일로 저장되지 않았어요(유튜브 링크 상태). 다음 크롤 후 다시 시도해 주세요.' },
      { status: 400 }
    )
  }

  let videoBuf: Buffer
  try {
    const vr = await fetch(ad.media_url)
    if (!vr.ok) throw new Error(`status ${vr.status}`)
    videoBuf = Buffer.from(await vr.arrayBuffer())
  } catch {
    return NextResponse.json({ error: '영상을 불러오지 못했어요.' }, { status: 502 })
  }
  if (videoBuf.byteLength > 25 * 1024 * 1024) {
    return NextResponse.json({ error: '영상이 너무 커서(25MB 이상) 대본 추출이 어려워요.' }, { status: 413 })
  }

  let transcript = ''
  try {
    const form = new FormData()
    form.append('file', new Blob([videoBuf], { type: 'video/mp4' }), `${libraryId}.mp4`)
    form.append('model', 'whisper-1')
    form.append('language', 'ko')
    form.append('response_format', 'text')

    const res = await fetch(OPENAI_STT_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return NextResponse.json({ error: 'OpenAI 전사 오류: ' + t.slice(0, 200) }, { status: res.status })
    }
    transcript = (await res.text()).trim()
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '전사 실패' }, { status: 500 })
  }

  if (!transcript) return NextResponse.json({ transcript: '', empty: true })

  try {
    await supabaseAdmin.from('ga_ads').update({ transcript }).eq('library_id', libraryId)
  } catch {}

  return NextResponse.json({ transcript })
}
