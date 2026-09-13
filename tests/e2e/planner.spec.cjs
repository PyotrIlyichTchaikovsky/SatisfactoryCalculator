const {test,expect} = require('@playwright/test');

test('deployed page calculates, draws, saves, restores and produces a correlated report', async ({page,request}) => {
  const failures=[];
  const apiOrigin=new URL(process.env.API_URL).origin;
  const expectedSha=process.env.EXPECTED_SHA || '';
  const legacy=process.env.LEGACY_BASELINE==='true';
  page.on('pageerror',error=>failures.push(error.message));
  page.on('requestfailed',req=>{
    if(['script','stylesheet','image','fetch','xhr'].includes(req.resourceType())) failures.push(req.url()+': '+req.failure()?.errorText);
  });
  const plannerApiPaths=new Set(['/api/summary','/api/materials','/api/recipes','/api/plan']);
  const apiRequests=[];
  page.on('request',req=>{if(plannerApiPaths.has(new URL(req.url()).pathname)) apiRequests.push(req.url());});
  let manifest={apiBaseUrl:process.env.API_URL,environment:process.env.EXPECTED_ENVIRONMENT};
  if(!legacy) {
    const manifestUrl=`/release.json?release=${encodeURIComponent(expectedSha)}`;
    await expect.poll(async()=>{
      const candidate=await request.get(manifestUrl,{headers:{'Cache-Control':'no-cache'}});
      if(!candidate.ok()) return '';
      return (await candidate.json()).sha || '';
    },{timeout:60000,message:'Wait for the fixed site URL to serve the candidate release'}).toBe(expectedSha);
    manifest=await (await request.get(manifestUrl,{headers:{'Cache-Control':'no-cache'}})).json();
  }
  await page.setExtraHTTPHeaders({'Cache-Control':'no-cache','Pragma':'no-cache'});
  let response;
  if(!legacy && expectedSha) {
    const expectedLabel=`Release test environment: ${expectedSha.slice(0,12)}`;
    await expect.poll(async()=>{
      response=await page.goto(`/?release=${encodeURIComponent(expectedSha)}&attempt=${Date.now()}`,{waitUntil:'domcontentloaded'});
      if(!response?.ok()) return '';
      return await page.locator('#releaseLabel').textContent().catch(()=> '');
    },{timeout:60000,message:'Wait for the fixed site URL to serve the candidate HTML'}).toBe(expectedLabel);
  } else {
    response=await page.goto('/');
  }
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('#dataSummary')).toContainText('recipes');
  if(expectedSha) expect(manifest.sha).toBe(expectedSha);
  if(process.env.EXPECTED_RELEASE_ID) expect(manifest.releaseId).toBe(process.env.EXPECTED_RELEASE_ID);
  expect(manifest.environment).toBe(process.env.EXPECTED_ENVIRONMENT);
  expect(manifest.apiBaseUrl).toBe(process.env.API_URL);
  if(!legacy && manifest.environment==='staging') {
    await expect(page.locator('#releaseLabel')).toContainText(`Release test environment: ${expectedSha.slice(0,12)}`);
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
