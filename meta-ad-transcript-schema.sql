-- 영상 소재의 나레이션 대본(STT 결과) 캐시용 컬럼.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 한 번이면 됩니다.
alter table am_ads add column if not exists transcript text;
