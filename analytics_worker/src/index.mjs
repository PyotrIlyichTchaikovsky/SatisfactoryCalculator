const EVENT_NAMES = new Set([
  "page_open", "planner_ready", "planner_load_failed",
  "material_picker_opened", "material_selected",
  "target_added", "target_removed", "plan_saved", "plan_restored",
  "calculation_started", "calculation_succeeded", "calculation_failed", "recipe_expansion_required",
  "recipe_filter_opened", "recipe_selection_changed", "recipe_defaults_restored",
  "result_view_changed", "layout_reset", "language_changed",
]);
const DIMENSIONS = ["context", "itemClass", "category", "view", "outcome", "reason"];
const METRICS = ["durationMs", "targetCount", "recipeCount", "enabledRecipeCount", "resultRowCount"];
const MAX_BODY_BYTES = 16_384;
const MAX_EVENTS = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, environment: env.ENVIRONMENT || "unknown" });
    }
    if (request.method === "GET" && url.pathname === "/dashboard") {
      const identity = await requireDashboardAccess(request, env);
      if (!identity.ok) return identity.response;
      return dashboardHtml(env.ENVIRONMENT || "unknown");
    }
    if (request.method === "GET" && url.pathname === "/dashboard/api/summary") {
      const identity = await requireDashboardAccess(request, env);
      if (!identity.ok) return identity.response;
      const days = [1, 7, 30, 90].includes(Number(url.searchParams.get("days")))
        ? Number(url.searchParams.get("days")) : 7;
      try {
        return json(await loadDashboardSummary(env, days));
      } catch (error) {
        console.error("analytics dashboard query failed", error);
        return json({ error: "Unable to load analytics data" }, 502);
      }
    }
    if (url.pathname !== "/events") return json({ error: "Not found" }, 404);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    if (!cors) return json({ error: "Origin is not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return json({ error: "Payload is too large" }, 413, cors);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: "Payload is too large" }, 413, cors);
    let value;
    try { value = JSON.parse(body); } catch (_error) { return json({ error: "Invalid JSON" }, 400, cors); }
    const batch = validateBatch(value, env.ENVIRONMENT);
    if (!batch.ok) return json({ error: batch.error }, 400, cors);
    if (!env.USAGE_EVENTS?.writeDataPoint) return json({ error: "Analytics dataset is unavailable" }, 503, cors);

    for (const event of batch.events) {
      env.USAGE_EVENTS.writeDataPoint(toDataPoint(batch, event));
    }
    return json({ accepted: batch.events.length, synthetic: batch.synthetic }, 202, cors);
  },
};

export function dashboardQueries(dataset, days) {
  if (!/^[a-zA-Z0-9_]+$/.test(dataset)) throw new Error("Invalid analytics dataset");
  if (![1, 7, 30, 90].includes(days)) throw new Error("Invalid time range");
  const where = `timestamp >= NOW() - INTERVAL '${days}' DAY AND double1 = 0`;
  return {
    totals: `SELECT count(DISTINCT index1) AS activeUsers, sumIf(_sample_interval, blob1 = 'page_open') AS visits, sumIf(_sample_interval, blob1 = 'calculation_succeeded') AS calculations, sumIf(_sample_interval, blob1 = 'calculation_failed') AS failedCalculations FROM ${dataset} WHERE ${where}`,
    daily: `SELECT toStartOfDay(timestamp) AS day, count(DISTINCT index1) AS activeUsers, sumIf(_sample_interval, blob1 = 'calculation_succeeded') AS calculations FROM ${dataset} WHERE ${where} GROUP BY day ORDER BY day`,
    events: `SELECT blob1 AS event, sum(_sample_interval) AS count FROM ${dataset} WHERE ${where} GROUP BY event ORDER BY count DESC LIMIT 30`,
    locales: `SELECT blob4 AS locale, count(DISTINCT index1) AS activeUsers FROM ${dataset} WHERE ${where} AND blob4 != '' GROUP BY locale ORDER BY activeUsers DESC LIMIT 20`,
  };
}

