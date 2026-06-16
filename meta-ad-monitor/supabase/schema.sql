-- Ad Monitor 스키마. 접두사 am_ 라서 기존 Supabase 프로젝트에 그대로 추가해도
-- 다른 테이블과 충돌하지 않습니다. (새 프로젝트 X = 추가 비용 X)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.

create table if not exists am_targets (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  category    text,                 -- 대분류 (예: 화장품, 식품, 패션)
  type        text not null default 'page' check (type in ('page', 'keyword')),
  page_id     text,
  query       text,
  country     text not null default 'KR',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
-- 기존에 이미 테이블이 있던 경우를 위해(create if not exists 는 컬럼 추가 안 함):
alter table am_targets add column if not exists category text;

create table if not exists am_ads (
  library_id     text primary key,
  target_id      uuid references am_targets(id) on delete set null,
  page_name      text,
  started_on     text,
  ad_text        text,
  media_type     text,
  media_url      text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
create index if not exists am_ads_target_idx     on am_ads(target_id);
create index if not exists am_ads_first_seen_idx  on am_ads(first_seen_at desc);

create table if not exists am_health_checks (
  id               bigserial primary key,
  ran_at           timestamptz not null default now(),
  target_id        uuid,
  extracted_count  int,
  status           text
);

-- RLS는 켜두되 정책을 안 만듭니다. 크롤러(GitHub Actions)와 대시보드(Next.js API)는
-- service_role 키로 접근해 RLS를 우회하므로, anon 키로는 이 테이블에 접근 불가 = 안전.
alter table am_targets       enable row level security;
alter table am_ads           enable row level security;
alter table am_health_checks enable row level security;

-- 시드: 처음 추적할 브랜드 1개 (대시보드에서 추가/삭제/편집 가능)
insert into am_targets (label, category, type, page_id, country)
values ('브랜드-388683458358702', '미분류', 'page', '388683458358702', 'KR')
on conflict do nothing;
