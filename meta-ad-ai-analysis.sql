-- 메타 광고 크롤러: 소재별 AI 분석 결과 캐싱 컬럼
-- Supabase SQL Editor 에서 1회 실행. (선택 — 안 해도 분석은 동작하나, 실행하면 결과가 저장돼 재분석 없이 재표시됨)
alter table am_ads add column if not exists ai_analysis text;
