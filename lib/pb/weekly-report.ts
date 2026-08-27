import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildOverviewData, type OverviewRange } from "@/lib/pb/overview-data";
import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

/* AI 주간 진단 리포트 생성 엔진 — 크론(/api/pb/weekly-report/cron)과 API(POST)가 공유.
   내부 데이터(브랜드별 요약) + 거시 흐름(계절·소비심리·경기) + 최신 뉴스(Anthropic 웹 검색)로
   "왜 이런 흐름인지"를 진단. 웹 검색이 안 되는 키/모델이면 자동으로 검색 없이 재시도.
   토큰 안전: 입력은 집계 요약 JSON 만, 출력 max_tokens 3000 + 분량 지시. */

const MODEL = MODELS.standard;

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
  /* 출력은 마크다운이 아니라 '구조화 JSON'만 받는다 — 표·상태등·차트·액션 카드는 화면이 직접
     인포그래픽으로 그린다(AI 가 쓴 마크다운 표가 그대로 노출돼 읽기 힘들던 문제의 근본 해결). */
  const prompt = `너는 퍼포먼스 마케팅 대행사의 시니어 데이터 분석가다. 아래는 우리가 추적 중인 고객사 사이트들의 ${periodNote || "최근 7일 vs 이전 7일"} 요약 데이터다.

오늘 날짜: ${today} (계절·시기 맥락을 반드시 반영)

[추적 데이터 요약]
${JSON.stringify(compact, null, 1)}

[웹 검색 지시]
- 웹 검색으로 "이번 주 한국 소비/커머스/광고 시장" 관련 최신 뉴스·지표(소비심리, 시즌 이슈, 경기 흐름)를 2~3건 확인하고 macro 항목의 근거로 인용해라(source 에 매체·날짜, url 에 링크).
- 검색은 최대 3회만. 못 찾으면 일반적인 계절·경기 상식으로 대신하되 point 문장에 '(추정)'을 붙여라.

[출력 — 아래 형식의 "완결된 JSON" 하나만. 마크다운·설명·코드펜스 금지]
{"headline":"이번 주 전체 상황 한 줄(핵심 수치 포함, 40자 내외)",
"overview":"이번 주 총평 2~3문장(전체 방문·체류 흐름, 데이터에 있는 수치만)",
"brands":[{"name":"(입력 데이터의 '이름'과 글자까지 똑같이)","status":"good|watch|bad","diag":"한 줄 진단 — 핵심 변화(↑↓%)와 원인 추정 한 마디(60자 내외)","flag":"주의 딱지 짧게(예: 표본 적음, 추적 스크립트 점검) 없으면 빈 문자열"}],
"internal":["내부 요인(유입경로 변화·특정 페이지 쏠림·이탈률 등 데이터에서 보이는 것) 2~3개, 각 80자 내외"],
"macro":[{"point":"거시 요인(계절/소비심리/경기/뉴스) 문장 80자 내외","source":"매체명 · 날짜(없으면 빈 문자열)","url":"기사 링크(없으면 빈 문자열)"}],
"actions":[{"brand":"대상 브랜드 이름(전체면 '전체')","todo":"다음 주 할 일 한 문장(구체적으로)","why":"근거 한 마디(30자 내외)"}]}

규칙:
- brands 는 입력의 모든 브랜드 포함, name 은 입력 '이름'과 정확히 일치(화면이 이 이름으로 수치를 붙인다).
- status: good=성장/양호, watch=관찰 필요, bad=하락/문제.
- actions 는 정확히 3개. 과장 금지, 데이터에 없는 수치 창작 금지, 주 10명 미만 브랜드는 flag 에 "표본 적음".`;

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

  const rawText = Array.isArray(data.content)
    ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim()
    : "";
  if (!rawText) throw new Error("리포트 생성 결과가 비어 있어요.");

  /* JSON 만 추출해 저장(화면이 구조를 그대로 인포그래픽으로 렌더).
     혹시 JSON 추출에 실패하면 원문 텍스트를 저장 — 화면의 마크다운 폴백이 처리한다. */
  let content = rawText;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed.headline === "string" && Array.isArray(parsed.brands)) content = JSON.stringify(parsed);
    } catch { /* 폴백: 원문 유지 */ }
  }

  const weekKey = overview.range.end;
  let saved = false;
  const { error: insErr } = await supabaseAdmin
    .from("pb_weekly_reports")
    .insert({ week_key: weekKey, content, stats: compact });
  if (!insErr) saved = true;

  return { week_key: weekKey, content, created_at: new Date().toISOString(), saved };
}

// 해당 주(week_key) 리포트가 이미 있는지 — 크론 멱등 가드(익명 반복 호출로 토큰이 새는 걸 막는 핵심).
// structured: 최신 건이 새 포맷(구조화 JSON)인지 — 포맷 마이그레이션(force) 판단용.
export async function reportExists(weekKey: string): Promise<{ exists: boolean; tableMissing: boolean; structured: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("pb_weekly_reports")
    .select("content")
    .eq("week_key", weekKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { exists: false, tableMissing: true, structured: false };
  let structured = false;
  if (data?.content) {
    try {
      const j = JSON.parse(data.content as string);
      structured = !!j && typeof j.headline === "string" && Array.isArray(j.brands);
    } catch { structured = false; }
  }
  return { exists: !!data, tableMissing: false, structured };
}
