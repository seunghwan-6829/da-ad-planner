-- ═══════════════════════════════════════════════════════════════
-- 기획 메모장 — Supabase SQL Editor 에 통째로 붙여넣고 실행 (멱등)
-- 기획안 제작 > [기획 메모장]. 폴더로 분류 + 실시간 저장 메모 + AI 베리에이션 스냅샷
-- ═══════════════════════════════════════════════════════════════

-- 폴더(개인별). 메모를 담는 그룹.
create table if not exists plan_memo_folders (
  id uuid primary key default gen_random_uuid(),
  owner text not null,                    -- 소유자(email)
  name text not null default '새 폴더',
  color text not null default '#6366F1',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_memo_folders_owner on plan_memo_folders (owner, sort_order);

create table if not exists plan_memos (
  id uuid primary key default gen_random_uuid(),
  owner text not null,                    -- 작성자(email) — 본인 것만 보고 수정
  folder_id uuid references plan_memo_folders(id) on delete set null, -- 소속 폴더(없으면 미분류)
  title text not null default '무제 메모',
  content text not null default '',       -- 메인 작성 내용(실시간 저장)
  variations jsonb not null default '[]', -- 최근 AI 베리에이션 스냅샷 [{kind,text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_plan_memos_owner on plan_memos (owner, updated_at desc);
create index if not exists idx_plan_memos_folder on plan_memos (folder_id);

-- 기존 테이블에 folder_id 보강(v1 실행했던 경우)
alter table plan_memos add column if not exists folder_id uuid references plan_memo_folders(id) on delete set null;

-- service_role(서버 API)만 접근
alter table plan_memo_folders enable row level security;
alter table plan_memos enable row level security;
