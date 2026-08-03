-- 데이터 추적 확장: 세션 리플레이 + AI 주간 리포트 (재실행해도 안전)
-- Supabase SQL Editor 에서 1회 실행.

-- ── 세션 리플레이 ──
-- 트래커(rrweb)가 방문자 화면 이벤트를 청크로 업로드 → 웹에서 영상처럼 재생.
-- 메타(목록용)와 청크(재생용)를 분리해 목록 조회가 가볍다.
create table if not exists pb_replays (
  id text primary key,                 -- 트래커가 만든 replay_xxxxxxxx
  site_id text not null,
  session_id text,
  visitor_id text,
  path text,
  url text,
  device_type text,
  duration_ms integer default 0,
  event_count integer default 0,
  chunk_count integer default 0,
  created_at timestamptz default now()
);
create index if not exists idx_pb_replays_site_time on pb_replays (site_id, created_at desc);

create table if not exists pb_replay_chunks (
  replay_id text not null,
  seq integer not null,
  events jsonb not null,
  created_at timestamptz default now(),
  primary key (replay_id, seq)
);

-- ── AI 주간 진단 리포트 보관 ──
create table if not exists pb_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_key text not null,              -- 리포트 기준 주(끝 날짜)
  content text not null,               -- 마크다운 본문
  stats jsonb,                         -- 생성 당시 집계 스냅샷
  created_at timestamptz default now()
);
create index if not exists idx_pb_weekly_reports_time on pb_weekly_reports (created_at desc);

-- 서버(service_role)만 접근 — 브라우저 anon 키 직접 접근 차단(다른 pb_ 테이블과 동일 운영).
alter table pb_replays enable row level security;
alter table pb_replay_chunks enable row level security;
alter table pb_weekly_reports enable row level security;
