"use client";

import { useMemo, useState } from "react";
import type { LandingPageData } from "@/lib/pb/landing-analysis";

function maxCount(items: { count: number }[]) {
  return Math.max(...items.map((item) => item.count), 1);
}

export function LandingAnalysisClient({
  initialData
}: {
  initialData: { pages: LandingPageData[] };
}) {
  const [selectedId, setSelectedId] = useState(initialData.pages[0]?.id ?? 0);
  const [visualMode, setVisualMode] = useState<"heatmap" | "scroll" | "exit" | "hotspots">("heatmap");
  const selected = useMemo(
    () => initialData.pages.find((page) => page.id === selectedId) ?? initialData.pages[0],
    [initialData.pages, selectedId]
  );

  if (!selected) {
    return (
      <main className="guide-shell">
        <section className="guide-card">
          <h1>랜딩페이지 분석</h1>
          <p>아직 수집된 랜딩 데이터가 없습니다.</p>
        </section>
      </main>
    );
  }

  const scrollMax = maxCount(selected.scrollBuckets);
  const referrerMax = maxCount(selected.referrers);
  const deviceMax = maxCount(selected.devices);
  const progressMax = maxCount(selected.scrollProgress.map((item) => ({ count: item.visitors })));
  const exitMax = maxCount(selected.exitPressure.map((item) => ({ count: item.exits })));

  return (
    <main className="landing-shell">
      <section className="landing-header-card">
        <div>
          <a className="guide-back" href="/data-tracking">
            메인 대시보드로 돌아가기
          </a>
          <h1>랜딩페이지 분석</h1>
          <p>{selected.groupName}</p>
        </div>

        <div className="landing-tabs">
          {initialData.pages.map((page) => (
            <button
              className={`landing-tab ${page.id === selected.id ? "active" : ""}`}
              key={page.id}
              type="button"
              onClick={() => setSelectedId(page.id)}
            >
              {page.pageName}
            </button>
          ))}
        </div>
      </section>

      <section className="landing-summary">
        <article className="summary-card">
          <p>랜딩 조회수</p>
          <strong>{selected.views}</strong>
        </article>
        <article className="summary-card">
          <p>평균 체류시간</p>
          <strong>{selected.avgStaySeconds}초</strong>
        </article>
        <article className="summary-card">
          <p>평균 스크롤 도달률</p>
          <strong>{selected.avgScroll}%</strong>
        </article>
        <article className="summary-card">
          <p>CTA 클릭률</p>
          <strong>{selected.ctr}%</strong>
        </article>
        <article className="summary-card">
          <p>평균 첫 반응</p>
          <strong>{selected.avgFirstInteractionSeconds || 0}초</strong>
        </article>
        <article className="summary-card">
          <p>랜딩 건강도</p>
          <strong>{selected.healthScore}점</strong>
        </article>
      </section>

      <section className="landing-grid">
        <article className="panel landing-preview-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">오버레이 분석</strong>
            </div>
            <div className="visual-toolbar">
              {[
                { key: "heatmap", label: "히트맵" },
                { key: "scroll", label: "스크롤맵" },
                { key: "exit", label: "이탈맵" },
                { key: "hotspots", label: "핫스팟" }
              ].map((mode) => (
                <button
                  key={mode.key}
                  className={`visual-chip ${visualMode === mode.key ? "active" : ""}`}
                  type="button"
                  onClick={() => setVisualMode(mode.key as typeof visualMode)}
                >
                  {mode.label}
                </button>
              ))}
              <a className="ghost-button compact inline-action" href={selected.captureUrl} target="_blank" rel="noreferrer">
                원본 페이지 열기
              </a>
            </div>
          </div>

          <div className="landing-preview">
            <iframe className="landing-iframe" src={selected.captureUrl} title={selected.pageName} />
            {visualMode === "heatmap" ? (
              <div className="heatmap-overlay">
                {selected.heatmap.map((point, index) => (
                  <span
                    className={`heat-dot ${point.strength > 1 ? "strong" : ""}`}
                    key={`${point.x}-${point.y}-${index}`}
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  />
                ))}
              </div>
            ) : null}

            {visualMode === "hotspots" ? (
              <div className="heatmap-overlay">
                {selected.clickHotspots.map((point) => (
                  <button
                    className="hotspot-marker"
                    key={`${point.label}-${point.x}-${point.y}`}
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                    type="button"
                  >
                    <span>{point.count}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {visualMode === "scroll" ? (
              <div className="scrollmap-overlay">
                <div className="scrollmap-gradient" />
                <svg className="scrollmap-curve" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path
                    d={`M 85 0 ${selected.scrollProgress
                      .map((item, index) => {
                        const x = 90 - (item.visitors / progressMax) * 58;
                        const y = (index + 1) * 22;
                        return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
                      })
                      .join(" ")}`}
                  />
                </svg>
                {selected.scrollProgress.map((item) => (
                  <div className="scrollline" key={item.label} style={{ top: `${item.percent}%` }}>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {visualMode === "exit" ? (
              <div className="exitmap-overlay">
                {selected.exitPressure.map((item) => (
                  <div
                    className="exit-band"
                    key={item.label}
                    style={{
                      top: `${Math.max(0, item.percent - 10)}%`,
                      opacity: 0.2 + item.exits / Math.max(exitMax, 1) * 0.55
                    }}
                  >
                    <span>{item.label}</span>
                    <strong>{item.exits}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <p className="footnote">
            {visualMode === "heatmap"
              ? "클릭 히트맵은 일반 클릭과 CTA 클릭을 함께 표시합니다. CTA 클릭은 더 진하게 강조됩니다."
              : visualMode === "scroll"
                ? "스크롤맵은 도달률에 따라 색을 바꾸고, 우측 라인으로 구간별 잔존량을 보여줍니다."
                : visualMode === "exit"
                  ? "이탈맵은 page_leave 기준으로 어느 높이에서 이탈이 많이 발생했는지 보여줍니다."
                  : "핫스팟은 클릭이 집중된 좌표를 뽑아 가장 많이 눌린 영역을 표시합니다."}
          </p>
        </article>

        <article className="panel landing-side-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">핵심 인사이트</strong>
            </div>
          </div>

          <div className="status-stack">
            <div className="status-card ok">
              <strong>랜딩 성과 요약</strong>
              <p>
                조회 {selected.views}회, CTA {selected.ctaClickCount}회, 평균 체류 {selected.avgStaySeconds}초,
                평균 스크롤 {selected.avgScroll}%입니다.
              </p>
            </div>
            <div className="status-card">
              <strong>즉시 해석</strong>
              <p>{selected.summaryText}</p>
            </div>
            <div className="status-card warn">
              <strong>예상 손실 구간</strong>
              <p>
                스크롤 기준 이탈 추정 방문자는 약 {selected.estimatedLostVisitors}명입니다. 상단 구간과
                CTA 배치부터 줄여나가세요.
              </p>
            </div>
            <div className="status-card">
              <strong>개선 시 기대값</strong>
              <p>CTA를 정리하면 현재 기준으로 추가 클릭 {selected.projectedAdditionalCtas}건을 기대할 수 있습니다.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="report-grid report-grid-equal">
        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">우선 실행 액션</strong>
            </div>
          </div>
          <div className="recommendation-stack">
            {selected.recommendations.length ? (
              selected.recommendations.map((item) => (
                <div className="recommendation-card recommendation-card-light" key={item}>
                  <strong>실행 제안</strong>
                  <p>{item}</p>
                </div>
              ))
            ) : (
              <div className="recommendation-card recommendation-card-light">
                <strong>데이터 수집 중</strong>
                <p>조금 더 데이터가 쌓이면 이곳에 개선 우선순위가 자동으로 정리됩니다.</p>
              </div>
            )}
          </div>
        </article>

        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">랜딩 반응 포인트</strong>
            </div>
          </div>
          <div className="simulation-grid">
            <div className="simulation-card">
              <span>첫 반응 속도</span>
              <strong>{selected.avgFirstInteractionSeconds || 0}초</strong>
              <p>첫 클릭이 느릴수록 상단 이해 비용이 높다는 뜻입니다.</p>
            </div>
            <div className="simulation-card">
              <span>예상 추가 CTA</span>
              <strong>{selected.projectedAdditionalCtas}건</strong>
              <p>CTA 문구/위치 개선 시 기대 가능한 추가 클릭입니다.</p>
            </div>
          </div>
        </article>
      </section>

      <section className="report-grid">
        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">스크롤 분포</strong>
            </div>
          </div>
          <div className="metric-bars">
            {selected.scrollBuckets.map((item) => (
              <div className="metric-bar-row" key={item.label}>
                <span>{item.label}</span>
                <div className="metric-bar-track">
                  <div className="metric-bar-fill" style={{ width: `${(item.count / scrollMax) * 100}%` }} />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">스크롤 도달선</strong>
            </div>
          </div>
          <div className="metric-bars">
            {selected.scrollProgress.length ? (
              selected.scrollProgress.map((item) => (
                <div className="metric-bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="metric-bar-track">
                    <div className="metric-bar-fill" style={{ width: `${(item.visitors / progressMax) * 100}%` }} />
                  </div>
                  <strong>{item.visitors}</strong>
                </div>
              ))
            ) : (
              <div className="log-empty">스크롤 데이터가 아직 없습니다.</div>
            )}
          </div>
        </article>
      </section>

      <section className="report-grid">
        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">디바이스 비중</strong>
            </div>
          </div>
          <div className="metric-bars">
            {selected.devices.length ? (
              selected.devices.map((item) => (
                <div className="metric-bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="metric-bar-track">
                    <div className="metric-bar-fill" style={{ width: `${(item.count / deviceMax) * 100}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="log-empty">디바이스 데이터가 아직 없습니다.</div>
            )}
          </div>
        </article>

        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">구간별 이탈 압력</strong>
            </div>
          </div>
          <div className="metric-bars">
            {selected.exitPressure.length ? (
              selected.exitPressure.map((item) => (
                <div className="metric-bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="metric-bar-track">
                    <div className="metric-bar-fill" style={{ width: `${(item.exits / exitMax) * 100}%` }} />
                  </div>
                  <strong>{item.exits}</strong>
                </div>
              ))
            ) : (
              <div className="log-empty">이탈 데이터가 아직 없습니다.</div>
            )}
          </div>
        </article>
      </section>

      <section className="report-grid">
        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">유입 상위 경로</strong>
            </div>
          </div>
          <div className="metric-bars">
            {selected.referrers.length ? (
              selected.referrers.map((item) => (
                <div className="metric-bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="metric-bar-track">
                    <div className="metric-bar-fill" style={{ width: `${(item.count / referrerMax) * 100}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="log-empty">유입 경로 데이터가 아직 없습니다.</div>
            )}
          </div>
        </article>

        <article className="panel report-panel">
          <div className="panel-header">
            <div>
              <strong className="panel-title panel-title-small">클릭 많은 요소</strong>
            </div>
          </div>
          <div className="metric-list">
            {selected.topClicks.length ? (
              selected.topClicks.map((item) => (
                <div className="metric-row" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <div className="log-empty">클릭 요소 데이터가 아직 없습니다.</div>
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <strong className="panel-title panel-title-small">최근 랜딩 이벤트</strong>
          </div>
        </div>

        <div className="log-list landing-log-list">
          {selected.recentEvents.length ? (
            selected.recentEvents.map((event) => (
              <div className="log-row" key={event.id}>
                <div>
                  <strong>{event.label}</strong>
                  <p>{event.device}</p>
                </div>
                <div>{new Date(event.createdAt).toLocaleString("ko-KR")}</div>
              </div>
            ))
          ) : (
            <div className="log-empty">최근 이벤트가 없습니다.</div>
          )}
        </div>
      </section>
    </main>
  );
}
