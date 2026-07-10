-- ═══════════════════════════════════════════════════════════════
-- 네이버 카페 자동화 v2 — Supabase SQL Editor 에 통째로 붙여넣고 실행
-- 멱등: 처음 실행이든 재실행이든(v1 테이블이 있든 없든) 몇 번을 돌려도 안전, 데이터 안 지워짐
-- 실행 순서: ① 테이블 생성 → ② 기본 인덱스 → ③ 컬럼 보강(alter) → ④ 새 컬럼 인덱스
-- ═══════════════════════════════════════════════════════════════

-- ① 테이블 (이미 있으면 건너뜀)
create table if not exists nc_cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- 표시명 (예: 강남맘 카페)
  cafe_url text not null,                -- https://cafe.naver.com/<카페주소>
  board_name text not null default '',   -- 글 올릴 게시판 이름(비우면 기본 게시판)
  tone text not null default '',         -- 활동 페르소나(인물상/말투)
  topics text not null default '',       -- 주로 다룰 주제
  notes text not null default '',        -- 주의사항/금지어 등
  plan_schedule text not null default '',-- 기획 일정 메모(예: 월·수·금 오전)
  publish_slot text not null default '', -- 발행 예약 기본 시간대(예: 평일 19시)
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists nc_posts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references nc_cafes(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','queued','publishing','published','failed')),
  origin text not null default 'manual' check (origin in ('manual','auto')), -- auto = 하루 3개 AI 자동 초안
  scheduled_at timestamptz,              -- (추후) 예약 발행
  published_at timestamptz,
  published_url text,
  error text,
  track_due_at timestamptz,              -- 발행 +24h (이후 에이전트가 반응 측정)
  tracked_at timestamptz,                -- 측정 완료 시각(null = 대기/놓침 → 에이전트가 몰아서 처리)
  views int,
  likes int,
  comments int,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nc_agent (
  id int primary key default 1,
  last_seen timestamptz not null default now(),
  info text
);

-- ② 기본 인덱스(v1 컬럼만 사용 — 어떤 상태에서도 안전)
create index if not exists idx_nc_posts_status on nc_posts (status, created_at desc);
create index if not exists idx_nc_posts_cafe on nc_posts (cafe_id, created_at desc);

-- ③ v1 → v2 컬럼 보강 (v1 때 만든 테이블에 새 컬럼 추가. 이미 있으면 건너뜀)
alter table nc_cafes add column if not exists plan_schedule text not null default '';
alter table nc_cafes add column if not exists publish_slot text not null default '';
alter table nc_posts add column if not exists origin text not null default 'manual';
alter table nc_posts add column if not exists track_due_at timestamptz;
alter table nc_posts add column if not exists tracked_at timestamptz;
alter table nc_posts add column if not exists views int;
alter table nc_posts add column if not exists likes int;
alter table nc_posts add column if not exists comments int;

-- ④ 새 컬럼을 쓰는 인덱스 — 반드시 ③ 다음에!
create index if not exists idx_nc_posts_track on nc_posts (track_due_at) where tracked_at is null;

-- 보안: service_role(서버 API·로컬 에이전트)만 접근
alter table nc_cafes enable row level security;
alter table nc_posts enable row level security;
alter table nc_agent enable row level security;
