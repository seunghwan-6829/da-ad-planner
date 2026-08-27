/* 크롤러 캡션 정리 — 메타·구글 크롤러가 공유한다.
   스크랩한 ad_text 에는 화면 오른쪽 메타데이터와 겹치는 보일러플레이트(활성/라이브러리ID/게재시작/플랫폼/CTA)가
   섞여 들어온다. 그걸 걷어내고 실제 제목·캡션만 남긴다.
   (2026-08-12 점검: 두 페이지에 완전히 같은 구현이 각각 있었다 → 한 곳으로) */

const CAPTION_DROP = [
  /^활성$/, /^비활성$/, /게재\s*중단/,
  /^라이브러리\s*ID/i, /^library\s*id/i,
  /게재\s*시작(함|일)/, /^started running/i,
  /^플랫폼$/, /^platforms?$/i,
  /^드롭다운/, /드롭다운\s*열기/, /^see ad details$/i, /광고\s*상세\s*정보\s*보기/,
  /여러\s*버전이\s*있는\s*광고/i, /multiple versions/i,
  /^광고$/, /^sponsored$/i,
  /^(learn more|shop now|sign up|book now|order now|get offer|download|더\s*알아보기|자세히\s*알아보기|지금\s*구매하기|구매하기|신청하기|문의하기|예약하기|주문하기|앱\s*설치하기|지금\s*받기|쇼핑하기)$/i,
];

export function cleanCaption(text: string | null | undefined, brandName: string): string {
  if (!text) return "—";
  const lines = text
    .replace(/[​-‍⁠﻿ ]/g, " ") // 제로폭/비가시 공백 → 일반 공백
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === brandName) continue;
    if (CAPTION_DROP.some((re) => re.test(l))) continue;
    // 광고주명 라인(바로 다음 줄이 '광고'/'Sponsored') 제거
    if (i + 1 < lines.length && /^(광고|sponsored)$/i.test(lines[i + 1])) continue;
    kept.push(l);
  }
  return kept.join("\n").trim() || "—";
}
