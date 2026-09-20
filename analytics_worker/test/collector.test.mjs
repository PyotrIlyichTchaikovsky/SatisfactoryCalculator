import test from "node:test";
import assert from "node:assert/strict";
import worker, {dashboardQueries, toDataPoint, validateBatch} from "../src/index.mjs";

const base = {
  schema: 1,
  visitorId: "d8e91920-e2cf-4496-a327-00f7449144e4",
  synthetic: false,
  environment: "production",
  release: "a".repeat(40),
  locale: "zh-CN",
  viewport: "desktop",
  events: [{ name: "calculation_succeeded", dimensions: { context: "button", ignored: "private" }, metrics: { durationMs: 125, targetCount: 2 } }],
};

test("validates the fixed event schema and maps analytics columns", () => {
  const batch = validateBatch(base, "production");
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.events[0].dimensions, { context: "button" });
  const point = toDataPoint(batch, batch.events[0]);
  assert.equal(point.indexes[0], base.visitorId);
  assert.equal(point.blobs[0], "calculation_succeeded");
  assert.equal(point.doubles[0], 0);
  assert.equal(point.doubles[1], 125);
  assert.equal(point.doubles[2], 2);
});

test("rejects foreign environments and arbitrary events", () => {
  assert.equal(validateBatch(base, "staging").ok, false);
  assert.equal(validateBatch({...base, events: [{name: "send_complete_plan"}]}, "production").ok, false);
});

test("collector enforces origin and records synthetic events separately", async () => {
  const points = [];
  const env = {
    ENVIRONMENT: "production",
    ALLOWED_ORIGINS: "https://factor-tools.com",
    USAGE_EVENTS: { writeDataPoint(point) { points.push(point); } },
  };
  const denied = await worker.fetch(new Request("https://analytics.example/events", {
    method: "POST", headers: {Origin: "https://evil.example"}, body: JSON.stringify(base),
  }), env);
  assert.equal(denied.status, 403);

  const accepted = await worker.fetch(new Request("https://analytics.example/events", {
    method: "POST", headers: {Origin: "https://factor-tools.com"}, body: JSON.stringify({...base, synthetic: true}),
  }), env);
  assert.equal(accepted.status, 202);
  assert.equal(points.length, 1);
  assert.equal(points[0].doubles[0], 1);
});

test("dashboard queries always exclude synthetic traffic", () => {
  const queries = dashboardQueries("factor_tools_usage_production", 7);
  for (const sql of Object.values(queries)) assert.match(sql, /double1 = 0/);
  assert.match(queries.events, /SUM\(_sample_interval\)/i);
  assert.throws(() => dashboardQueries("dataset; DROP TABLE events", 7));
  assert.throws(() => dashboardQueries("factor_tools_usage_production", 365));
});

test("dashboard requires a valid Cloudflare Access identity", async () => {
  const response = await worker.fetch(new Request("https://analytics.example/dashboard"), {});
  assert.equal(response.status, 503);
});
