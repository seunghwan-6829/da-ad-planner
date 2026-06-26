-- 기획 마인드맵 기능 마이그레이션
-- Supabase SQL Editor 에서 1회 실행하세요. (기존 데이터에 영향 없음)

-- ────────────────────────────────────────────────────────────
-- 1) 마인드맵: 경쟁 소재 1개 = 마인드맵 1개. clients(기획안 제작 브랜드)별로 묶임.
-- ────────────────────────────────────────────────────────────
create table if not exists plan_mindmaps (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  library_id  text,            -- 출처 광고(am_ads.library_id)
  title       text,            -- 카드 제목(브랜드 + 캡션 일부)
  source_brand text,           -- 크롤러 브랜드명(am_targets.label)
  source_thumb text,           -- 광고 썸네일/포스터 URL
  data        jsonb not null,  -- { summary, nodes:[{ key, label, items:[...] }] }
  created_by  uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_plan_mindmaps_client on plan_mindmaps(client_id);
create index if not exists idx_plan_mindmaps_created on plan_mindmaps(created_at desc);

alter table plan_mindmaps enable row level security;

-- 내부 협업 도구라 인증된 사용자 전체 허용(clients 정책과 동일 스타일).
drop policy if exists "mm_all" on plan_mindmaps;
create policy "mm_all" on plan_mindmaps
  for all to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 2) 클라이언트 브랜드 브리프(관리자만 편집 — 편집은 서버 API 에서 강제 검증)
-- ────────────────────────────────────────────────────────────
alter table clients add column if not exists brand_brief    text;  -- 어떤 브랜드인지
alter table clients add column if not exists strengths      text;  -- 강점
alter table clients add column if not exists selling_points text;  -- 소구점
