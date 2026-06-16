import { createClient } from "@supabase/supabase-js";

// 서버 전용 클라이언트. service_role 키는 API 라우트(서버)에서만 사용 → 브라우저 노출 X.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  // 빌드는 통과시키되, 실제 호출 시 명확히 알려준다.
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY 가 설정되지 않았습니다.");
}

export const supabaseAdmin = createClient(url ?? "", key ?? "", {
  auth: { persistSession: false },
});
