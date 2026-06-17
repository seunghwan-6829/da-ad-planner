-- =============================================
-- 메타 광고 소재 "다운로드 보관" (영구 저장 + 영상 프레임)
-- Supabase SQL Editor 에서 1회 실행. 재실행해도 안전.
-- =============================================

-- am_ads: 보관/프레임 관련 컬럼
alter table am_ads add column if not exists media_path  text;                       -- 스토리지 경로 prefix(정리용)
alter table am_ads add column if not exists poster_url  text;                       -- 영상 포스터(썸네일) URL
alter table am_ads add column if not exists frames      jsonb;                      -- 영상에서 추출한 프레임 URL 배열
alter table am_ads add column if not exists downloaded  boolean not null default false; -- 우리 스토리지로 보관 완료 여부

-- 공개 스토리지 버킷
insert into storage.buckets (id, name, public)
values ('meta-ad-media', 'meta-ad-media', true)
on conflict (id) do nothing;

-- 정책: 공개 읽기 + 인증 사용자 관리(크롤러는 service_role 로 RLS 우회해 업로드)
drop policy if exists "Public read meta-ad-media" on storage.objects;
drop policy if exists "Auth manage meta-ad-media" on storage.objects;

create policy "Public read meta-ad-media" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'meta-ad-media');

create policy "Auth manage meta-ad-media" on storage.objects
  for all to authenticated
  using (bucket_id = 'meta-ad-media')
  with check (bucket_id = 'meta-ad-media');
