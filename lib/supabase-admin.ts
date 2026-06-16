import { createClient } from '@supabase/supabase-js'

// 서버 전용 Supabase 클라이언트 (service_role).
// service_role 키는 API 라우트(서버)에서만 사용하고 브라우저에 절대 노출하지 않는다.
// 일반(anon/public) 클라이언트는 lib/supabase.ts 를 그대로 사용한다.
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  // 빌드는 통과시키되, 실제 호출 시 명확히 알 수 있게 경고.
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 설정되지 않았습니다. (메타 광고 크롤러 서버 클라이언트)')
}

// 환경변수가 없으면 더미(null) — 빌드 타임에 createClient('') 가 던지는 것을 방지.
// 실제 요청은 force-dynamic 라우트에서만 일어나며, 그땐 Vercel 환경변수가 주입됨.
export const supabaseAdmin = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : (null as any)
