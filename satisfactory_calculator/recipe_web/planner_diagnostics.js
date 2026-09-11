(() => {
  "use strict";
  const config = window.PLANNER_CONFIG || {};
  let monitoringReady = false;
  let getContext = () => ({});
  let dataSummary = {};
  let lastIssue = null;
  const requests = [];
  const reported = new WeakMap();
  const responses = new WeakMap();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const issueId = () => window.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const context = () => {
    try { return copy(getContext()); } catch (_) { return { unavailable: true }; }
  };

  function reportError(error, stage, capture = true, result = null) {
    const problem = error instanceof Error ? error : new Error(String(error));
    if (reported.has(problem)) return reported.get(problem);
    const request = problem.plannerRequest || (result && responses.get(result)) || null;
    const report = {
      id: request?.requestId || issueId(),
      time: new Date().toISOString(), stage,
      message: problem.message,
      monitoringTest: Boolean(problem.monitoringTest),
      request,
      context: context(),
    };
    lastIssue = report;
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
    if (options.body) {
      try { record.payload = JSON.parse(options.body); } catch (_) { /* Only structured planner inputs. */ }
    }
    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");
    let response;
    try {
      response = await fetch(`${base}/${url.replace(/^\/+/, "")}`, options);
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
    } finally {
      requests.push(record);
      if (requests.length > 10) requests.shift();
    }
  }

  function buildReport() {
    return copy({
      format: "satisfactory-planner-diagnostics", version: 1,
      createdAt: new Date().toISOString(),
      frontendRelease: config.sentryRelease || "local",
      environment: config.sentryEnvironment || "local",
      dataSummary,
      lastIssue,
      currentContext: context(),
      recentRequests: requests,
      browser: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
  }

  function openReport() {
    const dialog = document.getElementById("diagnosticsDialog");
    const output = document.getElementById("diagnosticsOutput");
    output.value = JSON.stringify(buildReport(), null, 2);
    document.getElementById("diagnosticsNotice").textContent = "Review this report before sharing it in a GitHub issue. It includes your current plan and recent calculation inputs. Nothing is sent by these buttons.";
    dialog.showModal();
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
          // Default breadcrumbs can contain clicked labels and request URLs.
          delete event.breadcrumbs;
          return event;
        },
      });
      monitoringReady = true;
    } catch (_) { /* Feedback remains available even without the SDK. */ }
  }
  initializeMonitoring();
  // Own global handling so local reports and Sentry always share the same issue ID.
  window.addEventListener("error", (event) => {
    const report = reportError(event.error || event.message, "unhandled-error");
    if (report.monitoringTest) showTestStatus(`Test exception captured. Environment: ${config.sentryEnvironment}. Problem ID: ${report.id}. Check Sentry and your notification channel to confirm delivery.`);
  });
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "unhandled-rejection"));
  document.getElementById("reportProblemButton")?.addEventListener("click", openReport);
  document.getElementById("copyDiagnosticsButton")?.addEventListener("click", async () => {
    const output = document.getElementById("diagnosticsOutput");
    const notice = document.getElementById("diagnosticsNotice");
    try {
      await navigator.clipboard.writeText(output.value);
      notice.textContent = "Report copied. Paste it into your issue with the steps you took and what you expected.";
    } catch (_) {
      output.focus(); output.select();
      notice.textContent = "Automatic copy is unavailable. Copy the selected text, or download the report.";
    }
  });
  document.getElementById("downloadDiagnosticsButton")?.addEventListener("click", () => {
    const blob = new Blob([document.getElementById("diagnosticsOutput").value], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "planner-diagnostics.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.PlannerDiagnostics = {
    configure(provider) { getContext = provider; },
    setDataSummary(summary) { dataSummary = copy(summary); },
    fetchJson, reportError, buildReport,

  };
  function showTestStatus(message) {
    const status = document.getElementById("monitoringTestStatus");
    if (status) { status.hidden = false; status.textContent = message; }
  }

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
    // Throw asynchronously so the real global error handler and SDK handle the event.
    setTimeout(() => {
      const error = new Error("Planner frontend monitoring test");
      error.monitoringTest = true;
      throw error;
    }, 0);
  }
  window.addEventListener("load", runUrlMonitoringTest, { once: true });
})();
