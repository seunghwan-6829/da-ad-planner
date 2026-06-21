-- 메타 광고 크롤러 브랜드(am_targets)를 기획안 제작의 클라이언트(clients)에 매핑.
-- 한 브랜드가 여러 클라이언트에 속할 수 있어 배열로 저장(중복 허용).
-- Supabase SQL Editor 에서 1회 실행.
alter table am_targets add column if not exists client_ids uuid[] default '{}';

-- 클라이언트 필터 조회 가속(선택): 배열 포함 검색용 GIN 인덱스
create index if not exists am_targets_client_ids_idx on am_targets using gin (client_ids);
