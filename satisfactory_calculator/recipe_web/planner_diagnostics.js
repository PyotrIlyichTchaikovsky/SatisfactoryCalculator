(() => {
  "use strict";
  const config = window.PLANNER_CONFIG || {};
  let monitoringReady = false;
  const reported = new WeakMap();
  const responses = new WeakMap();
  const issueId = () => window.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function reportError(error, stage, capture = true, result = null) {
    const problem = error instanceof Error ? error : new Error(String(error));
    if (reported.has(problem)) return reported.get(problem);
    const request = problem.plannerRequest || (result && responses.get(result)) || null;
    const report = {
      id: request?.requestId || issueId(), time: new Date().toISOString(), stage,
      message: problem.message, monitoringTest: Boolean(problem.monitoringTest), request,
    };
    reported.set(problem, report);
    if (capture && !(request?.status >= 400 && request.status < 500)) {
      try {
        window.Sentry?.withScope((scope) => {
          if (problem.monitoringTest) scope.setTag("monitoring_test", "true");
          scope.setTag("issue_id", report.id);
          scope.setTag("request_id", request?.requestId || "unavailable");
          scope.setTag("stage", stage);
          scope.setTag("backend_release", request?.release || "unknown");
          scope.setTag("data_version", request?.dataVersion || "unknown");
          report.eventId = window.Sentry.captureException(problem);
        });
      } catch (_) { /* Monitoring must never interrupt the planner. */ }
    }
    return report;
  }

  async function fetchJson(url, options = {}) {
    const record = { path: url, method: options.method || "GET", time: new Date().toISOString() };
    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");
    try {
      const response = await fetch(`${base}/${url.replace(/^\/+/, "")}`, options);
      Object.assign(record, {
        status: response.status,
        requestId: response.headers.get("X-Request-ID") || "",
        release: response.headers.get("X-Planner-Release") || "",
        dataVersion: response.headers.get("X-Planner-Data-Version") || "",
      });
      let payload;
      try { payload = await response.json(); }
      catch (_) { throw new Error("The service returned an unreadable response. Please retry."); }
      if (!response.ok) throw new Error(payload?.error || `Service error (${response.status}).`);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The service returned an unexpected response. Please retry.");
      }
      responses.set(payload, record);
      return payload;
    } catch (error) {
      error.plannerRequest = record;
      throw error;
    }
  }

  function initializeMonitoring() {
    if (!config.sentryDsn || !window.Sentry?.init) return;
    try {
      window.Sentry.init({
        dsn: config.sentryDsn,
        environment: config.sentryEnvironment,
        release: config.sentryRelease || undefined,
        sendDefaultPii: false,
        integrations(defaults) { return defaults.filter((integration) => !["GlobalHandlers", "BrowserApiErrors", "TryCatch"].includes(integration.name)); },
        beforeSend(event) {
          delete event.user;
          delete event.request;
          delete event.extra;
          delete event.breadcrumbs;
          return event;
        },
      });
      monitoringReady = true;
    } catch (_) { /* The planner remains usable if monitoring cannot start. */ }
  }

  function showTestStatus(message) {
    const status = document.getElementById("monitoringTestStatus");
    if (status) { status.hidden = false; status.textContent = message; }
  }

  initializeMonitoring();
  window.addEventListener("error", (event) => {
    const report = reportError(event.error || event.message, "unhandled-error");
    if (report.monitoringTest) showTestStatus(`Test exception captured. Environment: ${config.sentryEnvironment}. Problem ID: ${report.id}. Check Sentry and your notification channel to confirm delivery.`);
  });
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "unhandled-rejection"));
  window.PlannerDiagnostics = { fetchJson, reportError };

  function runUrlMonitoringTest() {
    if (new URLSearchParams(window.location?.search || "").get("monitoring_test") !== "frontend") return;
    if (!["staging", "production"].includes(config.sentryEnvironment)) {
      showTestStatus("Monitoring URL tests are supported in staging and production only.");
      return;
    }
    if (!monitoringReady) {
      showTestStatus("Monitoring test failed: Sentry is not initialized. Check this deployment's DSN and SDK configuration.");
      return;
    }
    showTestStatus("Triggering a frontend monitoring test for this deployment...");
    setTimeout(() => {
      const error = new Error("Planner frontend monitoring test");
      error.monitoringTest = true;
      throw error;
    }, 0);
  }
  window.addEventListener("load", runUrlMonitoringTest, { once: true });
})();
