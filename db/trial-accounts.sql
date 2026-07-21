-- 체험 계정(1일/7일) — Supabase SQL Editor 에서 1회 실행. 여러 번 실행해도 안전(멱등).
--
-- 관리자가 대시보드에서 아이디/비밀번호를 발급해 외부인에게 "써보라고" 주는 용도.
-- 허용: 크롤러 3종(메타·구글·온드미디어) 열람 + 소재에서 기획 마인드맵/AI 분석.
-- 차단: 네이버 카페 자동화, 기획안 제작, 데이터 추적, 인스타 성과, 관리자.
-- 광고주(크롤링 대상) 추가·수정·삭제도 불가 — 열람만.
--
-- 실제 차단은 middleware.ts(서버)가 담당하고, 이 SQL 은 역할·만료 저장과
-- 마인드맵 데이터 격리(RLS)를 담당한다.

-- ── 1) 체험 계정 메타데이터 ──────────────────────────────────────────
alter table public.user_profiles add column if not exists trial_expires_at timestamptz;
alter table public.user_profiles add column if not exists trial_label text;      -- 누구에게 줬는지 메모
alter table public.user_profiles add column if not exists issued_by uuid;        -- 발급한 관리자

comment on column public.user_profiles.trial_expires_at is '체험 계정 만료 시각. 지나면 로그인해도 아무것도 못 본다.';

-- role 은 CHECK 제약이 없어 'trial' 을 그대로 쓴다(확인함). 만료 조회용 인덱스만 추가.
create index if not exists user_profiles_trial_idx on public.user_profiles (role, trial_expires_at);

-- ── 2) 역할 판정 헬퍼(RLS 에서 사용) ─────────────────────────────────
-- security definer: RLS 재귀를 피하려면 user_profiles 를 정책 밖에서 읽어야 한다.
create or replace function public.cd_is_trial()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'trial'
  );
$$;

create or replace function public.cd_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.cd_is_trial() to authenticated;
grant execute on function public.cd_is_admin() to authenticated;

-- ── 3) 기획 마인드맵 격리 ────────────────────────────────────────────
-- 체험 계정은 "자기가 만든 것만" 보이게 한다. 기존 정책을 건드리지 않고
-- RESTRICTIVE 정책을 하나 얹는다(기존 permissive 정책들과 AND 로 결합).
--   → 체험 계정이 아니면 조건이 참이라 기존 동작 그대로. 회귀 위험 없음.
drop policy if exists plan_mindmaps_trial_isolation on public.plan_mindmaps;
create policy plan_mindmaps_trial_isolation
  on public.plan_mindmaps
  as restrictive
  for all
  to authenticated
  using (not public.cd_is_trial() or created_by = auth.uid())
  with check (not public.cd_is_trial() or created_by = auth.uid());

-- ── 4) 만료된 체험 계정 정리용 뷰(관리 화면에서 조회) ────────────────
create or replace view public.cd_trial_accounts as
  select
    id, email, name, trial_label, trial_expires_at, issued_by, created_at,
    (trial_expires_at is not null and trial_expires_at <= now()) as expired,
    greatest(0, extract(epoch from (trial_expires_at - now()))) as seconds_left
  from public.user_profiles
  where role = 'trial';

-- 뷰는 서버(service_role)에서만 읽는다. authenticated 에는 권한을 주지 않는다.
revoke all on public.cd_trial_accounts from anon, authenticated;
