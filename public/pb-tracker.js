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
})();
