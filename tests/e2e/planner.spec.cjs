const {test,expect} = require('@playwright/test');

test('deployed page calculates, draws, saves, restores and has no manual report UI', async ({page,request}) => {
  const failures=[];
  const apiOrigin=new URL(process.env.API_URL).origin;
  const expectedSha=process.env.EXPECTED_SHA || '';
  const legacy=process.env.LEGACY_BASELINE==='true';
  page.on('pageerror',error=>failures.push(error.message));
  page.on('requestfailed',req=>{
    const errorText=req.failure()?.errorText || '';
    if(errorText==='net::ERR_ABORTED') return;
    if(['script','stylesheet','image','fetch','xhr'].includes(req.resourceType())) failures.push(req.url()+': '+errorText);
  });
  const plannerApiPaths=new Set(['/api/summary','/api/materials','/api/recipes','/api/plan']);
  const apiRequests=[];
  page.on('request',req=>{if(plannerApiPaths.has(new URL(req.url()).pathname)) apiRequests.push(req.url());});
  let manifest={apiBaseUrl:process.env.API_URL,environment:process.env.EXPECTED_ENVIRONMENT};
  if(!legacy) {
    const manifestUrl=`/release.json?release=${encodeURIComponent(expectedSha)}`;
    let candidateManifest;
    await expect.poll(async()=>{
      const candidate=await request.get(manifestUrl,{headers:{'Cache-Control':'no-cache'}});
      if(!candidate.ok()) return '';
      try {
        candidateManifest=await candidate.json();
        return candidateManifest.sha || '';
      } catch {
        return '';
      }
    },{timeout:60000,message:'Wait for the fixed site URL to serve the candidate release'}).toBe(expectedSha);
    manifest=candidateManifest;
  }
  let response;
  if(!legacy && expectedSha) {
    const expectedLabel=manifest.environment==='staging'
      ? `Release test environment · Version ${manifest.version}`
      : `Version ${manifest.version}`;
    await expect.poll(async()=>{
      response=await page.goto(`/?release=${encodeURIComponent(expectedSha)}&attempt=${Date.now()}&analytics_test=1`,{waitUntil:'domcontentloaded'});
      if(!response?.ok()) return '';
      return await page.locator('#releaseLabel').textContent().catch(()=> '');
    },{timeout:60000,message:'Wait for the fixed site URL to serve the candidate HTML'}).toBe(expectedLabel);
    await page.waitForLoadState('load');
    failures.length=0;
    response=await page.reload({waitUntil:'load'});
  } else {
    response=await page.goto('/?analytics_test=1');
  }
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('.analytics-test-banner')).toBeVisible();
  expect(await page.evaluate(() => window.PlannerAnalytics.isSynthetic())).toBe(true);
  await expect(page.locator('#dataSummary')).toContainText('recipes', {timeout: 30000});
  if(expectedSha) expect(manifest.sha).toBe(expectedSha);
  if(!legacy) expect(manifest.version).toMatch(/^v\d{4}\.\d{2}\.\d{2}\.\d+\.\d+$/);
  if(process.env.EXPECTED_RELEASE_ID) expect(manifest.releaseId).toBe(process.env.EXPECTED_RELEASE_ID);
  expect(manifest.environment).toBe(process.env.EXPECTED_ENVIRONMENT);
  expect(manifest.apiBaseUrl).toBe(process.env.API_URL);
  if(!legacy && manifest.environment==='staging') {
    await expect(page.locator('#releaseLabel')).toHaveText(`Release test environment · Version ${manifest.version}`);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
  await expect(page.locator('.amount-input').first()).toHaveValue('1');
  await expect(page.locator('.target-row')).toHaveCount(1);
  await expect(page.locator('.item-input').first()).toHaveValue('');
  await expect(page.locator('.plan-library')).toBeHidden();
  await expect(page.getByRole('button',{name:'Add item',exact:true})).toHaveText('+');
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  await expect(page.locator('.item-input-box').first()).toHaveClass(/invalid/);
  await page.locator('.item-input').first().click();
  await expect(page.getByRole('dialog',{name:'Choose Target Material'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Recently Selected/})).toBeVisible();
  await expect(page.locator('.material-picker-category').first()).toContainText('Recently Selected');
  await expect(page.getByRole('button',{name:/Tier Target Materials/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Manufactured Items/})).toBeVisible();
  await page.getByRole('button',{name:/Tier Target Materials/}).click();
  await expect(page.locator('.material-picker-card-tier').first()).toHaveText('Tier 1');
  await expect(page.locator('.material-picker-card-tier').nth(5)).toHaveText('Tier 2');
  await page.getByRole('option',{name:'Select Iron Plate',exact:true}).click();
  await expect(page.locator('.item-input').first()).toHaveValue('Iron Plate');
  await expect(page.locator('.item-input-box').first()).not.toHaveClass(/invalid/);
  await expect(page.locator('.target-row').first()).toHaveAttribute('data-item-class','Desc_IronPlate_C');
  await page.getByRole('button',{name:/^Recipe Filter/}).click();
  await expect(page.getByRole('button',{name:'Selected Only',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Show Base Recipes',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select All',exact:true})).toHaveCount(0);
  expect(await page.locator('.recipe-row.base-recipe').count()).toBeGreaterThan(0);
  await expect(page.locator('.recipe-row.base-recipe').first()).toContainText('[Base Recipe]');
  await expect(page.locator('.recipe-row.base-recipe .recipe-filter-checkbox').first()).toBeEnabled();
  await page.getByRole('button',{name:'Choose Material',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Choose Material for Recipe Search'})).toBeVisible();
  await page.getByRole('button',{name:/Recently Selected/}).click();
  await page.getByRole('option',{name:'Select Iron Plate',exact:true}).click();
  await expect(page.locator('.recipe-material-group')).toHaveCount(1);
  await expect(page.locator('.recipe-material-group')).toContainText('Iron Plate');
  await expect(page.getByRole('button',{name:'Material: Iron Plate',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear Material',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
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
  await page.getByRole('button',{name:/^Recipe Filter/}).click();
  await page.getByRole('button',{name:'Choose Material',exact:true}).click();
  await page.getByRole('button',{name:/Recently Selected/}).click();
  await page.getByRole('option',{name:'Select Iron Plate',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use This Recipe',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'In Use',exact:true})).toHaveCount(0);
  await page.locator('.recipe-row[data-recipe-id="Recipe_IronPlate_C"] .recipe-filter-checkbox').uncheck();
  const steelCastPlateRow=page.locator('.recipe-row',{hasText:'Alternate: Steel Cast Plate'});
  await steelCastPlateRow.locator('.recipe-filter-checkbox').check();
  const switchedPlanResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plan');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const switchedPlan=await switchedPlanResponse;
  expect(switchedPlan.status()).toBe(200);
  const switchedResult=await switchedPlan.json();
  expect(switchedResult.recipeRuns.some(run=>run.id==='Recipe_Alternate_SteelCastedPlate_C')).toBeTruthy();
  expect(switchedResult.recipeRuns.filter(run=>run.outputs.some(output=>output.item.className==='Desc_IronPlate_C')).map(run=>run.id)).toEqual(['Recipe_Alternate_SteelCastedPlate_C']);
  expect(switchedResult.rawTotals.reduce((sum,row)=>sum+Number(row.rate||0),0)).toBeLessThan(1000);
  await expect(page.locator('#statusMessage')).toContainText('Optimized');
  await expect(page.locator('.graph-node.recipe.alternate .graph-node-kind .alternate-recipe-tag')).toContainText('ALT');
  await expect(page.locator('.graph-node.recipe.alternate .graph-node-kind')).toContainText('Recipe');
  await page.getByRole('button',{name:'Find Recipe',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Find Recipe'})).toBeVisible();
  expect(await page.locator('.recipe-finder-row').count()).toBeGreaterThan(0);
  await expect(page.locator('.recipe-finder-row').first().locator('.recipe-finder-output-icon')).toBeVisible();
  await expect(page.locator('.recipe-finder-row').first().locator('.recipe-finder-formula')).toContainText('=');
  await page.getByRole('button',{name:'Choose Material',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Choose Material in Current Plan'})).toBeVisible();
  await page.getByRole('option',{name:'Select Iron Plate',exact:true}).click();
  await expect(page.locator('.recipe-finder-row')).toHaveCount(1);
  await page.locator('.recipe-finder-row').click();
  await expect(page.locator('.recipe-finder-overlay')).toHaveCount(0);
  await expect(page.locator('.graph-node.recipe.alternate.located')).toBeVisible();
  await page.getByRole('button',{name:/^Recipe Filter/}).click();
  const groupStates=await page.locator('.recipe-material-group').evaluateAll(groups=>groups.map(group=>({
    modified:group.classList.contains('modified'),
    open:group.open,
  })));
  const firstUnmodifiedIndex=groupStates.findIndex(group=>!group.modified);
  expect(groupStates.some(group=>group.modified)).toBeTruthy();
  expect(firstUnmodifiedIndex).toBeGreaterThan(0);
  expect(groupStates.slice(0,firstUnmodifiedIndex).every(group=>group.modified&&group.open)).toBeTruthy();
  expect(groupStates.slice(firstUnmodifiedIndex).every(group=>!group.modified&&!group.open)).toBeTruthy();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const retainedPlanResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plan');
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  const retainedPlan=await retainedPlanResponse;
  const retainedResult=await retainedPlan.json();
  expect(retainedResult.recipeRuns.some(run=>run.id==='Recipe_Alternate_SteelCastedPlate_C')).toBeTruthy();
  await page.getByRole('tab',{name:'Merged Table'}).click();
  await expect(page.locator('#tableView')).toBeVisible();
  await expect(page.locator('#tableView')).toContainText('Iron Plate');
  await expect(page.locator('#tableView .alternate-recipe-tag')).toContainText('ALT');
  await page.locator('.table-switch-recipe-button').first().click();
  await expect(page.getByRole('dialog',{name:'Recipe Filter'})).toBeVisible();
  await expect(page.locator('.recipe-material-group')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Clear Material',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use This Recipe',exact:true})).toHaveCount(0);
  await expect(page.locator('.direct-raw-base-recipe')).toContainText('[Base Recipe]');
  await expect(page.locator('.direct-raw-base-recipe')).toContainText('Directly');
  await expect(page.locator('.direct-raw-checkbox')).toBeChecked();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.graph-node.raw.located')).toBeVisible();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await expect(page.locator('#dataSummary')).toContainText('recipes', {timeout: 30000});
  await expect(page.locator('.item-input').first()).toHaveValue('Iron Plate');
  await expect(page.locator('.amount-input').first()).toHaveValue('60');
  await expect(page.locator('#savedPlanSelect .plan-picker-button')).toBeEnabled();
  const restoredPlanResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/plan');
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  const restoredPlan=await restoredPlanResponse;
  const restoredResult=await restoredPlan.json();
  expect(restoredResult.recipeRuns.some(run=>run.id==='Recipe_Alternate_SteelCastedPlate_C')).toBeTruthy();
  await expect(page.getByRole('button',{name:'Report a problem',exact:true})).toHaveCount(0);
  await expect(page.locator('#diagnosticsDialog')).toHaveCount(0);
  expect(apiRequests.length).toBeGreaterThan(3);
  expect(apiRequests.every(url=>new URL(url).origin===apiOrigin)).toBeTruthy();
  expect(failures).toEqual([]);
});
