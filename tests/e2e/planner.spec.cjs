const {test,expect} = require('@playwright/test');

test('deployed page calculates, draws, saves, restores and produces a correlated report', async ({page,request}) => {
  const failures=[];
  const apiOrigin=new URL(process.env.API_URL).origin;
  page.on('pageerror',error=>failures.push(error.message));
  page.on('requestfailed',req=>{
    if(['script','stylesheet','image','fetch','xhr'].includes(req.resourceType())) failures.push(req.url()+': '+req.failure()?.errorText);
  });
  const apiRequests=[];
  page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/')) apiRequests.push(req.url());});
  const response=await page.goto('/');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('#dataSummary')).toContainText('recipes');
  const legacy=process.env.LEGACY_BASELINE==='true';
  const manifest=legacy ? {apiBaseUrl:process.env.API_URL,environment:process.env.EXPECTED_ENVIRONMENT} : await (await request.get('/release.json')).json();
  if(process.env.EXPECTED_SHA) expect(manifest.sha).toBe(process.env.EXPECTED_SHA);
  if(process.env.EXPECTED_RELEASE_ID) expect(manifest.releaseId).toBe(process.env.EXPECTED_RELEASE_ID);
  expect(manifest.environment).toBe(process.env.EXPECTED_ENVIRONMENT);
  expect(manifest.apiBaseUrl).toBe(process.env.API_URL);
  if(!legacy && manifest.environment==='staging') {
    await expect(page.locator('#releaseLabel')).toContainText('Release test environment');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
  await page.locator('.item-input').first().fill('Iron Plate');
  await page.locator('.suggestion-option').filter({has:page.getByText('Iron Plate',{exact:true})}).first().click();
  await page.locator('.amount-input').first().fill('60');
  const planResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plan');
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  const calculated=await planResponse;
  expect(calculated.status()).toBe(200);
  if(!legacy) expect(calculated.headers()['x-request-id']).toBeTruthy();
  const result=await calculated.json();
  expect(result.targets[0].item.className).toBe('Desc_IronPlate_C');
  expect(result.targets[0].rate).toBe(60);
  expect(result.recipeRuns.length).toBeGreaterThan(0);
  await expect(page.locator('#statusMessage')).toContainText('Optimized');
  await expect(page.locator('.graph-node').first()).toBeVisible();
  expect(await page.locator('#treeView svg path').count()).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'Merged Table'}).click();
  await expect(page.locator('#tableView')).toBeVisible();
  await expect(page.locator('#tableView')).toContainText('Iron Plate');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await expect(page.locator('#dataSummary')).toContainText('recipes');
  await expect(page.locator('.item-input').first()).toHaveValue('Iron Plate');
  await expect(page.locator('.amount-input').first()).toHaveValue('60');
  await expect(page.locator('#savedPlanSelect .plan-picker-button')).toBeEnabled();
  if(!legacy) {
  await page.getByRole('button',{name:'Report a problem',exact:true}).click();
  const report=JSON.parse(await page.locator('#diagnosticsOutput').inputValue());
  if(!legacy) expect(report.frontendRelease).toBe(manifest.sha);
  if(!legacy) expect(report.environment).toBe(manifest.environment);
  expect(report.recentRequests.every(r=>r.requestId)).toBeTruthy();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  }
  expect(apiRequests.length).toBeGreaterThan(3);
  expect(apiRequests.every(url=>new URL(url).origin===apiOrigin)).toBeTruthy();
  expect(failures).toEqual([]);
});
