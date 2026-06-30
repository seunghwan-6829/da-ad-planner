-- =============================================
-- 온드미디어 크롤러 (UGC: 유튜브 / 인스타그램 크리에이터 콘텐츠 추적)
--   메타 광고 크롤러(am_targets/am_ads)와 동일 패턴, 완전 격리된 om_ 접두 테이블.
--   Supabase SQL Editor 에서 1회 실행. 재실행해도 안전(idempotent).
-- =============================================

-- ── 크리에이터(추적 대상 = 메타광고의 am_targets 격) ──
create table if not exists om_creators (
  id            uuid primary key default gen_random_uuid(),
  label         text not null default '(이름없음)',   -- 사용자가 입력한 크리에이터 이름
  platform      text not null default 'youtube',       -- 'youtube' | 'instagram'
  url           text,                                  -- 채널/프로필 URL
  handle        text,                                  -- @handle 또는 channelId / shortname
  profile_name  text,                                  -- 스크랩된 표시 이름
  profile_image text,                                  -- 프로필 사진 URL
  category      text not null default '미분류',         -- 대분류(수동/관리자)
  client_ids    uuid[] default '{}',                   -- 기획안 제작 클라이언트 매핑(여러 개)
  summary       text,                                  -- 한 줄 요약(선택)
  enabled       boolean not null default true,         -- 크롤 on/off
  created_at    timestamptz not null default now()
);

create index if not exists om_creators_platform_idx on om_creators(platform);
create index if not exists om_creators_enabled_idx  on om_creators(enabled);

-- ── 콘텐츠(소재 = 메타광고의 am_ads 격) ──
create table if not exists om_posts (
  post_id       text primary key,                      -- 플랫폼 prefix 키: 'yt_<videoId>' | 'ig_<shortcode>'
  creator_id    uuid references om_creators(id) on delete cascade,
  creator_name  text,                                  -- 비정규화(AI/표시 폴백용)
  platform      text not null default 'youtube',       -- 'youtube' | 'instagram'
  post_url      text,                                  -- 원본 콘텐츠 URL
  caption       text,                                  -- 제목/캡션(= ad_text 격)
  media_type    text,                                  -- 'video' | 'slide' | 'image'
  media_url     text,                                  -- 대표 미디어(영상 파일 또는 임베드 URL)
  media_urls    jsonb,                                 -- 슬라이드(캐러셀) 여러 장
  poster_url    text,                                  -- 썸네일/포스터
  frames        jsonb,                                 -- 영상 프레임 URL 배열(추출 시)
  posted_at     text,                                  -- 게시일(= started_on 격, 표시용 문자열)

  -- 지표(공개 안 한 크리에이터는 null → UI 에서 '—' 표기)
  views         bigint,
  likes         bigint,
  comments      bigint,
  shares        bigint,
  saves         bigint,

  memo          text,
  ai_analysis   text,
  transcript    text,
  saved         boolean not null default false,        -- 스와이프(즐겨찾기)

  status        text not null default 'active',        -- 'active' | 'ended'(더 이상 안 보임/삭제됨)
  ended_at      timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz
);

create index if not exists om_posts_creator_idx   on om_posts(creator_id);
create index if not exists om_posts_platform_idx  on om_posts(platform);
create index if not exists om_posts_status_idx    on om_posts(status);
create index if not exists om_posts_first_seen_idx on om_posts(first_seen_at desc);

-- ── RLS: 서버(service_role)만 접근. 브라우저(anon)는 차단 → 격리.
--    페이지는 /api/owned-media/* (supabaseAdmin) 로만 읽고 쓴다.
alter table om_creators enable row level security;
alter table om_posts    enable row level security;
-- 정책을 만들지 않음 = anon/authenticated 전부 차단(service_role 은 RLS 우회).

-- ── 미디어 보관용 공개 스토리지 버킷(프레임/썸네일 영구 저장 시) ──
insert into storage.buckets (id, name, public)
values ('owned-media', 'owned-media', true)
on conflict (id) do nothing;

drop policy if exists "Public read owned-media" on storage.objects;
drop policy if exists "Auth manage owned-media" on storage.objects;

create policy "Public read owned-media" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'owned-media');

create policy "Auth manage owned-media" on storage.objects
  for all to authenticated
  using (bucket_id = 'owned-media')
  with check (bucket_id = 'owned-media');
