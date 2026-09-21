const {test, expect} = require('@playwright/test');

test('initial loading screen explains progress until planner data is ready', async ({page}) => {
  let releaseMaterials;
  let releaseSupportingData;
  const materialsGate = new Promise(resolve => { releaseMaterials = resolve; });
  const supportingDataGate = new Promise(resolve => { releaseSupportingData = resolve; });

  await page.route('**/api/materials', async route => {
    await materialsGate;
    await route.continue();
  });
  await page.route(/\/api\/(summary|recipes)$/, async route => {
    await supportingDataGate;
    await route.continue();
  });

  await page.goto('/?lang=zh-CN&analytics_test=1', {waitUntil: 'domcontentloaded'});
  const loading = page.locator('#initialLoading');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('正在准备材料和配方数据');

  releaseMaterials();
  await expect(loading).toContainText('材料已准备完成，正在加载配方目录');

  releaseSupportingData();
  await expect(loading).toBeHidden();
  await expect(page.locator('#dataSummary')).toContainText('个配方');
});

test('initial loading screen offers retry when planner data fails', async ({page}) => {
  await page.route('**/api/materials', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({detail: 'temporarily unavailable'}),
  }));

  await page.goto('/?lang=zh-CN&analytics_test=1');
  const loading = page.locator('#initialLoading');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('生产规划工具加载失败');
  await expect(loading).toContainText('请检查网络连接，然后重试');
  await expect(page.getByRole('button', {name: '重新加载'})).toBeVisible();
});
