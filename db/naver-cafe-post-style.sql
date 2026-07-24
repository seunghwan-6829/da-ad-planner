-- 네이버 카페 발행처: '글 방향'(정보/질문/일상) 설정 컬럼.
-- 운영 설정에서 버튼으로 고르면 그 방향의 글 유형(아키타입)으로만 원고를 쓴다.
-- 값: 'auto'(전체 섞기, 기본) | 'info'(정보·꿀팁) | 'question'(질문·고민) | 'casual'(일상·잡담)
-- 멱등 — 여러 번 실행해도 안전.
alter table if exists nc_cafes
  add column if not exists post_style text not null default 'auto';
