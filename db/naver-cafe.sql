-- 네이버 카페 자동화 v2: 카페(페르소나/일정) + 글(초안→발행→24h 반응 추적) + 에이전트 하트비트
-- Supabase SQL Editor 에서 1회 실행 (v1 을 이미 실행했다면 맨 아래 [v1→v2 마이그레이션]만 실행)

create table if not exists nc_cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- 표시명 (예: 강남맘 카페)
  cafe_url text not null,                -- https://cafe.naver.com/<카페주소>
  board_name text not null default '',   -- 글 올릴 게시판 이름(비우면 기본 게시판)
  tone text not null default '',         -- 페르소나(이 카페에서 활동하는 인물상/말투)
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
  -- 발행 24시간 후 반응 추적(카페 가입자만 열람 가능 → 내 PC 로그인 브라우저(에이전트)가 측정)
  track_due_at timestamptz,              -- 발행 시각 + 24h (이 시각 이후 에이전트가 측정)
  tracked_at timestamptz,                -- 측정 완료 시각(null = 측정 대기/놓침 → 에이전트 켜지면 한번에 처리)
  views int,
  likes int,
  comments int,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_nc_posts_status on nc_posts (status, created_at desc);
create index if not exists idx_nc_posts_cafe on nc_posts (cafe_id, created_at desc);
create index if not exists idx_nc_posts_track on nc_posts (track_due_at) where tracked_at is null;

-- 로컬 발행 에이전트 하트비트(내 PC에서 도는 publish-agent 가 30초마다 갱신)
create table if not exists nc_agent (
  id int primary key default 1,
  last_seen timestamptz not null default now(),
  info text
);

alter table nc_cafes enable row level security;
alter table nc_posts enable row level security;
alter table nc_agent enable row level security;

-- ── v1→v2 보강(멱등): v1 때 만든 테이블에도 새 컬럼을 채움. 처음 실행이든 재실행이든 안전. ──
alter table nc_cafes add column if not exists plan_schedule text not null default '';
alter table nc_cafes add column if not exists publish_slot text not null default '';
alter table nc_posts add column if not exists origin text not null default 'manual';
alter table nc_posts add column if not exists track_due_at timestamptz;
alter table nc_posts add column if not exists tracked_at timestamptz;
alter table nc_posts add column if not exists views int;
alter table nc_posts add column if not exists likes int;
alter table nc_posts add column if not exists comments int;
create index if not exists idx_nc_posts_track on nc_posts (track_due_at) where tracked_at is null;
