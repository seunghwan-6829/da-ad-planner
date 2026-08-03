import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildOverviewData, type OverviewRange } from "@/lib/pb/overview-data";

/* AI 주간 진단 리포트 생성 엔진 — 크론(/api/pb/weekly-report/cron)과 API(POST)가 공유.
   내부 데이터(브랜드별 요약) + 거시 흐름(계절·소비심리·경기) + 최신 뉴스(Anthropic 웹 검색)로
   "왜 이런 흐름인지"를 진단. 웹 검색이 안 되는 키/모델이면 자동으로 검색 없이 재시도.
   토큰 안전: 입력은 집계 요약 JSON 만, 출력 max_tokens 3000 + 분량 지시. */

const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export type GeneratedReport = { week_key: string; content: string; created_at: string; saved: boolean };

export async function generateWeeklyReport(
  apiKey: string,
  range?: OverviewRange,
  periodNote?: string, // 예: "지난주(월~일) 마감 리포트"
): Promise<GeneratedReport> {
  const overview = await buildOverviewData(range);
  if (!overview.sites.length) throw new Error("집계할 프로젝트가 없어요.");

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
  const prompt = `너는 퍼포먼스 마케팅 대행사의 시니어 데이터 분석가다. 아래는 우리가 추적 중인 고객사 사이트들의 ${periodNote || "최근 7일 vs 이전 7일"} 요약 데이터다.

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
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
  }

  let res = await callClaude(true);
  if (!res.ok) res = await callClaude(false); // 웹 검색 미지원 폴백 — 리포트는 항상 나오게
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Anthropic API 오류");

  const content = Array.isArray(data.content)
    ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim()
    : "";
  if (!content) throw new Error("리포트 생성 결과가 비어 있어요.");

  const weekKey = overview.range.end;
  let saved = false;
  const { error: insErr } = await supabaseAdmin
    .from("pb_weekly_reports")
    .insert({ week_key: weekKey, content, stats: compact });
  if (!insErr) saved = true;

  return { week_key: weekKey, content, created_at: new Date().toISOString(), saved };
}

// 해당 주(week_key) 리포트가 이미 있는지 — 크론 멱등 가드(익명 반복 호출로 토큰이 새는 걸 막는 핵심).
export async function reportExists(weekKey: string): Promise<{ exists: boolean; tableMissing: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("pb_weekly_reports")
    .select("id")
    .eq("week_key", weekKey)
    .limit(1)
    .maybeSingle();
  if (error) return { exists: false, tableMissing: true };
  return { exists: !!data, tableMissing: false };
}