async function loadDashboardSummary(env, days) {
  const dataset = env.ANALYTICS_DATASET || `factor_tools_usage_${env.ENVIRONMENT}`;
  const queries = dashboardQueries(dataset, days);
  const entries = await Promise.all(Object.entries(queries).map(async ([name, sql]) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ANALYTICS_ACCOUNT_ID}/analytics_engine/sql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ANALYTICS_READ_TOKEN}`, "Content-Type": "text/plain" },
      body: sql,
    });
    if (!response.ok) throw new Error(`Analytics Engine returned ${response.status}`);
    const value = await response.json();
    if (!value?.data || !Array.isArray(value.data)) throw new Error("Analytics Engine returned an invalid response");
    return [name, value.data];
  }));
  return { environment: env.ENVIRONMENT, days, generatedAt: new Date().toISOString(), ...Object.fromEntries(entries) };
}

let accessKeysCache = null;
let accessKeysExpiresAt = 0;

async function requireDashboardAccess(request, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return { ok: false, response: json({ error: "Dashboard access is not configured" }, 503) };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, response: json({ error: "Authentication required" }, 401) };
  try {
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const expectedIssuer = `https://${teamDomain}`;
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || payload.iss !== expectedIssuer || !audience.includes(env.CF_ACCESS_AUD)
        || Number(payload.exp || 0) <= now || Number(payload.nbf || 0) > now + 30) throw new Error("Invalid Access claims");
    const keys = await accessKeys(teamDomain);
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) throw new Error("Unknown Access signing key");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!verified) throw new Error("Invalid Access signature");
    const allowedEmails = String(env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (allowedEmails.length && !allowedEmails.includes(String(payload.email || "").toLowerCase())) {
      return { ok: false, response: json({ error: "Account is not allowed" }, 403) };
    }
    return { ok: true, email: payload.email || "" };
  } catch (_error) {
    return { ok: false, response: json({ error: "Authentication required" }, 401) };
  }
}

