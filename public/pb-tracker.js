(function () {
  const storageKey = "pulseboard_demo_events";
  const visitorKey = "pulseboard_demo_visitor";
  const sessionKey = "pulseboard_demo_session";
  const sessionTimeKey = "pulseboard_demo_session_time";
  const sessionWindowMs = 30 * 60 * 1000;
  const scrollMilestones = [25, 50, 75, 100];
  const firedScrollMilestones = new Set();
  const pageStartMs = Date.now();
  const idleLimitMs = 30 * 1000;
  const isEmbeddedPreview = window.parent !== window;
  let maxScrollPercent = 0;
  let firstInteractionMs = null;
  let lastActiveMs = pageStartMs;
  let leaveSent = false;
  let layoutRaf = 0;
  let lastPostedLayout = null;
  let lastPostedScrollPercent = null;

  function getDocumentMetrics() {
    const doc = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(
        doc?.scrollWidth || 0,
        doc?.offsetWidth || 0,
        doc?.clientWidth || 0,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
        body?.clientWidth || 0
      ),
      height: Math.max(
        doc?.scrollHeight || 0,
        doc?.offsetHeight || 0,
        doc?.clientHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        body?.clientHeight || 0
      )
    };
  }

  function postPageContext() {
    if (window.parent === window) return;
    const metrics = getDocumentMetrics();
    try {
      window.parent.postMessage(
        {
          type: "pulseboard:page-context",
          siteId: window.PULSEBOARD_SITE_ID || "demo_store",
          url: window.location.href,
          path: `${window.location.pathname}${window.location.search || ""}`,
          deviceType: getDeviceType(),
          originalWidth: metrics.width,
          originalHeight: metrics.height
        },
        "*"
      );
    } catch {}
  }

  function postLayoutContext() {
    if (window.parent === window) return;
    const metrics = getDocumentMetrics();
    if (
      lastPostedLayout &&
      Math.abs(lastPostedLayout.width - metrics.width) < 8 &&
      Math.abs(lastPostedLayout.height - metrics.height) < 40
    ) {
      return;
    }
    lastPostedLayout = metrics;
    try {
      window.parent.postMessage(
        {
          type: "pulseboard:layout-context",
          siteId: window.PULSEBOARD_SITE_ID || "demo_store",
          url: window.location.href,
          path: `${window.location.pathname}${window.location.search || ""}`,
          deviceType: getDeviceType(),
          originalWidth: metrics.width,
          originalHeight: metrics.height
        },
        "*"
      );
    } catch {}
  }

  function postScrollContext(percent) {
    if (window.parent === window) return;
    if (lastPostedScrollPercent !== null && Math.abs(lastPostedScrollPercent - percent) < 1) {
      return;
    }
    lastPostedScrollPercent = percent;
    try {
      window.parent.postMessage(
        {
          type: "pulseboard:scroll-context",
          siteId: window.PULSEBOARD_SITE_ID || "demo_store",
          url: window.location.href,
          path: `${window.location.pathname}${window.location.search || ""}`,
          deviceType: getDeviceType(),
          scrollPercent: percent
        },
        "*"
      );
    } catch {}
  }

  function scheduleLayoutContext() {
    if (window.parent === window) return;
    if (layoutRaf) {
      window.cancelAnimationFrame(layoutRaf);
    }
    layoutRaf = window.requestAnimationFrame(() => {
      layoutRaf = 0;
      postLayoutContext();
    });
  }

  function makeId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getVisitorId() {
    let visitorId = localStorage.getItem(visitorKey);
    if (!visitorId) {
      visitorId = makeId("visitor");
      localStorage.setItem(visitorKey, visitorId);
    }
    return visitorId;
  }

  function getSessionId() {
    const now = Date.now();
    const lastSeen = Number(localStorage.getItem(sessionTimeKey) || 0);
    let sessionId = localStorage.getItem(sessionKey);

    if (!sessionId || now - lastSeen > sessionWindowMs) {
      sessionId = makeId("session");
      localStorage.setItem(sessionKey, sessionId);
    }

    localStorage.setItem(sessionTimeKey, String(now));
    return sessionId;
  }

  function readEvents() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  }

  function writeEvents(events) {
    localStorage.setItem(storageKey, JSON.stringify(events.slice(-60)));
  }

  function getDeviceType() {
    if (window.innerWidth < 768) return "phone";
    if (window.innerWidth < 1024) return "tablet";
    return "desktop";
  }

  function getRegion(target) {
    return target?.closest("[data-pb-region]")?.getAttribute("data-pb-region") || "unknown";
  }

  function inferRegion(target) {
    if (!target) return "page";
    const semantic = target.closest("header, main, footer, nav, section, article, aside");
    if (!semantic) return getRegion(target);
    return semantic.tagName.toLowerCase();
  }

  function describeElement(target) {
    if (!target) return "unknown";
    const text = target.textContent?.trim().replace(/\s+/g, " ").slice(0, 40);
    const id = target.id ? `#${target.id}` : "";
    const className =
      typeof target.className === "string" && target.className.trim()
        ? `.${target.className.trim().split(/\s+/)[0]}`
        : "";
    return text || `${target.tagName.toLowerCase()}${id}${className}`;
  }

  async function sendToEndpoint(event) {
    if (isEmbeddedPreview) {
      return;
    }

    const endpoint = window.PULSEBOARD_ENDPOINT;
    if (!endpoint || endpoint === "local-demo") {
      return;
    }

    try {
      await fetch(endpoint, {
        method: "POST",
        mode: "cors",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
      });
    } catch {}
  }

  function emit(eventType, payload) {
    if (isEmbeddedPreview) {
      return;
    }

    const event = {
      siteId: window.PULSEBOARD_SITE_ID || "demo_store",
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      eventType,
      occurredAt: new Date().toISOString(),
      url: window.location.href,
      path: window.location.pathname,
      referrer: document.referrer || "direct",
      deviceType: getDeviceType(),
      ...payload
    };

    const events = readEvents();
    events.push(event);
    writeEvents(events);
    sendToEndpoint(event);
    window.dispatchEvent(new CustomEvent("pulseboard:event", { detail: event }));
  }

  function markActive() {
    lastActiveMs = Date.now();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-pb-click], a, button, input, [role='button'], [onclick]");
    if (!target) return;
    if (firstInteractionMs === null) {
      firstInteractionMs = Date.now() - pageStartMs;
    }
    markActive();

    const rect = document.documentElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, event.clientX / window.innerWidth));
    const y = Math.max(0, Math.min(1, event.clientY / window.innerHeight));
    const targetText = (target.getAttribute("data-pb-click") || describeElement(target)).toLowerCase();
    const isCta =
      target.hasAttribute("data-pb-cta") ||
      /문의|상담|구매|신청|결제|예약|시작|무료|상세|바로/.test(targetText);

    emit(target.getAttribute("data-pb-event") || (isCta ? "cta_click" : "element_click"), {
      elementLabel: target.getAttribute("data-pb-click") || describeElement(target),
      pageRegion: getRegion(target) !== "unknown" ? getRegion(target) : inferRegion(target),
      funnelStep: target.getAttribute("data-pb-funnel") || undefined,
      clickX: Number(x.toFixed(4)),
      clickY: Number(y.toFixed(4)),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      metadata: {
        documentTop: Math.abs(Math.round(rect.top)),
        firstInteractionMs
      }
    });
  });

  window.addEventListener(
    "scroll",
    () => {
        markActive();
        const doc = document.documentElement;
        const total = doc.scrollHeight - window.innerHeight;
        const percent = total <= 0 ? 100 : Math.round((window.scrollY / total) * 100);
        maxScrollPercent = Math.max(maxScrollPercent, percent);
        postScrollContext(percent);

        scrollMilestones.forEach((milestone) => {
          if (percent >= milestone && !firedScrollMilestones.has(milestone)) {
          firedScrollMilestones.add(milestone);
          emit("scroll_depth", { scrollPercent: milestone, pageRegion: "page" });
        }
      });
    },
    { passive: true }
  );

  document.addEventListener("mousemove", markActive, { passive: true });
  document.addEventListener("keydown", markActive);
  document.addEventListener("touchstart", markActive, { passive: true });
  window.addEventListener("focus", markActive);
  window.addEventListener("resize", scheduleLayoutContext, { passive: true });

  window.PulseboardTracker = { readEvents };
  postPageContext();
  postLayoutContext();
  postScrollContext(0);
  emit("page_view", { pageRegion: "page", funnelStep: "landing" });

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    setTimeout(() => {
      postPageContext();
      scheduleLayoutContext();
    }, 0);
    return result;
  };

  window.history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    setTimeout(() => {
      postPageContext();
      scheduleLayoutContext();
    }, 0);
    return result;
  };

  window.addEventListener("popstate", () =>
    setTimeout(() => {
      postPageContext();
      scheduleLayoutContext();
    }, 0)
  );
  window.addEventListener("hashchange", () =>
    setTimeout(() => {
      postPageContext();
      scheduleLayoutContext();
    }, 0)
  );

  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => scheduleLayoutContext());
    if (document.documentElement) resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  } else {
    window.setInterval(scheduleLayoutContext, 1500);
  }

  window.addEventListener("load", scheduleLayoutContext);
  window.setTimeout(scheduleLayoutContext, 300);
  window.setTimeout(scheduleLayoutContext, 1200);

  function emitLeave() {
    if (leaveSent) return;
    leaveSent = true;
    const now = Date.now();
    const activeWindowMs = Math.min(now - pageStartMs, Math.max(0, lastActiveMs - pageStartMs) + idleLimitMs);
    emit("page_leave", {
      pageRegion: "page",
      durationMs: activeWindowMs,
      maxScrollPercent,
      metadata: {
        firstInteractionMs
      }
    });
  }

  window.addEventListener("pagehide", emitLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      emitLeave();
    }
  });

  /* ── 세션 리플레이(rrweb) ──
     방문자 화면(DOM 변화·마우스·스크롤)을 녹화해 청크로 업로드 → 대시보드에서 영상처럼 재생.
     - 입력값은 전부 마스킹(maskAllInputs) — 비밀번호/개인정보 원문은 절대 저장 안 됨.
     - 페이지당 최대 60초, 5초 미만 이탈은 업로드 자체를 안 함(쓰레기 방지).
     - keepalive 는 64KB 제한이라 큰 청크는 세션 도중에 일반 fetch 로 보낸다(4초 주기 flush).
     - 서버가 사이트당 하루 상한(429)을 돌려주면 그 즉시 녹화 중단.
     - window.PULSEBOARD_REPLAY = false 로 끌 수 있고, PULSEBOARD_REPLAY_SAMPLE(0~1)로 샘플링 조절. */
  (function initReplay() {
    if (isEmbeddedPreview) return;
    if (window.PULSEBOARD_REPLAY === false) return;
    var endpoint = window.PULSEBOARD_ENDPOINT;
    if (!endpoint || endpoint === "local-demo") return;
    var replayEndpoint = endpoint.replace(/\/collect\/?$/, "/replay");
    if (replayEndpoint === endpoint) return;
    var sample = typeof window.PULSEBOARD_REPLAY_SAMPLE === "number" ? window.PULSEBOARD_REPLAY_SAMPLE : 1;
    if (Math.random() >= sample) return;

    var MAX_MS = 60 * 1000;
    var MIN_MS = 5 * 1000;
    var MAX_CHUNKS = 20;
    var replayId = makeId("replay");
    var buf = [];
    var seq = 0;
    var stopped = false;
    var recStart = Date.now();
    var stopFn = null;

    function stopRec() {
      if (stopped) return;
      stopped = true;
      try { if (stopFn) stopFn(); } catch (e) {}
    }

    function flush(isFinal) {
      if (stopped && !isFinal) return;
      if (!buf.length) return;
      if (seq >= MAX_CHUNKS) { stopRec(); return; }
      var events = buf;
      buf = [];
      var body = JSON.stringify({
        siteId: window.PULSEBOARD_SITE_ID || "demo_store",
        sessionId: getSessionId(),
        visitorId: getVisitorId(),
        replayId: replayId,
        seq: seq++,
        path: window.location.pathname,
        url: window.location.href,
        deviceType: getDeviceType(),
        durationMs: Date.now() - recStart,
        events: events
      });
      try {
        fetch(replayEndpoint, {
          method: "POST",
          mode: "cors",
          keepalive: !!isFinal && body.length < 60000,
          headers: { "Content-Type": "application/json" },
          body: body
        }).then(function (r) {
          if (r && (r.status === 429 || r.status === 413)) stopRec();
        }).catch(function () {});
      } catch (e) {}
    }

    function boot() {
      if (!window.rrwebRecord) return;
      try {
        stopFn = window.rrwebRecord({
          emit: function (ev) { if (!stopped) buf.push(ev); },
          maskAllInputs: true,
          sampling: { mousemove: 80, scroll: 150, media: 800, input: "last" }
        });
      } catch (e) { return; }

      var iv = window.setInterval(function () {
        if (stopped) { window.clearInterval(iv); return; }
        if (Date.now() - recStart > MAX_MS) { flush(false); stopRec(); window.clearInterval(iv); return; }
        if (Date.now() - recStart >= MIN_MS) flush(false);
      }, 4000);

      window.addEventListener("pagehide", function () {
        if (Date.now() - recStart >= MIN_MS) flush(true);
        stopRec();
      });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden" && Date.now() - recStart >= MIN_MS) flush(true);
      });
    }

    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/record/rrweb-record.min.js";
    s.async = true;
    s.onload = boot;
    document.head.appendChild(s);
  })();
})();
