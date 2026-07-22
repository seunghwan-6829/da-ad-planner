-- 등록 직전 확인 보강 — Supabase SQL Editor 에서 1회 실행(멱등).
--
-- 캡처 이미지는 스크롤·레이아웃에 따라 위아래가 잘려 보일 수 있어서, 확인이 반쪽이 된다.
-- 그래서 "에디터에 실제로 들어간 글자"를 그대로 저장해 웹에서 전문을 읽을 수 있게 한다.
-- 원문(title/body)과 비교하면 타이핑이 중간에 씹혔는지도 바로 드러난다.

alter table public.nc_posts add column if not exists typed_title text;
alter table public.nc_posts add column if not exists typed_body  text;

comment on column public.nc_posts.typed_body is
  '등록 직전 에디터에서 그대로 읽어온 본문. 캡처가 잘려도 전체를 확인할 수 있게 하는 안전장치.';
