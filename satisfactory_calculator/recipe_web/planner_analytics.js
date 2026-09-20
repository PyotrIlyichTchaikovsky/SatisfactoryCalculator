(() => {
  "use strict";

  const TEST_MODE_KEY = "factorTools.analyticsTestMode.v1";
  const DAILY_VISITOR_KEY = "factorTools.dailyVisitor.v1";
  const MAX_QUEUE = 20;
  const FLUSH_DELAY_MS = 3000;
  const EVENT_NAMES = new Set([
    "page_open", "planner_ready", "planner_load_failed",
    "material_picker_opened", "material_selected",
    "target_added", "target_removed", "plan_saved", "plan_restored",
    "calculation_started", "calculation_succeeded", "calculation_failed", "recipe_expansion_required",
    "recipe_filter_opened", "recipe_selection_changed", "recipe_defaults_restored",
    "result_view_changed", "layout_reset", "language_changed",
    "problem_report_opened", "problem_report_copied", "problem_report_downloaded",
  ]);
  const DIMENSION_NAMES = new Set(["context", "itemClass", "category", "view", "outcome", "reason"]);
  const METRIC_NAMES = new Set(["durationMs", "targetCount", "recipeCount", "enabledRecipeCount", "resultRowCount"]);
  const config = window.PLANNER_CONFIG || {};
  const environment = String(config.sentryEnvironment || "development");
  const endpoint = normalizeEndpoint(config.analyticsEndpoint);
  const synthetic = determineSyntheticMode();
  const enabled = Boolean(endpoint) && ["staging", "production"].includes(environment);
  const queue = [];
  let flushTimer = 0;

  function determineSyntheticMode() {
    const value = new URLSearchParams(window.location.search).get("analytics_test");
    try {
      if (value === "1") window.localStorage.setItem(TEST_MODE_KEY, "true");
      if (value === "0") window.localStorage.removeItem(TEST_MODE_KEY);
      return value === "1" || navigator.webdriver === true || window.localStorage.getItem(TEST_MODE_KEY) === "true";
    } catch (_error) {
      return value === "1" || navigator.webdriver === true;
    }
  }

  function normalizeEndpoint(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function dailyVisitorId() {
    const date = new Date().toISOString().slice(0, 10);
    if (synthetic) return `test-${date}-${randomId()}`;
    try {
      const existing = JSON.parse(window.localStorage.getItem(DAILY_VISITOR_KEY) || "null");
      if (existing?.date === date && /^[a-f0-9-]{16,64}$/i.test(existing.id || "")) return existing.id;
      const created = { date, id: randomId() };
      window.localStorage.setItem(DAILY_VISITOR_KEY, JSON.stringify(created));
      return created.id;
    } catch (_error) {
      return randomId();
    }
  }

  function randomId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  const visitorId = dailyVisitorId();

  function track(name, properties = {}) {
    if (!enabled || !EVENT_NAMES.has(name)) return false;
    const dimensions = {};
    const metrics = {};
    DIMENSION_NAMES.forEach((key) => {
      const value = String(properties[key] || "").trim();
      if (value) dimensions[key] = value.slice(0, 128);
    });
    METRIC_NAMES.forEach((key) => {
      const value = Number(properties[key]);
      if (Number.isFinite(value) && value >= 0) metrics[key] = Math.min(value, 1_000_000_000);
    });
    queue.push({ name, dimensions, metrics });
    if (queue.length >= MAX_QUEUE) flush();
    else if (!flushTimer) flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
    return true;
  }

  function payload(events) {
    return JSON.stringify({
      schema: 1,
      visitorId,
      synthetic,
      environment,
      release: String(config.sentryRelease || "").slice(0, 64),
      locale: document.documentElement.lang || navigator.language || "en-US",
      viewport: viewportBucket(),
      events,
    });
  }

  function viewportBucket() {
    const width = Number(window.innerWidth || 0);
    if (width < 640) return "mobile";
    if (width < 1024) return "tablet";
    return "desktop";
  }

  function flush(options = {}) {
    if (flushTimer) window.clearTimeout(flushTimer);
    flushTimer = 0;
    if (!enabled || !queue.length) return Promise.resolve(false);
    const events = queue.splice(0, MAX_QUEUE);
    const body = payload(events);
    if (options.beacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if (!sent) queue.unshift(...events);
      return Promise.resolve(sent);
    }
    return fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
    }).then((response) => response.ok).catch(() => false);
  }

  function installDelegatedEvents() {
    const clickEvents = new Map([
      ["addTargetButton", "target_added"], ["savePlanButton", "plan_saved"],
      ["resetLayoutButton", "layout_reset"],
      ["reportProblemButton", "problem_report_opened"], ["copyDiagnosticsButton", "problem_report_copied"],
      ["downloadDiagnosticsButton", "problem_report_downloaded"],
    ]);
    document.addEventListener("click", (event) => {
      const element = event.target instanceof Element ? event.target.closest("button,[data-plan-index]") : null;
      if (!element) return;
      const eventName = clickEvents.get(element.id);
      if (eventName) track(eventName);
      if (element.matches(".tab-button[data-tab]")) track("result_view_changed", { view: element.dataset.tab });
      if (element.matches("[data-plan-index]")) track("plan_restored", { context: element.closest("#savedPlanSelect") ? "saved" : "history" });
    });
    document.addEventListener("change", (event) => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      if (element.id === "languageSelect") track("language_changed", { context: element.value });
      if (element.matches(".recipe-filter-checkbox")) {
        track("recipe_selection_changed", {
          context: element.checked ? "enabled" : "disabled",
          itemClass: element.closest("[data-material-class]")?.dataset.materialClass || "",
        });
      }
    });
  }

  function showTestModeBanner() {
    if (!synthetic) return;
    const banner = document.createElement("div");
    banner.className = "analytics-test-banner";
    banner.setAttribute("role", "status");
    const requestedLocale = new URLSearchParams(window.location.search).get("lang");
    const chinese = (requestedLocale || document.documentElement.lang || navigator.language || "").toLowerCase().startsWith("zh");
    const label = document.createElement("span");
    label.textContent = chinese ? "统计测试模式：本浏览器的使用记录不会计入正式数据。" : "Analytics test mode: this browser is excluded from production usage data.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = chinese ? "结束测试模式" : "End test mode";
    button.addEventListener("click", () => {
      try { window.localStorage.removeItem(TEST_MODE_KEY); } catch (_error) { /* unavailable storage */ }
      const url = new URL(window.location.href);
      url.searchParams.set("analytics_test", "0");
      window.location.replace(url.toString());
    });
    banner.append(label, button);
    document.body.prepend(banner);
  }

  window.PlannerAnalytics = Object.freeze({
    track, flush,
    isEnabled: () => enabled,
    isSynthetic: () => synthetic,
    status: () => ({ enabled, synthetic, environment, endpoint }),
  });
  document.addEventListener("DOMContentLoaded", () => {
    installDelegatedEvents();
    showTestModeBanner();
    track("page_open");
  }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush({ beacon: true });
  });
  window.addEventListener("pagehide", () => flush({ beacon: true }));
})();
