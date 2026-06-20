-- 브랜드별 광고 수를 DB 안에서 한 번에 집계하는 함수(RPC).
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 한 번이면 됩니다.
-- (없어도 앱은 동작합니다. 실행하면 메타광고 크롤러 진입 속도가 더 빨라집니다 — 행 전송 없이 서버에서 집계.)

create or replace function am_ad_counts()
returns table (target_id uuid, n bigint)
language sql
stable
as $$
  select target_id, count(*)::bigint as n
  from am_ads
  where target_id is not null
  group by target_id
$$;

-- 앱(서버 라우트)은 service_role 로 호출하므로 별도 grant 불필요.
-- 혹시 다른 역할에서도 쓰려면:
-- grant execute on function am_ad_counts() to anon, authenticated;
