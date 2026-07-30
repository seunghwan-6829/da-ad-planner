-- 데이터 추적 접근 권한 (재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.
--   · can_data_tracking: true 인 사용자만 '데이터 추적' 메뉴/페이지 접근 가능.
--     (관리자(role='admin')는 항상 접근 가능 — 이 플래그와 무관)
--   · 앱 승인(role='approved')과는 별개로 사람마다 켜고 끈다
--     (관리자 페이지 → '데이터 추적 권한' 탭에서 토글. 크롤러 권한과 똑같은 방식).
alter table user_profiles add column if not exists can_data_tracking boolean default false;

-- 마이그레이션 직후 접근이 갑자기 끊기지 않도록, 기존에 데이터 추적을 보던
-- 관리자·정식 승인(approved) 계정은 켠 상태로 시작한다. 이후 관리자가 개별로 끄면 된다.
update user_profiles set can_data_tracking = true
  where can_data_tracking is not true and role in ('admin', 'approved');
