-- ═══════════════════════════════════════════════════════════════
-- 제작 리스트 — Supabase SQL Editor 에 통째로 붙여넣고 실행
-- 멱등: 처음 실행이든 재실행이든 몇 번을 돌려도 안전, 데이터 안 지워짐
-- ═══════════════════════════════════════════════════════════════

-- ① 테이블 (이미 있으면 건너뜀)
create table if not exists production_list (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('meta','google','owned')),
  ref_id text not null,                 -- am_ads.library_id / ga_ads.library_id / om_posts.post_id
  brand text,                           -- 표시용 스냅샷(브랜드/크리에이터명)
  thumb text,                           -- 리스트 카드 썸네일(poster_url 스냅샷)
  media_type text,                      -- video / image / carousel (배지용)
  note text not null default '',        -- 제작 메모
  status text not null default 'todo' check (status in ('todo','doing','done')),
  client_id uuid references clients(id) on delete set null, -- 어느 클라이언트용 제작인지(담을 때 선택)
  created_by text,                      -- 담은 사람(email)
  created_at timestamptz not null default now(),
  unique (source, ref_id)               -- 같은 소재 중복 담기 방지
);

-- ② 기본 인덱스
create index if not exists idx_prodlist_created on production_list (created_at desc);
create index if not exists idx_prodlist_status on production_list (status);

-- ③ 기존 테이블 보강(v1 때 만든 경우 client_id 추가. 이미 있으면 건너뜀)
alter table production_list add column if not exists client_id uuid references clients(id) on delete set null;

-- 보안: service_role(서버 API)만 접근
alter table production_list enable row level security;
