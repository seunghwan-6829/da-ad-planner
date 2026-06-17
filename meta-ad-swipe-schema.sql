-- 메타 광고 크롤러: 스와이프 파일(즐겨찾기) 컬럼 (재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.
--   · saved: 마음에 든 소재를 '스와이프 파일'로 모아두기 위한 플래그
alter table am_ads add column if not exists saved boolean default false;
create index if not exists am_ads_saved_idx on am_ads(saved) where saved = true;
