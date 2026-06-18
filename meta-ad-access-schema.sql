-- 메타 광고 크롤러 접근 권한 (재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.
--   · can_meta_ad: true 인 승인 사용자만 '메타 광고 크롤러' 메뉴/페이지 접근 가능.
--     (관리자(role='admin')는 항상 접근 가능 — 이 플래그와 무관)
alter table user_profiles add column if not exists can_meta_ad boolean default false;
