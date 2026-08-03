import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildOverviewData } from "@/lib/pb/overview-data";

/* AI 주간 진단 리포트 — 최근 7일 데이터(브랜드별 요약) + 거시 흐름(계절·소비심리·경기) + 최신 뉴스(웹 검색)로
   "이번 주가 왜 이랬는지"를 진단하고 다음 주 액션까지 제안한다.
   - 키: 사용자 본인 Anthropic 키(x-user-api-key, aiFetch) — 기존 AI 라우트와 동일 방식.
   - 토큰 안전: 입력은 원시 이벤트가 아니라 '집계 요약 JSON'만(사이트당 숫자 십수 개), 출력은 max_tokens 3000 + 분량 지시.
   - 웹 검색: Anthropic 서버 도구(web_search)로 이번 주 한국 소비/커머스 뉴스를 실제로 확인해 근거로 인용.
     (키/모델이 웹 검색을 지원하지 않으면 자동으로 검색 없이 재시도)
   - 저장: pb_weekly_reports 테이블(마이그레이션 db/pb-replays.sql). 테이블이 없으면 저장만 건너뛰고 리포트는 반환.
   GET → 최근 리포트 1건 / POST → 새로 생성 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("pb_weekly_reports")
    .select("id, week_key, content, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: true, report: null, tableMissing: true });
  return NextResponse.json({ ok: true, report: data ?? null });
}

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "마이페이지에서 Anthropic API 키를 입력해야 리포트를 생성할 수 있어요." }, { status: 401 });
  }

  const overview = await buildOverviewData();
  if (!overview.sites.length) {
    return NextResponse.json({ ok: false, error: "집계할 프로젝트가 없어요." }, { status: 400 });
  }

  // 프롬프트 입력용 압축 요약(사이트당 숫자 십수 개 → 전체 수천 토큰 이내).
  const compact = {
    기간: `${overview.range.start} ~ ${overview.range.end}`,
    비교기간: `${overview.range.prevStart} ~ ${overview.range.prevEnd}`,
    전체: overview.totals,
    브랜드별: overview.sites.map((s) => ({
      이름: s.name,
      도메인: s.domain,
      방문자: s.visitors,
      지난주방문자: s.prev.visitors,
      페이지뷰: s.pageViews,
      지난주페이지뷰: s.prev.pageViews,
      평균체류초: s.avgStaySeconds,
      지난주평균체류초: s.prev.avgStaySeconds,
      이탈률: s.bounceRate,
      주유입경로: s.topReferrer,
      주기기: s.deviceTop,
      많이본페이지: s.topPages.map((p) => `${p.url}(${p.views})`).join(", "),
    })),
  };

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const prompt = `너는 퍼포먼스 마케팅 대행사의 시니어 데이터 분석가다. 아래는 우리가 추적 중인 고객사 사이트들의 최근 7일 vs 이전 7일 요약 데이터다.

오늘 날짜: ${today} (계절·시기 맥락을 반드시 반영)

[추적 데이터 요약]
${JSON.stringify(compact, null, 1)}

위 데이터로 '주간 진단 리포트'를 한국어 마크다운으로 작성해라.

[웹 검색 지시]
- 웹 검색으로 "이번 주 한국 소비/커머스/광고 시장" 관련 최신 뉴스·지표(소비심리, 시즌 이슈, 경기 흐름)를 2~3건 확인하고, 리포트의 '거시 요인' 근거로 짧게 인용해라(매체·날짜 표기).
- 검색은 최대 3회만. 못 찾으면 일반적인 계절·경기 상식으로 대신하되 '추정'이라고 표시.

[리포트 구성 — 이 순서 그대로, 전체 1,300자 이내로 간결하게]
## 이번 주 총평
- 전체 방문·체류 흐름 두세 문장. 수치는 데이터에 있는 것만.
## 브랜드별 진단
- 브랜드마다 딱 한 줄: **이름** — 핵심 변화(↑↓%)와 원인 추정 한 마디. 전 브랜드 포함.
## 왜 이런 흐름인가
- 내부 요인(데이터에서 보이는 것: 유입경로 변화, 특정 페이지 쏠림, 이탈률 등) 2~3개
- 거시 요인(계절/소비심리/경기/뉴스 — 웹 검색 근거 인용) 2~3개. 예: 여름 휴가철 소비 위축 같은 시기 요인.
## 다음 주 액션 3가지
- 구체적이고 바로 실행 가능한 것만(어느 브랜드의 무엇을 어떻게).

규칙: 과장 금지, 데이터에 없는 수치 창작 금지, 방문자가 매우 적은 브랜드(주 10명 미만)는 "표본 적음"을 명시하고 과대해석하지 말 것.`;

  async function callClaude(useSearch: boolean) {
    const body: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    return fetch(ANTHROPIC_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey as string, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
  }

  try {
    let res = await callClaude(true);
    if (!res.ok) {
      // 웹 검색 미지원(키/모델/권한) 등이면 검색 없이 한 번 더 — 리포트 자체는 항상 나오게.
      res = await callClaude(false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data?.error?.message ?? "Anthropic API 오류" }, { status: res.status });
    }
    const content = Array.isArray(data.content)
      ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim()
      : "";
    if (!content) return NextResponse.json({ ok: false, error: "리포트 생성 결과가 비어 있어요." }, { status: 502 });

    // 저장(테이블 없으면 건너뛰고 리포트만 반환 — 마이그레이션 전에도 기능은 동작)
    let saved = false;
    const { error: insErr } = await supabaseAdmin
      .from("pb_weekly_reports")
      .insert({ week_key: overview.range.end, content, stats: compact });
    if (!insErr) saved = true;

    return NextResponse.json({ ok: true, report: { week_key: overview.range.end, content, created_at: new Date().toISOString() }, saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 생성 실패" }, { status: 500 });
  }
}
