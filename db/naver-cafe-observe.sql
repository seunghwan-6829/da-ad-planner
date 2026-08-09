-- 네이버 카페 자동화: 카페 관찰 데이터 (재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.
--
-- 워커(노트북)가 각 발행처 게시판에 하루 한 번 들러 "실제로 올라오는 글 제목"을 수집해 쌓는다.
--   · 원고 생성 시 이 카페의 말투·소재 결을 참고(따라 쓰지는 않음 — 생성 단계에서 유사도 차단)
--   · 웹 카페 화면의 '카페 관찰' 카드에서 축적된 목록 확인
create table if not exists nc_cafe_posts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null,
  title text not null,
  article_id text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  unique (cafe_id, title)
);
create index if not exists idx_nc_cafe_posts_cafe_time on nc_cafe_posts (cafe_id, last_seen desc);

-- 인기글 수집(2026-08-05 확장): 카페 인기글 페이지 + 목록의 조회·댓글 수까지 저장.
-- 반응이 검증된 글을 '소재 시드'로 원고에 활용(주제만 차용, 문장·노하우 재사용은 생성 단계에서 금지·차단).
alter table nc_cafe_posts add column if not exists views integer;
alter table nc_cafe_posts add column if not exists comments integer;
alter table nc_cafe_posts add column if not exists is_popular boolean default false;

-- 서버(service_role)만 접근 — 브라우저 anon 직접 접근 차단.
alter table nc_cafe_posts enable row level security;
