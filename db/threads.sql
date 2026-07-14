-- ═══════════════════════════════════════════════════════════════
-- 쓰레드(Threads) 자동화 — Supabase SQL Editor 에 통째로 붙여넣고 실행
-- 멱등: 여러 번 돌려도 안전, 데이터 안 지워짐. 프리픽스 th_.
-- 모델: 브랜드(페르소나) → 카테고리(수집 소스) → 스크랩(수집글)/큐(발행 초안)/발행이력/인사이트
-- 발행: Meta Threads API(2-step) — 서버(크론)에서 발행. 수집: 로컬 워커(Playwright 로그인).
-- ═══════════════════════════════════════════════════════════════

-- 브랜드(페르소나). id = 슬러그(토큰 환경변수명 THREADS_TOKEN_<ID大문자>에 사용)
create table if not exists th_brands (
  id text primary key,                       -- 예: main → THREADS_TOKEN_MAIN
  name text not null,
  persona text not null default '',
  mode text not null default 'collect' check (mode in ('collect','publish')),
  timezone text not null default 'Asia/Seoul',
  publish_slots jsonb not null default '[]'::jsonb,  -- ["08:00","12:30","20:00"]
  max_posts_per_day int not null default 3,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- 카테고리(수집 소스). threads_topic(키워드/태그) 또는 css(외부 게시판)
create table if not exists th_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references th_brands(id) on delete cascade,
  name text not null,
  type text not null default 'threads_topic' check (type in ('threads_topic','css')),
  keyword text not null default '',          -- threads_topic 검색어
  topic_tag text not null default '',        -- 발행 시 붙일 태그
  url text not null default '',              -- 명시적 태그 URL / css 게시판 URL
  preset text not null default '',           -- css 프리셋(예: dcinside)
  created_at timestamptz not null default now()
);

-- 수집글(스크랩). key = 최초 발견 시 dedup 해시(16-hex)
create table if not exists th_scraps (
  key text primary key,
  brand_id text not null references th_brands(id) on delete cascade,
  category_id uuid references th_categories(id) on delete set null,
  source_type text not null,                 -- threads_topic | css
  title text not null default '',
  url text not null default '',
  author text not null default '',
  first_seen timestamptz not null default now()
);

-- 스크랩 지표 시계열(크롤마다 1행) — viral 판정용
create table if not exists th_scrap_metrics (
  id bigint generated always as identity primary key,
  scrap_key text not null references th_scraps(key) on delete cascade,
  ts timestamptz not null default now(),
  rank int,                                  -- threads_topic: 피드 노출 순위(1-base)
  views int, likes int, comments int         -- css
);

-- 발행 큐(초안/예약). status: queued → published | failed
create table if not exists th_queue (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references th_brands(id) on delete cascade,
  category_id uuid references th_categories(id) on delete set null,
  topic_tag text not null default '',
  text text not null default '',
  status text not null default 'queued' check (status in ('queued','publishing','published','failed')),
  scheduled_at timestamptz,                  -- null = 슬롯 모드(다음 슬롯에 발행)
  meta jsonb not null default '{}'::jsonb,    -- {manual:true} | {source_key, source_title, generated:true}
  source_key text,                           -- 소재 스크랩 key(중복 생성 방지)
  media_id text,                             -- 발행 성공 후 Threads media id
  error text,
  created_at timestamptz not null default now()
);

-- 발행 이력(성공 1건당 1행). queue_id = 멱등키
create table if not exists th_published (
  id bigint generated always as identity primary key,
  brand_id text not null,
  queue_id uuid references th_queue(id) on delete set null,
  media_id text,
  text text not null default '',
  category text,
  topic_tag text,
  source_key text,                         -- 소재 스크랩 key(발행 후에도 재생성 방지)
  published_at timestamptz not null default now(),
  published_at_local text
);
alter table th_published add column if not exists source_key text;

-- 내 글 성과 스냅샷(6h마다 1행)
create table if not exists th_insights (
  id bigint generated always as identity primary key,
  brand_id text not null,
  media_id text not null,
  text text not null default '',
  posted_at text,
  permalink text,
  ts timestamptz not null default now(),
  views int, likes int, replies int, reposts int, quotes int, shares int
);

-- 브랜드별 스타일 가이드(AI 생성, 재활용)
create table if not exists th_style_guides (
  brand_id text primary key references th_brands(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

-- 수집 워커 하트비트(온라인 표시)
create table if not exists th_agent (
  id int primary key default 1,
  last_seen timestamptz not null default now(),
  info text
);

-- 인덱스
create index if not exists idx_th_categories_brand on th_categories (brand_id);
create index if not exists idx_th_scraps_brand on th_scraps (brand_id, first_seen desc);
create index if not exists idx_th_scraps_cat on th_scraps (category_id);
create index if not exists idx_th_scrap_metrics_key on th_scrap_metrics (scrap_key, ts desc);
create index if not exists idx_th_queue_status on th_queue (status, created_at desc);
create index if not exists idx_th_queue_brand on th_queue (brand_id);
create index if not exists idx_th_queue_source on th_queue (source_key);
create index if not exists idx_th_published_queue on th_published (queue_id);
create index if not exists idx_th_published_brand on th_published (brand_id, published_at desc);
create index if not exists idx_th_insights_brand on th_insights (brand_id, media_id, ts desc);
-- 멱등/중복방지: 한 큐 아이템은 한 번만 발행, 한 소재는 브랜드당 초안 1개
create unique index if not exists uniq_th_published_queue on th_published (queue_id) where queue_id is not null;
create unique index if not exists uniq_th_queue_source on th_queue (brand_id, source_key) where source_key is not null;

-- 보안: service_role(서버 API·로컬 워커)만 접근
alter table th_brands enable row level security;
alter table th_categories enable row level security;
alter table th_scraps enable row level security;
alter table th_scrap_metrics enable row level security;
alter table th_queue enable row level security;
alter table th_published enable row level security;
alter table th_insights enable row level security;
alter table th_style_guides enable row level security;
alter table th_agent enable row level security;
