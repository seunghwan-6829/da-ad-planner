-- 제작 리스트: 크롤러(메타/구글/온드미디어)에서 "제작할 소재"를 담아두는 보드
-- Supabase SQL Editor 에서 1회 실행

create table if not exists production_list (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('meta','google','owned')),
  ref_id text not null,                 -- am_ads.library_id / ga_ads.library_id / om_posts.post_id
  brand text,                           -- 표시용 스냅샷(브랜드/크리에이터명)
  thumb text,                           -- 리스트 카드 썸네일(poster_url 스냅샷)
  media_type text,                      -- video / image / carousel (배지용)
  note text not null default '',        -- 제작 메모
  status text not null default 'todo' check (status in ('todo','doing','done')),
  created_by text,                      -- 담은 사람(email)
  created_at timestamptz not null default now(),
  unique (source, ref_id)               -- 같은 소재 중복 담기 방지
);

create index if not exists idx_prodlist_created on production_list (created_at desc);
create index if not exists idx_prodlist_status on production_list (status);

-- service_role(서버 API)만 접근 — 클라이언트 직접 접근 차단
alter table production_list enable row level security;
