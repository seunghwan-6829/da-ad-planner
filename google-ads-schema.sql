-- =============================================
-- 구글 광고 크롤러 (구글 광고 투명성 센터 — 검색/유튜브/디스플레이 광고 추적)
--   메타 광고 크롤러(am_targets/am_ads)와 동일 패턴, 완전 격리된 ga_ 접두 테이블.
--   컬럼명은 페이지/AI 연동 호환을 위해 am_ 과 최대한 동일하게 유지.
--   Supabase SQL Editor 에서 1회 실행. 재실행해도 안전(idempotent).
-- =============================================

-- ── 광고주(추적 대상 = 메타광고의 am_targets 격) ──
create table if not exists ga_targets (
  id            uuid primary key default gen_random_uuid(),
  label         text not null default '(이름없음)',   -- 사용자가 입력한 광고주 이름
  category      text not null default '미분류',        -- 대분류
  advertiser_id text,                                  -- 투명성 센터 광고주 ID (AR...)
  country       text not null default 'KR',            -- 지역(region) 필터
  enabled       boolean not null default true,
  profile_image text,                                  -- (선택) 로고 URL
  profile_name  text,                                  -- 투명성 센터 표기 광고주명
  summary       text,                                  -- AI 한 줄 요약
  client_ids    uuid[] default '{}',                   -- 기획안 제작 클라이언트 매핑
  created_at    timestamptz not null default now()
);

create index if not exists ga_targets_enabled_idx on ga_targets(enabled);

-- ── 광고(소재 = 메타광고의 am_ads 격) ──
create table if not exists ga_ads (
  library_id    text primary key,                      -- 구글 creativeId (CR...)
  target_id     uuid references ga_targets(id) on delete cascade,
  page_name     text,                                  -- advertiserName(비정규화)
  started_on    text,                                  -- 첫 게재일(firstShown)
  last_shown    text,                                  -- 마지막 게재일(lastShown)
  ad_text       text,                                  -- 카피(변형 description/CTA/OCR 취합)
  media_type    text,                                  -- 'video' | 'image' | 'carousel' | 'text'
  media_url     text,                                  -- 대표 미디어(저장 mp4 또는 이미지)
  media_urls    jsonb,                                 -- 변형(A/B) 이미지 여러 장
  poster_url    text,                                  -- 썸네일/포스터
  frames        jsonb,                                 -- 영상 프레임(추출 시)
  landing_url   text,                                  -- 랜딩(clickUrl)
  source_url    text,                                  -- 투명성 센터 원본 링크(adLibraryUrl)
  format        text,                                  -- 원본 포맷(TEXT/IMAGE/VIDEO)
  regions       jsonb,                                 -- 지역별 노출 요약(regionStats)
  video_src_url text,                                  -- 원본 영상 소스(유튜브 등)

  status        text not null default 'active',        -- 'active' | 'ended'
  ended_at      timestamptz,
  memo          text,
  saved         boolean not null default false,        -- 스와이프(즐겨찾기)
  ai_analysis   text,
  transcript    text,
  media_path    text,                                  -- 스토리지 경로 prefix(정리용)
  downloaded    boolean not null default false,        -- 스토리지 보관 완료 여부
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz
);

create index if not exists ga_ads_target_idx     on ga_ads(target_id);
create index if not exists ga_ads_status_idx     on ga_ads(status);
create index if not exists ga_ads_first_seen_idx on ga_ads(first_seen_at desc);

-- ── RLS: 서버(service_role)만 접근. 브라우저(anon) 차단 → /api/google-ads/* 로만 읽고 씀.
alter table ga_targets enable row level security;
alter table ga_ads     enable row level security;
-- 정책 없음 = anon/authenticated 전부 차단(service_role 은 RLS 우회).

-- ── 미디어 영구 보관용 공개 스토리지 버킷 ──
insert into storage.buckets (id, name, public)
values ('google-ad-media', 'google-ad-media', true)
on conflict (id) do nothing;

drop policy if exists "Public read google-ad-media" on storage.objects;
drop policy if exists "Auth manage google-ad-media" on storage.objects;

create policy "Public read google-ad-media" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'google-ad-media');

create policy "Auth manage google-ad-media" on storage.objects
  for all to authenticated
  using (bucket_id = 'google-ad-media')
  with check (bucket_id = 'google-ad-media');
