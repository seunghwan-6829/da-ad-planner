// 온드미디어(UGC) 크롤러 — Playwright 직접 스크래핑(유튜브/인스타).
//   유튜브: 채널 /videos·/shorts 페이지의 ytInitialData 파싱(조회수·제목·썸네일), 최신 N개는 watch 페이지에서 좋아요·댓글 best-effort 보강.
//   인스타: 프로필 페이지 best-effort(공개 프로필/메타·임베드 JSON). 비공개·로그인월이면 가능한 만큼만(없으면 - 처리).
// ⚠️ 모든 단계는 best-effort + try/catch. 한 크리에이터 실패가 전체를 죽이지 않는다.
//   결과는 om_posts 에 upsert(post_id 충돌 시 갱신). 이번 실행에서 안 보인 기존 active 콘텐츠는 status='ended' 표기.
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY
// 선택 env: CRAWL_CREATOR_ID(단일 크리에이터 즉시 크롤), IG_SESSIONID(인스타 로그인 쿠키 — 있으면 인스타 성공률↑),
//          MAX_POSTS(크리에이터당 최대 수집, 기본 40), MAX_ENRICH(유튜브 watch 보강 개수, 기본 12)

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const CRAWL_CREATOR_ID = (process.env.CRAWL_CREATOR_ID || '').trim()
const IG_SESSIONID = (process.env.IG_SESSIONID || '').trim()
const MAX_POSTS = Number(process.env.MAX_POSTS) || 40
const MAX_ENRICH = Number(process.env.MAX_ENRICH) || 12

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[om-crawl]', ...a)

// "조회수 1.2만회" / "1.2M views" / "1,234" 등 → 정수(추정). 실패 시 null.
function parseCount(s) {
  if (s == null) return null
  const str = String(s).replace(/조회수|views?|view|회|,|\s/gi, '').trim()
  if (!str) return null
  const m = str.match(/([\d.]+)\s*([만천억KMB]?)/i)
  if (!m) {
    const plain = Number(String(s).replace(/[^\d]/g, ''))
    return Number.isFinite(plain) && plain > 0 ? plain : null
  }
  const num = parseFloat(m[1])
  const unit = (m[2] || '').toUpperCase()
  const mult =
    unit === '만' ? 1e4 : unit === '천' ? 1e3 : unit === '억' ? 1e8 : unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1
  const v = Math.round(num * mult)
  return Number.isFinite(v) ? v : null
}

