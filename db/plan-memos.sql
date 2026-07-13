-- ═══════════════════════════════════════════════════════════════
-- 기획 메모장 — Supabase SQL Editor 에 통째로 붙여넣고 실행 (멱등)
-- 기획안 제작 > [기획 메모장]에서 쓰는 실시간 저장 메모 + AI 베리에이션 스냅샷
-- ═══════════════════════════════════════════════════════════════

create table if not exists plan_memos (
  id uuid primary key default gen_random_uuid(),
  owner text not null,                    -- 작성자(email) — 본인 것만 보고 수정
  title text not null default '무제 메모',
  content text not null default '',       -- 메인 작성 내용(실시간 저장)
  variations jsonb not null default '[]', -- 최근 AI 베리에이션 스냅샷 [{kind,text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_plan_memos_owner on plan_memos (owner, updated_at desc);

-- service_role(서버 API)만 접근
alter table plan_memos enable row level security;
