const {defineConfig} = require('@playwright/test');
const remote = Boolean(process.env.SITE_URL);
const sha = remote ? (process.env.EXPECTED_SHA || '') : (process.env.GITHUB_SHA || 'local-release-check');
process.env.EXPECTED_SHA = sha;
process.env.EXPECTED_ENVIRONMENT ||= 'staging';
process.env.API_URL ||= 'http://127.0.0.1:8766';
module.exports = defineConfig({
  testDir: './tests/e2e', timeout: 60000, expect: {timeout: 15000}, retries: 0, workers: 1,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL:process.env.SITE_URL || 'http://127.0.0.1:8788', browserName:'chromium',
    channel:process.env.PLAYWRIGHT_CHANNEL || undefined, trace:'retain-on-failure', screenshot:'only-on-failure'},
  webServer: remote ? undefined : [
    {command:'python -m uvicorn production_planner_app:app --app-dir satisfactory_calculator/recipe_web --host 127.0.0.1 --port 8766',url:'http://127.0.0.1:8766/api/health',reuseExistingServer:false,
      env:{SENTRY_DSN:'',SENTRY_ENVIRONMENT:'staging',SENTRY_RELEASE:sha,PLANNER_ALLOWED_ORIGINS:'http://127.0.0.1:8788'}},
    {command:'python scripts/preview_frontend.py',url:'http://127.0.0.1:8788/',reuseExistingServer:false,
      env:{SENTRY_DSN:'',SENTRY_BROWSER_SCRIPT_URL:'',SENTRY_ENVIRONMENT:'staging',SENTRY_RELEASE:sha,RELEASE_ID:'local-check',PLANNER_API_BASE_URL:'http://127.0.0.1:8766',PUBLIC_SITE_URL:'http://127.0.0.1:8788',ADSENSE_ENABLED:'false',FRONTEND_OUTPUT_DIR:'dist/frontend'}}
  ]
});