// ── 유튜브 ──
async function crawlYouTube(page, creator) {
  const base = (creator.url || '').replace(/\/+$/, '')
  const results = []
  let profile = { name: null, image: null }

  for (const sub of ['/videos', '/shorts']) {
    let data = null
    try {
      await page.goto(base + sub, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(1500)
      data = await page.evaluate(() => window.ytInitialData || null)
    } catch (e) {
      log('youtube goto 실패', base + sub, e.message)
      continue
    }
    if (!data) continue

    // 채널 프로필(이름/아바타)
    try {
      const md = data.metadata?.channelMetadataRenderer
      if (md) {
        profile.name = profile.name || md.title || null
        const av = md.avatar?.thumbnails
        if (av?.length) profile.image = profile.image || av[av.length - 1].url
      }
    } catch {}

    // 영상 그리드 추출
    try {
      const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || []
      for (const tab of tabs) {
        const items = tab.tabRenderer?.content?.richGridRenderer?.contents || []
        for (const it of items) {
          const vr = it.richItemRenderer?.content?.videoRenderer || it.richItemRenderer?.content?.reelItemRenderer
          if (!vr) continue
          const videoId = vr.videoId
          if (!videoId) continue
          const title =
            vr.title?.runs?.[0]?.text || vr.title?.simpleText || vr.headline?.simpleText || ''
          const thumbs = vr.thumbnail?.thumbnails || []
          const poster = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          const viewText = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map((r) => r.text).join('') || null
          const published = vr.publishedTimeText?.simpleText || null
          results.push({
            post_id: `yt_${videoId}`,
            platform: 'youtube',
            post_url: `https://www.youtube.com/watch?v=${videoId}`,
            caption: title,
            media_type: 'video',
            media_url: `https://www.youtube.com/watch?v=${videoId}`,
            poster_url: poster,
            posted_at: published,
            views: parseCount(viewText),
            likes: null,
            comments: null,
          })
          if (results.length >= MAX_POSTS) break
        }
        if (results.length >= MAX_POSTS) break
      }
    } catch (e) {
      log('youtube 파싱 실패', e.message)
    }
    if (results.length >= MAX_POSTS) break
  }

  // 최신 N개: watch 페이지에서 좋아요·댓글·정확 조회수 best-effort 보강
  const enrich = results.slice(0, MAX_ENRICH)
  for (const r of enrich) {
    try {
      await page.goto(r.post_url, { waitUntil: 'domcontentloaded', timeout: 40000 })
      await page.waitForTimeout(1200)
      const d = await page.evaluate(() => window.ytInitialData || null)
      if (!d) continue
      const contents =
        d.contents?.twoColumnWatchNextResults?.results?.results?.contents || []
      // 조회수
      for (const c of contents) {
        const vp = c.videoPrimaryInfoRenderer
        if (vp) {
          const vc = vp.viewCount?.videoViewCountRenderer?.viewCount
          const vt = vc?.simpleText || vc?.runs?.map((x) => x.text).join('') || null
          const ev = parseCount(vt)
          if (ev != null) r.views = ev
          // 좋아요(토글 버튼 라벨)
          try {
            const topBtns =
              vp.videoActions?.menuRenderer?.topLevelButtons || []
            for (const b of topBtns) {
              const tv = b.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel
              const label =
                tv?.defaultButtonViewModel?.buttonViewModel?.title ||
                b.toggleButtonRenderer?.defaultText?.simpleText ||
                null
              const lv = parseCount(label)
              if (lv != null) r.likes = lv
            }
          } catch {}
        }
        // 댓글 수
        const ce = c.itemSectionRenderer?.contents?.find?.((x) => x.commentsEntryPointHeaderRenderer)
        if (ce) {
          const ct = ce.commentsEntryPointHeaderRenderer?.commentCount?.simpleText
          const cv = parseCount(ct)
          if (cv != null) r.comments = cv
        }
      }
    } catch (e) {
      log('youtube enrich 실패', r.post_id, e.message)
    }
  }

  return { results, profile }
}

// ── 인스타그램 (best-effort) ──
async function crawlInstagram(context, page, creator) {
  const results = []
  let profile = { name: null, image: null }
  const handle = (creator.handle || (creator.url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || '').replace(/^@/, '')
  if (!handle) return { results, profile }

  // 로그인 쿠키가 있으면 주입(공개 데이터 접근성↑). 없으면 익명 best-effort.
  if (IG_SESSIONID) {
    try {
      await context.addCookies([{ name: 'sessionid', value: IG_SESSIONID, domain: '.instagram.com', path: '/', httpOnly: true, secure: true }])
    } catch {}
  }

  // 공개 web_profile_info JSON(가능하면). 차단되면 프로필 페이지 메타로 폴백.
  try {
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`
    await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(1000)
    const json = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { 'x-ig-app-id': '936619743392459' } })
        if (!r.ok) return null
        return await r.json()
      } catch {
        return null
      }
    }, url)

    const user = json?.data?.user
    if (user) {
      profile.name = user.full_name || handle
      profile.image = user.profile_pic_url_hd || user.profile_pic_url || null
      const edges = user.edge_owner_to_timeline_media?.edges || []
      for (const e of edges) {
        const n = e.node
        if (!n?.shortcode) continue
        const isVideo = !!n.is_video
        const isSidecar = n.__typename === 'GraphSidecar' || n.product_type === 'carousel_container'
        const children = n.edge_sidecar_to_children?.edges || []
        const media_urls = isSidecar ? children.map((c) => c.node.display_url).filter(Boolean) : null
        const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || ''
        results.push({
          post_id: `ig_${n.shortcode}`,
          platform: 'instagram',
          post_url: `https://www.instagram.com/p/${n.shortcode}/`,
          caption,
          media_type: isVideo ? 'video' : isSidecar ? 'slide' : 'image',
          media_url: isVideo ? n.video_url || null : n.display_url || null,
          media_urls,
          poster_url: n.display_url || n.thumbnail_src || null,
          posted_at: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString().slice(0, 10) : null,
          views: n.video_view_count ?? n.video_play_count ?? null,
          likes: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
          comments: n.edge_media_to_comment?.count ?? null,
        })
        if (results.length >= MAX_POSTS) break
      }
    }
  } catch (e) {
    log('instagram 수집 실패(로그인월일 수 있음)', handle, e.message)
  }

  // 프로필 메타 폴백(이름/사진만이라도)
  if (!profile.image) {
    try {
      const og = await page.evaluate(() => {
        const img = document.querySelector('meta[property="og:image"]')?.content || null
        const title = document.querySelector('meta[property="og:title"]')?.content || null
        return { img, title }
      })
      profile.image = profile.image || og?.img || null
      profile.name = profile.name || (og?.title ? og.title.split('(')[0].trim() : null)
    } catch {}
  }

  return { results, profile }
}

