import { supabaseAdmin } from '@/lib/supabase-admin'

// 요청이 관리자(user_profiles.role='admin')인지 서버에서 검증.
// 클라이언트는 Supabase 세션 access_token 을 Authorization: Bearer <token> 로 보낸다.
// 실패/누락 시 false(개방 아님).
export async function isAdminRequest(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token || !supabaseAdmin) return false
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data?.user) return false
    const { data: prof } = await supabaseAdmin.from('user_profiles').select('role').eq('id', data.user.id).maybeSingle()
    return prof?.role === 'admin'
  } catch {
    return false
  }
}
