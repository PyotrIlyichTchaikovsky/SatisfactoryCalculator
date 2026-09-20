const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'recipe_web', 'planner_analytics.js'), 'utf8');

function setup({search = '', endpoint = 'https://analytics.example/events', environment = 'production', webdriver = false} = {}) {
  const listeners = {};
  const storage = new Map();
  const requests = [];
  class FakeElement {
    constructor() { this.dataset = {}; }
    addEventListener() {}
    append() {}
    closest() { return null; }
    matches() { return false; }
    setAttribute() {}
  }
  const document = {
    body: {prepend() {}}, documentElement: {lang: 'zh-CN'}, visibilityState: 'visible',
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    createElement() { return new FakeElement(); },
  };
  const window = {
    PLANNER_CONFIG: {analyticsEndpoint: endpoint, sentryEnvironment: environment, sentryRelease: 'a'.repeat(40)},
    location: {search, href: `https://factor-tools.com/${search}` , replace() {}},
    localStorage: {getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); }, removeItem(key) { storage.delete(key); }},
    crypto: {randomUUID() { return 'd8e91920-e2cf-4496-a327-00f7449144e4'; }},
    innerWidth: 1280,
    setTimeout() { return 1; }, clearTimeout() {},
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
  };
  const context = {
    window, document, navigator: {webdriver, language: 'zh-CN', sendBeacon() { return true; }},
    fetch: async (url, options) => { requests.push({url, options}); return {ok: true}; },
    URL, URLSearchParams, Blob, Uint8Array, Element: FakeElement, performance,
    console,
  };
  vm.runInNewContext(source, context);
  for (const callback of listeners.DOMContentLoaded || []) callback();
  return {api: window.PlannerAnalytics, requests, storage};
}

test('local development never sends usage events', async () => {
  const {api, requests} = setup({endpoint: '', environment: 'development'});
  assert.equal(api.isEnabled(), false);
  assert.equal(api.track('calculation_started', {targetCount: 1}), false);
  await api.flush();
  assert.equal(requests.length, 0);
});

test('test URL persists synthetic mode and marks every event', async () => {
  const {api, requests, storage} = setup({search: '?analytics_test=1'});
  assert.equal(api.isSynthetic(), true);
  assert.equal(storage.get('factorTools.analyticsTestMode.v1'), 'true');
  api.track('calculation_succeeded', {durationMs: 25, targetCount: 1, privatePlan: 'never sent'});
  await api.flush();
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.synthetic, true);
  assert.equal(payload.events.some(event => JSON.stringify(event).includes('never sent')), false);
});

test('automated browsers are always synthetic and unknown events are ignored', async () => {
  const {api, requests} = setup({webdriver: true});
  assert.equal(api.isSynthetic(), true);
  assert.equal(api.track('unknown_event'), false);
  api.track('page_open');
  await api.flush();
  assert.equal(JSON.parse(requests[0].options.body).synthetic, true);
});
