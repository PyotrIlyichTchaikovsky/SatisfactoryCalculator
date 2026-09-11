const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../recipe_web/planner_diagnostics.js'), 'utf8');
function setup(fetch, config = {}, search = '') {
  const events = [], tags = {}, listeners = {};
  let sentryOptions;
  const window = { PLANNER_CONFIG: { sentryDsn: 'https://public@example.com/1', sentryRelease: 'frontend-sha', ...config },
    location: {search},
    addEventListener(name, fn) { listeners[name] = fn; },
    crypto: { randomUUID: () => 'local-issue-id' },
    Sentry: { init(options) { sentryOptions = options; }, withScope(fn) { fn({setTag(k,v) {tags[k]=v;}}); },
      captureException(e) { events.push({message: e.message, tags: {...tags}}); } } };
  vm.runInNewContext(source, { window, document: {getElementById: () => null}, fetch,
    URLSearchParams, setTimeout(fn) { try {fn();} catch(error) {listeners.error({error});} },
    navigator: {userAgent: 'test-browser'}, Error, console });
  return { api: window.PlannerDiagnostics, events, listeners, options: sentryOptions };
}
function response(id, status = 200, payload = {ok:true}) {
  return { status, ok: status < 400, headers: {get: (key) => ({'X-Request-ID': id, 'X-Planner-Release':'backend-sha','X-Planner-Data-Version':'data-sha'}[key])}, json: async () => payload };
}
test('concurrent failed requests retain their own ID and exact submitted inputs', async () => {
  const {api, events} = setup(async (_, options) => response(JSON.parse(options.body).id, 503, {error:'Busy'}));
  const errors = await Promise.all(['one','two'].map(id => api.fetchJson('/api/plan', {method:'POST', body:JSON.stringify({id})}).catch(e => e)));
  errors.forEach(e => api.reportError(e, 'calculate'));
  assert.deepEqual(events.map(e => e.tags.request_id), ['one','two']);
  assert.equal(api.buildReport().lastIssue.request.payload.id, 'two');
  api.reportError(errors[0], 'calculate');
  assert.equal(events.length, 2);
});
test('render failure keeps successful calculation request ID', async () => {
  const {api, events} = setup(async () => response('render-id'));
  const result = await api.fetchJson('/api/plan');
  api.reportError(new Error('Drawing failed'), 'render', true, result);
  assert.equal(events[0].tags.request_id, 'render-id');
});
test('validation errors remain reportable without alert noise', async () => {
  const {api, events} = setup(async () => response('validation-id',400,{error:'Invalid rate'}));
  await api.fetchJson('/api/plan').catch(e => api.reportError(e,'calculate'));
  assert.equal(events.length,0);
  assert.equal(api.buildReport().lastIssue.id,'validation-id');
});
test('network and malformed-success responses are reportable', async () => {
  for (const fetch of [async () => {throw new Error('Offline');}, async () => response('bad-json',200,null)]) {
    const {api, events} = setup(fetch);
    await api.fetchJson('/api/summary').catch(e => api.reportError(e,'load'));
    assert.equal(events.length,1);
  }
});
test('global errors share issue IDs and scrub automatic telemetry', () => {
  const {api, events, listeners, options} = setup();
  listeners.error({error:new Error('Unexpected')});
  assert.equal(events[0].tags.issue_id,api.buildReport().lastIssue.id);
  const event = options.beforeSend({request:{url:'private'}, user:{id:'private'}, extra:{plan:'private'}, breadcrumbs:['private'], tags:{issue_id:'kept'}});
  assert.equal(JSON.stringify(event).includes('private'),false);
  assert.equal(event.tags.issue_id,'kept');
});
test('feedback snapshots survive subsequent edits and retain only ten requests', async () => {
  const {api} = setup(async () => response('id'));
  const state = {targets:[{rate:60}]};
  api.configure(() => state);
  api.reportError(new Error('Failure'), 'render');
  state.targets[0].rate=120;
  for(let i=0;i<12;i++) await api.fetchJson('/api/health');
  const report = api.buildReport();
  assert.equal(report.lastIssue.context.targets[0].rate,60);
  assert.equal(report.currentContext.targets[0].rate,120);
  assert.equal(report.recentRequests.length,10);
});

test('URL probe runs through global error reporting in staging and production', () => {
  for (const sentryEnvironment of ['staging','production']) {
    const {api,events,listeners} = setup(undefined,{sentryEnvironment},'?monitoring_test=frontend');
    listeners.load();
    assert.equal(events.length,1);
    assert.equal(events[0].tags.monitoring_test,'true');
    assert.equal(events[0].tags.stage,'unhandled-error');
    assert.equal(api.buildReport().environment,sentryEnvironment);
    assert.equal(api.buildReport().lastIssue.monitoringTest,true);
  }
});
test('normal visits, development, and missing SDK config do not trigger probes', () => {
  for (const [config, search] of [[{sentryEnvironment:'production'},''],[{sentryEnvironment:'development'},'?monitoring_test=frontend'],[{sentryEnvironment:'production',sentryDsn:''},'?monitoring_test=frontend']]) {
    const {events,listeners} = setup(undefined,config,search);
    listeners.load();
    assert.equal(events.length,0);
  }
});

test('SDK automatic wrappers cannot capture first and lose correlation tags', () => {
  const {options} = setup();
  const integrations = options.integrations(['GlobalHandlers','BrowserApiErrors','TryCatch','Dedupe'].map(name=>({name})));
  assert.equal(integrations.length,1);
  assert.equal(integrations[0].name,'Dedupe');
});
