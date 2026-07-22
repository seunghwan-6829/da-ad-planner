-- 네이버 카페: '지금 바로 발행' 기능 — Supabase SQL Editor 에서 1회 실행(멱등).
--
-- 평소 발행은 페이스 규칙(활동시간 9~23시 · 일 글2/댓8 · 카페 주2 · 간격 25~90분)을 지켜
-- 계정 밴을 피한다. 하지만 테스트하거나 급히 하나 올릴 때는 그 대기를 건너뛰고 싶다.
-- force_publish=true 인 글은 그 게이트를 "이 한 건에 한해" 통과한다.
--
-- ⚠️ 남용하면 계정 위험이 올라간다. 화면에서도 경고하고, 발행되면 자동으로 false 로 내려간다.

alter table public.nc_posts add column if not exists force_publish boolean not null default false;

comment on column public.nc_posts.force_publish is
  '지금 바로 발행 — 페이스 게이트를 이 글 하나만 건너뛴다. 발행/실패 시 서버가 false 로 되돌린다.';

-- 에이전트가 우선 배정 대상을 빨리 찾도록.
create index if not exists nc_posts_force_idx on public.nc_posts (force_publish, status)
  where force_publish = true;
