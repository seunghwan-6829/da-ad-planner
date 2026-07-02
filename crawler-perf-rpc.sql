-- =============================================
-- 크롤러 진입속도 최적화 — 광고주/크리에이터별 개수를 DB 안에서 한 번에 집계하는 RPC 3종.
--   (없으면 앱은 "전체 행을 다 긁어 세는" 느린 폴백으로 동작 → 데이터 쌓일수록 진입이 느려짐)
--   Supabase SQL Editor 에 붙여넣고 RUN 한 번. 재실행해도 안전.
-- =============================================

-- 메타 광고 (이미 실행돼 있으면 그대로 갱신)
create or replace function am_ad_counts()
returns table (target_id uuid, n bigint)
language sql stable as $$
  select target_id, count(*)::bigint as n
  from am_ads where target_id is not null group by target_id
$$;

-- 구글 광고
create or replace function ga_ad_counts()
returns table (target_id uuid, n bigint)
language sql stable as $$
  select target_id, count(*)::bigint as n
  from ga_ads where target_id is not null group by target_id
$$;

-- 온드미디어
create or replace function om_post_counts()
returns table (creator_id uuid, n bigint)
language sql stable as $$
  select creator_id, count(*)::bigint as n
  from om_posts where creator_id is not null group by creator_id
$$;

-- 최신순 첫 화면(order by first_seen_at desc limit 300)·그룹 집계용 인덱스(없으면 생성).
create index if not exists am_ads_first_seen_idx on am_ads(first_seen_at desc);
create index if not exists am_ads_target_idx     on am_ads(target_id);
create index if not exists ga_ads_first_seen_idx on ga_ads(first_seen_at desc);
create index if not exists ga_ads_target_idx     on ga_ads(target_id);
create index if not exists om_posts_first_seen_idx on om_posts(first_seen_at desc);
create index if not exists om_posts_creator_idx    on om_posts(creator_id);

-- 앱(서버 라우트)은 service_role 로 호출하므로 별도 grant 불필요.
