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
alter table nc_cafes add column if not exists selling_point text not null default ''; -- 채널 소구점
alter table nc_cafes add column if not exists daily_drafts int not null default 3;    -- 하루 AI 초안 개수(카페별)

-- ④ 새 컬럼을 쓰는 인덱스 — 반드시 ③ 다음에!
create index if not exists idx_nc_posts_track on nc_posts (track_due_at) where tracked_at is null;

-- 보안: service_role(서버 API·로컬 에이전트)만 접근
alter table nc_cafes enable row level security;
alter table nc_posts enable row level security;
alter table nc_agent enable row level security;

-- ═══════════════════════════════════════════════════════════════
-- v3 — 리뉴얼 반영: 브랜드(페르소나) → 발행처 모델 + 승인 큐/보관함 + 페이스(계정 밴 방지) + 자동 스케줄 + 댓글
-- 모두 멱등·가산(기존 v2 데이터 무손실). 기존 nc_cafes = "발행처(카페 보드)", nc_posts = "큐 아이템".
-- ═══════════════════════════════════════════════════════════════

-- ⑤ 브랜드(페르소나) — 여러 발행처를 묶는 상위 개념
create table if not exists nc_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  persona text not null default '',                 -- 이 브랜드가 카페에서 활동하는 인물상/톤
  default_topics jsonb not null default '[]'::jsonb, -- 발행처 topics 가 비면 상속
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table nc_brands enable row level security;

-- ⑥ nc_cafes = 발행처(카페 보드)로 확장. 기존 컬럼 유지 + 리뉴얼 필드 가산.
alter table nc_cafes add column if not exists brand_id uuid references nc_brands(id) on delete set null;
alter table nc_cafes add column if not exists club_id text not null default '';        -- 네이버 카페 숫자 ID(비우면 cafe_url 에서 파싱)
alter table nc_cafes add column if not exists board_id text not null default '';        -- 게시판(메뉴) ID
alter table nc_cafes add column if not exists require_prefix boolean not null default false; -- 말머리 필수 여부
alter table nc_cafes add column if not exists prefix text not null default '';          -- 말머리 값
alter table nc_cafes add column if not exists emphasis jsonb not null default '[]'::jsonb;-- 본문에서 **볼드** 처리할 키워드
alter table nc_cafes add column if not exists allow_post boolean not null default true;
alter table nc_cafes add column if not exists allow_comment boolean not null default true;
alter table nc_cafes add column if not exists auto_mode boolean not null default false;  -- 자동 스케줄 on/off
alter table nc_cafes add column if not exists interval_days int not null default 3;      -- 자동 초안 생성 주기(일)
alter table nc_cafes add column if not exists auto_publish boolean not null default false;-- 자동 생성 초안을 바로 승인(approved)
alter table nc_cafes add column if not exists rules jsonb not null default '{}'::jsonb;   -- {promo_banned, notes, min_level ...}

-- ⑦ nc_posts = 큐 아이템으로 확장. 상태 enum 확장(approved/rejected/saved) + kind(post/comment) + 페이스/승인 필드.
alter table nc_posts add column if not exists kind text not null default 'post';         -- 'post' | 'comment'
alter table nc_posts add column if not exists source_url text;                            -- 댓글 대상 원글 URL(comment 전용)
alter table nc_posts add column if not exists not_before timestamptz;                     -- 이 시각 전에는 발행 금지(댓글 랜덤 지연)
alter table nc_posts add column if not exists fail_count int not null default 0;          -- 연속 실패 횟수(>=3 → failed 격리)
alter table nc_posts add column if not exists approved_at timestamptz;
alter table nc_posts add column if not exists note text;
-- 상태 체크 제약 확장: 기존 인라인 제약을 드롭하고 리뉴얼 상태(approved/rejected/saved) 포함해 재생성.
alter table nc_posts drop constraint if exists nc_posts_status_check;
alter table nc_posts add constraint nc_posts_status_check
  check (status in ('draft','approved','queued','publishing','published','rejected','failed','saved'));
-- kind 체크
alter table nc_posts drop constraint if exists nc_posts_kind_check;
alter table nc_posts add constraint nc_posts_kind_check check (kind in ('post','comment'));

-- ⑧ 활동 로그 = 페이스 카운트의 원천(발행 성공마다 1행). status 가 아니라 이 표를 센다.
create table if not exists nc_activity (
  id bigint generated always as identity primary key,
  kind text not null,                    -- 'post' | 'comment'
  cafe_id uuid references nc_cafes(id) on delete set null, -- 발행처(주간 상한 계산용). null 허용(발행처 삭제돼도 일일 상한은 유지)
  at timestamptz not null default now()
);
alter table nc_activity enable row level security;

-- ⑨ 설정 싱글턴(페이스/모델). 한 행만 유지.
create table if not exists nc_settings (
  id int primary key default 1,
  pacing jsonb not null default '{}'::jsonb,
  claude jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint nc_settings_singleton check (id = 1)
);
alter table nc_settings enable row level security;
-- 기본 페이스 값 시드(이미 있으면 유지 — 덮어쓰지 않음)
insert into nc_settings (id, pacing, claude)
values (1,
  '{"active_hours":[9,23],"daily_post_limit":2,"daily_comment_limit":8,"per_cafe_post_weekly":2,"min_action_gap_min":25,"max_action_gap_min":90,"comment_delay_min":30,"comment_delay_max":240}'::jsonb,
  '{"model":"claude-sonnet-4-6","max_tokens":2000}'::jsonb)
on conflict (id) do nothing;

-- ⑩ 키-값 메타(next_action_at, auto_last:<dest_id> 등)
create table if not exists nc_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table nc_meta enable row level security;

-- ⑪ 인덱스(리뉴얼 필드)
create index if not exists idx_nc_posts_kind_status on nc_posts (kind, status, id);
create index if not exists idx_nc_cafes_brand on nc_cafes (brand_id);
create index if not exists idx_nc_activity_cafe_at on nc_activity (cafe_id, at desc);
create index if not exists idx_nc_activity_kind_at on nc_activity (kind, at desc);