async function accessKeys(teamDomain) {
  if (accessKeysCache && Date.now() < accessKeysExpiresAt) return accessKeysCache;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Unable to load Access keys");
  const body = await response.json();
  accessKeysCache = Array.isArray(body.keys) ? body.keys : [];
  accessKeysExpiresAt = Date.now() + 60 * 60 * 1000;
  return accessKeysCache;
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function dashboardHtml(environment) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factor Tools 使用统计</title><style>
  :root{color-scheme:dark;background:#111827;color:#e5e7eb;font:15px system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:32px 20px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}h1{margin:0;font-size:26px}select{background:#1f2937;color:inherit;border:1px solid #4b5563;border-radius:8px;padding:8px 12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0}.card,section{background:#1f2937;border:1px solid #374151;border-radius:12px;padding:18px}.value{font-size:30px;font-weight:700;margin-top:8px;color:#fbbf24}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #374151}th:last-child,td:last-child{text-align:right}.muted{color:#9ca3af}.error{color:#fca5a5}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style></head><body>
  <header><div><h1>Factor Tools 使用统计</h1><div class="muted">${escapeHtml(environment)} 环境 · 已自动排除测试流量</div></div><label>时间范围 <select id="days"><option value="1">最近 1 天</option><option value="7" selected>最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select></label></header>
  <div id="status" class="muted">正在加载……</div><div class="cards" id="cards"></div><div class="grid"><section><h2>每日趋势</h2><table><thead><tr><th>日期</th><th>活跃用户</th><th>成功计算</th></tr></thead><tbody id="daily"></tbody></table></section><section><h2>语言</h2><table><thead><tr><th>语言</th><th>活跃用户</th></tr></thead><tbody id="locales"></tbody></table></section></div><section style="margin-top:16px"><h2>功能使用</h2><table><thead><tr><th>事件</th><th>次数</th></tr></thead><tbody id="events"></tbody></table></section>
  <script>const labels={activeUsers:'活跃用户',visits:'访问次数',calculations:'成功计算',failedCalculations:'失败计算'};const n=v=>new Intl.NumberFormat().format(Number(v||0));function rows(id,data,keys){const body=document.getElementById(id);body.replaceChildren(...data.map(item=>{const tr=document.createElement('tr');keys.forEach((key,i)=>{const td=document.createElement('td');td.textContent=i?n(item[key]):item[key];tr.append(td)});return tr}))}async function load(){const days=document.getElementById('days').value,status=document.getElementById('status');status.textContent='正在加载……';status.className='muted';try{const r=await fetch('/dashboard/api/summary?days='+days);if(!r.ok)throw new Error('读取失败（'+r.status+'）');const d=await r.json(),totals=d.totals[0]||{};document.getElementById('cards').replaceChildren(...Object.entries(labels).map(([key,label])=>{const x=document.createElement('div');x.className='card';const a=document.createElement('div'),b=document.createElement('div');a.textContent=label;b.className='value';b.textContent=n(totals[key]);x.append(a,b);return x}));rows('daily',d.daily,['day','activeUsers','calculations']);rows('locales',d.locales,['locale','activeUsers']);rows('events',d.events,['event','count']);status.textContent='更新时间：'+new Date(d.generatedAt).toLocaleString()}catch(e){status.textContent=e.message;status.className='error'}}document.getElementById('days').addEventListener('change',load);load();</script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function validateBatch(value, expectedEnvironment) {
  if (!value || value.schema !== 1) return { ok: false, error: "Unsupported schema" };
  const environment = text(value.environment, 16);
  if (!["staging", "production"].includes(environment) || environment !== expectedEnvironment) {
    return { ok: false, error: "Environment mismatch" };
  }
  const visitorId = text(value.visitorId, 96);
  if (!/^(?:test-)?[a-zA-Z0-9-]{16,96}$/.test(visitorId)) return { ok: false, error: "Invalid visitor identifier" };
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > MAX_EVENTS) {
    return { ok: false, error: "Invalid event batch" };
  }
  const events = [];
  for (const raw of value.events) {
    if (!raw || !EVENT_NAMES.has(raw.name)) return { ok: false, error: "Unknown event" };
    const dimensions = {};
    const metrics = {};
    for (const key of DIMENSIONS) {
      const item = text(raw.dimensions?.[key], 128);
      if (item) dimensions[key] = item;
    }
    for (const key of METRICS) {
      const number = Number(raw.metrics?.[key]);
      if (Number.isFinite(number) && number >= 0) metrics[key] = Math.min(number, 1_000_000_000);
    }
    events.push({ name: raw.name, dimensions, metrics });
  }
  return {
    ok: true,
    environment,
    visitorId,
    synthetic: value.synthetic === true,
    release: text(value.release, 64),
    locale: text(value.locale, 24) || "unknown",
    viewport: text(value.viewport, 16) || "unknown",
    events,
  };
}

export function toDataPoint(batch, event) {
  const dimensions = event.dimensions;
  const metrics = event.metrics;
  return {
    indexes: [batch.visitorId],
    blobs: [
      event.name, batch.environment, batch.release, batch.locale, batch.viewport,
      dimensions.context || "", dimensions.itemClass || "", dimensions.category || "",
      dimensions.view || "", dimensions.outcome || "", dimensions.reason || "",
    ],
    doubles: [
      batch.synthetic ? 1 : 0,
      metrics.durationMs || 0,
      metrics.targetCount || 0,
      metrics.recipeCount || 0,
      metrics.enabledRecipeCount || 0,
      metrics.resultRowCount || 0,
    ],
  };
}

function corsHeaders(origin, configured) {
  const allowed = String(configured || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function text(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
