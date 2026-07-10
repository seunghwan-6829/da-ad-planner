-- 네이버 카페 자동화: 카페(성질/말투) + 글(초안→발행 큐→발행) + 로컬 에이전트 하트비트
-- Supabase SQL Editor 에서 1회 실행

create table if not exists nc_cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- 표시명 (예: 강남맘 카페)
  cafe_url text not null,                -- https://cafe.naver.com/<카페주소>
  board_name text not null default '',   -- 글 올릴 게시판 이름(비우면 기본 게시판)
  tone text not null default '',         -- 카페 성질/말투 (예: 3040 육아맘, 존댓말+이모지 적당히, 후기톤)
  topics text not null default '',       -- 주로 다룰 주제
  notes text not null default '',        -- 주의사항/금지어 등
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists nc_posts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references nc_cafes(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','queued','publishing','published','failed')),
  scheduled_at timestamptz,              -- (추후 디벨롭) 예약 발행
  published_at timestamptz,
  published_url text,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_nc_posts_status on nc_posts (status, created_at desc);
create index if not exists idx_nc_posts_cafe on nc_posts (cafe_id, created_at desc);

-- 로컬 발행 에이전트 하트비트(내 PC에서 도는 publish-agent 가 30초마다 갱신)
create table if not exists nc_agent (
  id int primary key default 1,
  last_seen timestamptz not null default now(),
  info text
);

-- service_role(서버 API·로컬 에이전트)만 접근
alter table nc_cafes enable row level security;
alter table nc_posts enable row level security;
alter table nc_agent enable row level security;
