import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { extractIgVideoUrl, igShortCodeOf } from '@/lib/ig-video'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPENAI_STT_URL = 'https://api.openai.com/v1/audio/transcriptions'

// 온드미디어 영상 콘텐츠의 나레이션을 텍스트로 받아쓰기(리메이크용 대본).
// 사용자 OpenAI 키(x-user-openai-key)로 Whisper 호출. 결과는 om_posts.transcript 에 캐시.
// ⚠️ media_url 이 직접 재생 가능한 영상 파일일 때만 동작(예: 인스타 CDN). 유튜브 임베드 URL 은 STT 불가.
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-openai-key') || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API 키가 없습니다. 마이페이지에서 OpenAI 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const postId = (body.post_id || body.library_id || '').toString().trim()
  const force = !!body.force
  if (!postId) return NextResponse.json({ error: 'post_id 가 필요합니다.' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('om_posts')
    .select('post_id, platform, media_type, media_url, post_url, transcript')
    .eq('post_id', postId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '콘텐츠를 찾을 수 없습니다.' }, { status: 404 })

  if (ad.transcript && !force) {
    return NextResponse.json({ transcript: ad.transcript, cached: true })
  }
  if (ad.media_type !== 'video') {
    return NextResponse.json({ error: '영상 콘텐츠만 대본(나레이션)을 추출할 수 있어요.' }, { status: 400 })
  }
  // 유튜브 임베드/워치 URL 은 직접 다운로드가 안 되므로 STT 불가(인스타 등 직접 영상 파일만 지원).
  if (/youtube\.com|youtu\.be/i.test(ad.media_url || '')) {
    return NextResponse.json({ error: '유튜브 영상은 대본 자동 추출을 지원하지 않아요.' }, { status: 400 })
  }

  // 영상 소스: 저장된 mp4 → 그대로. 임베드형 인스타(영상 미저장) → 원본 mp4 즉석 추출.
  const igCode = ad.platform === 'instagram' ? igShortCodeOf(ad.post_id, ad.post_url) : null
  let videoSrc: string | null = ad.media_url
  if (!videoSrc) {
    if (igCode) videoSrc = await extractIgVideoUrl(igCode)
    if (!videoSrc) return NextResponse.json({ error: '영상 원본을 가져오지 못했어요(비공개/삭제일 수 있음).' }, { status: 502 })
  }

  let videoBuf: Buffer | null = null
  try {
    const vr = await fetch(videoSrc)
    if (!vr.ok) throw new Error(`status ${vr.status}`)
    videoBuf = Buffer.from(await vr.arrayBuffer())
  } catch {
    videoBuf = null
  }
  // 저장된 인스타 CDN 링크가 만료된 경우 → 신선한 원본 URL 로 1회 재시도
  if (!videoBuf && igCode) {
    const fresh = await extractIgVideoUrl(igCode)
    if (fresh && fresh !== videoSrc) {
      try {
        const vr = await fetch(fresh)
        if (vr.ok) videoBuf = Buffer.from(await vr.arrayBuffer())
      } catch {}
    }
  }
  if (!videoBuf) {
    return NextResponse.json({ error: '영상을 불러오지 못했어요.' }, { status: 502 })
  }
  if (videoBuf.byteLength > 25 * 1024 * 1024) {
    return NextResponse.json({ error: '영상이 너무 커서(25MB 이상) 대본 추출이 어려워요.' }, { status: 413 })
  }

  let transcript = ''
  try {
    const form = new FormData()
    form.append('file', new Blob([videoBuf], { type: 'video/mp4' }), `${postId}.mp4`)
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
    await supabaseAdmin.from('om_posts').update({ transcript }).eq('post_id', postId)
  } catch {}

  return NextResponse.json({ transcript })
}
