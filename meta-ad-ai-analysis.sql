-- 메타 광고 크롤러: 추가 컬럼 (선택 마이그레이션 — 재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.
--   · ai_analysis: 소재별 AI 분석 결과 캐싱(없어도 분석은 동작, 있으면 재분석 없이 표시)
--   · summary    : 브랜드별 AI 한 줄 요약(대분류 옆 표시용)
alter table am_ads     add column if not exists ai_analysis text;
alter table am_targets add column if not exists summary     text;