// 크리에이터 1명 처리 + DB 반영
async function processCreator(context, creator) {
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  let out = { results: [], profile: { name: null, image: null } }
  try {
    if (creator.platform === 'instagram') out = await crawlInstagram(context, page, creator)
    else out = await crawlYouTube(page, creator)
  } catch (e) {
    log('processCreator 실패', creator.id, e.message)
  } finally {
    await page.close().catch(() => {})
  }

  const { results, profile } = out
  log(`크리에이터 ${creator.label}(${creator.platform}) → ${results.length}개 수집`)

  // 크리에이터 프로필 갱신(이름/사진 비어있으면 채움)
  const cPatch = {}
  if (profile.name && !creator.profile_name) cPatch.profile_name = profile.name
  if (profile.image && !creator.profile_image) cPatch.profile_image = profile.image
  if (Object.keys(cPatch).length) {
    try { await sb.from('om_creators').update(cPatch).eq('id', creator.id) } catch {}
  }

  if (!results.length) return

  const now = new Date().toISOString()
  const rows = results.map((r) => ({
    ...r,
    creator_id: creator.id,
    creator_name: profile.name || creator.label,
    last_seen_at: now,
    status: 'active',
  }))

  // upsert: 신규는 삽입(first_seen_at 기본값), 기존은 지표/last_seen 갱신.
  try {
    const { error } = await sb.from('om_posts').upsert(rows, { onConflict: 'post_id' })
    if (error) log('upsert 오류', error.message)
  } catch (e) {
    log('upsert 예외', e.message)
  }

  // 이번에 안 보인 기존 active 콘텐츠 → ended 표기(best-effort)
  try {
    const seen = new Set(rows.map((r) => r.post_id))
    const { data: existing } = await sb.from('om_posts').select('post_id').eq('creator_id', creator.id).eq('status', 'active')
    const gone = (existing || []).map((x) => x.post_id).filter((id) => !seen.has(id))
    if (gone.length) {
      await sb.from('om_posts').update({ status: 'ended', ended_at: now }).in('post_id', gone)
      log(`${gone.length}개 종료 표기`)
    }
  } catch {}
}

async function main() {
  // 대상 크리에이터 로드
  let q = sb.from('om_creators').select('*').eq('enabled', true)
  if (CRAWL_CREATOR_ID) q = q.eq('id', CRAWL_CREATOR_ID)
  const { data: creators, error } = await q
  if (error) { console.error('크리에이터 로드 실패:', error.message); process.exit(1) }
  if (!creators?.length) { log('크롤할 크리에이터가 없습니다.'); return }
  log(`${creators.length}명 크롤 시작`)

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
  })

  for (const c of creators) {
    try { await processCreator(context, c) } catch (e) { log('크리에이터 처리 예외', c.id, e.message) }
  }

  await browser.close().catch(() => {})
  log('완료')
}

main().catch((e) => { console.error(e); process.exit(1) })
