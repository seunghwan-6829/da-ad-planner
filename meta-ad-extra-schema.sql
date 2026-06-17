-- =============================================
-- 메타 광고 크롤러 확장 스키마
-- (캐러셀 / 광고 상태(활성·종료) / 메모 / 랜딩 / 브랜드 프로필)
-- Supabase SQL Editor 에서 1회 실행. 기존 데이터는 보존됩니다.
-- =============================================

-- 광고(am_ads) 확장
alter table am_ads add column if not exists media_urls jsonb;                       -- 캐러셀: 여러 장 이미지 URL 배열
alter table am_ads add column if not exists landing_url text;                       -- 랜딩 페이지(클릭 시 이동) URL
alter table am_ads add column if not exists status text not null default 'active';  -- 'active' | 'ended'(더 이상 안 보임)
alter table am_ads add column if not exists ended_at timestamptz;                   -- 사라진(종료) 감지 시점
alter table am_ads add column if not exists memo text;                              -- 사용자 메모

-- 브랜드(am_targets) 확장
alter table am_targets add column if not exists profile_image text;                 -- 메타 광고주 프로필 사진 URL
alter table am_targets add column if not exists profile_name text;                  -- 메타에 표시되는 실제 광고주명

create index if not exists am_ads_status_idx on am_ads(status);
