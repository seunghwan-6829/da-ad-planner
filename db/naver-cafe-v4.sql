-- 네이버 카페 자동화 v4 — Supabase SQL Editor 에서 1회 실행(멱등, 여러 번 해도 안전).
--   ① 발행 전 미리보기 확인   ② 자동 중단(서킷 브레이커)   ③ 중복 발행 방지
--   ⑤ 일괄 승인/반려          ⑥ 발행 결과 알림             ⑦ 예약 발행
--   ⑧ 에이전트 상태 상세
-- (④ NC_AGENT_TOKEN 은 코드 변경 없이 환경변수만 넣으면 되는 항목이라 여기 없음)

-- ── ① 발행 전 미리보기 ─────────────────────────────────────────────
-- 에이전트가 글쓰기 화면을 다 채운 뒤 등록을 누르기 직전에 화면을 캡처해 올린다.
-- 사람이 웹에서 '이대로 등록'을 눌러야 실제로 등록된다.
alter table public.nc_posts add column if not exists preview_url text;
alter table public.nc_posts add column if not exists preview_at timestamptz;
-- 'approve' = 등록 진행, 'cancel' = 취소하고 승인 상태로 되돌리기, null = 아직 결정 안 함
alter table public.nc_posts add column if not exists preview_decision text;

comment on column public.nc_posts.preview_url is '등록 직전 글쓰기 화면 캡처. 사람이 확인하고 결정한다.';

-- status 에 'preview' 추가 (제약이 있으면 다시 만든다)
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'nc_posts_status_check') then
    alter table public.nc_posts drop constraint nc_posts_status_check;
  end if;
  alter table public.nc_posts add constraint nc_posts_status_check
    check (status in ('draft','approved','queued','publishing','preview','published','rejected','failed','saved'));
end $$;

-- ── ③ 중복 발행 방지용 인덱스 ──────────────────────────────────────
-- 같은 카페에 최근 N일 내 비슷한 제목이 이미 나갔는지 빠르게 본다.
create index if not exists nc_posts_dup_idx on public.nc_posts (cafe_id, status, published_at desc);

-- ── ⑦ 예약 발행 ────────────────────────────────────────────────────
-- not_before 는 이미 있다(에이전트가 이 시각 전에는 안 집어간다). 조회만 빠르게.
create index if not exists nc_posts_notbefore_idx on public.nc_posts (status, not_before);

-- ── ②⑧ 에이전트 상태 ───────────────────────────────────────────────
-- 연속 실패로 스스로 멈췄는지, 마지막으로 무슨 일이 있었는지 기록한다.
alter table public.nc_agent add column if not exists halted boolean not null default false;
alter table public.nc_agent add column if not exists halt_reason text;
alter table public.nc_agent add column if not exists halted_at timestamptz;
alter table public.nc_agent add column if not exists fail_streak int not null default 0;
alter table public.nc_agent add column if not exists last_event text;      -- 사람이 읽는 최근 동작
alter table public.nc_agent add column if not exists last_event_at timestamptz;

comment on column public.nc_agent.halted is '연속 실패로 자동 중단된 상태. 웹에서 재개를 눌러야 다시 돈다.';

-- ── 설정(운영 옵션) ────────────────────────────────────────────────
-- nc_settings 는 싱글턴(id=1). pacing 은 그대로 두고 options 만 추가한다.
alter table public.nc_settings add column if not exists options jsonb not null default '{}'::jsonb;

update public.nc_settings
set options = coalesce(options, '{}'::jsonb) || jsonb_build_object(
  'preview_before_publish', true,   -- ① 등록 직전 사람 확인(첫 발행 안전장치). 익숙해지면 끄면 된다.
  'halt_after_failures',    2,      -- ② 연속 N회 실패하면 자동 중단
  'dup_window_days',        14,     -- ③ 최근 N일 안에
  'dup_similarity',         0.6     -- ③ 제목 유사도 이 값 이상이면 중복으로 보고 보류
)
where id = 1
  and not (options ? 'preview_before_publish');

-- ── ① 미리보기 캡처 저장 버킷 ──────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('naver-cafe', 'naver-cafe', true)
on conflict (id) do nothing;
