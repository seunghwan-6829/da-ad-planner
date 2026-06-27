-- 인스타 성과 — 클라이언트 인스타그램 분석 대시보드 (Instagram Graph API)
-- Supabase SQL Editor 에서 1회 실행하세요. (기존 테이블 영향 없음 — 전부 ig_ 프리픽스 신규)
-- 인스타는 과거 데이터를 안 주므로, 주기적으로 스냅샷을 떠서 시계열을 직접 쌓는다.

-- 1) 연동된 인스타 계정 (프로페셔널 계정 + 페이지 연결). 기존 clients(광고주)와 선택적 연결.
create table if not exists ig_accounts (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete set null,   -- 광고주 연결(선택)
  ig_user_id          text not null unique,        -- Instagram 비즈니스 계정 ID
  ig_username         text,
  name                text,
  profile_picture_url text,
  fb_page_id          text,                          -- 연결된 페이스북 페이지 ID
  status              text not null default 'active',-- active | token_expired | disconnected
  created_by          uuid,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists idx_ig_accounts_client on ig_accounts(client_id);

-- 2) 토큰 (암호화 저장). ★ RLS로 브라우저(authenticated) 읽기 차단 — service_role(서버)만 접근.
create table if not exists ig_tokens (
  account_id        uuid primary key references ig_accounts(id) on delete cascade,
  access_token_enc  text not null,                 -- AES-256-GCM 암호문(iv:tag:cipher)
  token_type        text default 'long_lived',
  expires_at        timestamptz,
  last_refreshed_at timestamptz default now()
);

-- 3) 계정 스냅샷 (시계열) — 팔로워/리치/조회수 등
create table if not exists ig_account_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references ig_accounts(id) on delete cascade,
  captured_at        timestamptz default now(),
  followers_count    integer,
  follows_count      integer,
  media_count        integer,
  reach              integer,
  views              integer,
  accounts_engaged   integer,
  total_interactions integer,
  profile_links_taps integer,
  raw                jsonb            -- 원시 인사이트(메트릭 변동 대비)
);
create index if not exists idx_ig_acc_snap on ig_account_snapshots(account_id, captured_at desc);

-- 4) 인구통계 스냅샷 (city / country / age_gender)
create table if not exists ig_demographics_snapshots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references ig_accounts(id) on delete cascade,
  captured_at timestamptz default now(),
  type        text not null,                       -- city | country | age_gender | online_followers
  breakdown   jsonb not null                       -- { "label": value, ... }
);
create index if not exists idx_ig_demo on ig_demographics_snapshots(account_id, captured_at desc);

-- 5) 미디어 (게시물 메타)
create table if not exists ig_media (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references ig_accounts(id) on delete cascade,
  ig_media_id        text not null unique,
  media_type         text,                          -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,                          -- FEED | REELS | STORY | AD
  caption            text,
  permalink          text,
  thumbnail_url      text,
  media_url          text,
  timestamp          timestamptz,
  created_at         timestamptz default now()
);
create index if not exists idx_ig_media_account on ig_media(account_id, timestamp desc);

-- 6) 미디어별 메트릭 스냅샷 (시계열)
create table if not exists ig_media_metrics (
  id                 uuid primary key default gen_random_uuid(),
  ig_media_id        text not null,
  account_id         uuid references ig_accounts(id) on delete cascade,
  captured_at        timestamptz default now(),
  like_count         integer,
  comments_count     integer,
  reach              integer,
  saved              integer,
  shares             integer,
  views              integer,
  total_interactions integer,
  raw                jsonb
);
create index if not exists idx_ig_media_metrics on ig_media_metrics(ig_media_id, captured_at desc);

-- 7) 동기화 로그
create table if not exists ig_sync_logs (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references ig_accounts(id) on delete cascade,
  ran_at     timestamptz default now(),
  status     text,                                  -- ok | partial | error
  error      text,
  calls_made integer default 0
);
create index if not exists idx_ig_sync_logs on ig_sync_logs(account_id, ran_at desc);

-- RLS: 토큰 외 테이블은 로그인 사용자 읽기/쓰기 허용(서버는 service_role로 우회).
alter table ig_accounts              enable row level security;
alter table ig_account_snapshots     enable row level security;
alter table ig_demographics_snapshots enable row level security;
alter table ig_media                 enable row level security;
alter table ig_media_metrics         enable row level security;
alter table ig_sync_logs             enable row level security;

drop policy if exists "ig_accounts_all"  on ig_accounts;
drop policy if exists "ig_acc_snap_all"  on ig_account_snapshots;
drop policy if exists "ig_demo_all"      on ig_demographics_snapshots;
drop policy if exists "ig_media_all"     on ig_media;
drop policy if exists "ig_media_m_all"   on ig_media_metrics;
drop policy if exists "ig_sync_all"      on ig_sync_logs;

create policy "ig_accounts_all" on ig_accounts              for all to authenticated using (true) with check (true);
create policy "ig_acc_snap_all" on ig_account_snapshots     for all to authenticated using (true) with check (true);
create policy "ig_demo_all"     on ig_demographics_snapshots for all to authenticated using (true) with check (true);
create policy "ig_media_all"    on ig_media                 for all to authenticated using (true) with check (true);
create policy "ig_media_m_all"  on ig_media_metrics         for all to authenticated using (true) with check (true);
create policy "ig_sync_all"     on ig_sync_logs             for all to authenticated using (true) with check (true);

-- ★ ig_tokens: RLS 켜되 정책을 만들지 않음 → authenticated(브라우저)는 접근 불가, service_role(서버)만 우회 접근.
alter table ig_tokens enable row level security;
