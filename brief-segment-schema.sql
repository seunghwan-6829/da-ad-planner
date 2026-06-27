-- 브랜드 브리프 필드 변경: '세그먼트' 컬럼 추가
-- (브랜드명은 클라이언트명으로 자동, 브리프는 '소구점'(selling_points) + '세그먼트'(segment) 2개로 운영)
-- Supabase SQL Editor 에서 1회 실행하세요.

alter table clients add column if not exists segment text;  -- 세그먼트(타겟)
