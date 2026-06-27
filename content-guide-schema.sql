-- 컨텐츠 가이드(스토리보드) — 마인드맵과 동일하게 clients(광고주)별로 저장.
-- Supabase SQL Editor 에서 1회 실행하세요. (기존 데이터 영향 없음)

create table if not exists content_guides (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete cascade,
  library_id   text,            -- 출처 광고
  title        text,            -- 카드 제목
  source_brand text,            -- 크롤러 브랜드명(페이지명)
  source_thumb text,            -- 썸네일(소재 포스터/첫 씬)
  data         jsonb not null,  -- { scenes:[{ image, prompt, description, caution }], brand }
  created_by   uuid,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_content_guides_client on content_guides(client_id);
create index if not exists idx_content_guides_created on content_guides(created_at desc);

alter table content_guides enable row level security;
drop policy if exists "cg_all" on content_guides;
create policy "cg_all" on content_guides for all to authenticated using (true) with check (true);
