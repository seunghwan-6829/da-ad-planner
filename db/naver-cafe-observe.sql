-- 네이버 카페 자동화: 카페 관찰 데이터 (재실행해도 안전 — 언제든 다시 실행 가능)
-- Supabase SQL Editor 에서 실행.
--
-- 워커(노트북)가 각 발행처 게시판에 하루 2번 들러 "실제로 올라오는 글"을 수집해 쌓는다.
--   · 원고 생성 시 이 카페의 말투·소재 결을 참고(따라 쓰지는 않음 — 생성 단계에서 유사도 차단)
--   · 수집 24시간 뒤 자동 평가(조회·댓글 증가폭) → 잘 나온 글만 원고 소재로 사용
--   · 광고/상업글은 자동 판별해 소재에서 제외(단, 데이터는 지우지 않고 보존 — 화면에서 확인 가능)
create table if not exists nc_cafe_posts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null,
  title text not null,
  article_id text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  unique (cafe_id, title)
);
create index if not exists idx_nc_cafe_posts_cafe_time on nc_cafe_posts (cafe_id, last_seen desc);

-- 인기글 수집: 카페 인기글 페이지 + 목록의 조회·댓글 수(최신값).
alter table nc_cafe_posts add column if not exists views integer;
alter table nc_cafe_posts add column if not exists comments integer;
alter table nc_cafe_posts add column if not exists is_popular boolean default false;

-- ── 24시간 후 재측정·평가(2026-08-05) ──
-- 첫 관측치(기준선) — 한 번 기록되면 이후 방문에서 절대 덮어쓰지 않는다. 증가폭 = 최신값 - 첫 관측치.
alter table nc_cafe_posts add column if not exists views_first integer;
alter table nc_cafe_posts add column if not exists comments_first integer;
alter table nc_cafe_posts add column if not exists first_metric_at timestamptz;
-- 평가 결과
alter table nc_cafe_posts add column if not exists views_delta integer;      -- 24h 조회 증가
alter table nc_cafe_posts add column if not exists comments_delta integer;   -- 24h 댓글 증가
alter table nc_cafe_posts add column if not exists score integer;            -- 반응 점수(조회증가 + 댓글증가*30)
alter table nc_cafe_posts add column if not exists verdict text default 'pending';
  -- pending(측정 중) | keep(반응 좋음) | drop(반응 낮음) | ad(광고·상업글) | noise(공지·등업 등 잡글) | unrated(측정 불가)
alter table nc_cafe_posts add column if not exists verdict_reason text;      -- 왜 그렇게 판정했는지(사람이 확인용)
alter table nc_cafe_posts add column if not exists is_ad boolean default false;
alter table nc_cafe_posts add column if not exists evaluated_at timestamptz;

-- 평가 대기 조회용(평가 크론이 매시각 훑는다)
create index if not exists idx_nc_cafe_posts_verdict on nc_cafe_posts (verdict, first_metric_at);

-- 마이그레이션 전 수집분: 기준선이 없어 증가폭을 못 낸다 → 'unrated' 로 표시해 평가 큐에서 빼고,
-- 대신 인기글로 잡혔던 것들은 그대로 소재 후보로 남는다(is_popular 폴백).
update nc_cafe_posts
   set verdict = 'unrated',
       verdict_reason = '측정 시작(2026-08-05) 이전 수집분 — 증가폭 기준선 없음'
 where (verdict is null or verdict = 'pending')
   and first_metric_at is null;

-- 서버(service_role)만 접근 — 브라우저 anon 직접 접근 차단.
alter table nc_cafe_posts enable row level security;
