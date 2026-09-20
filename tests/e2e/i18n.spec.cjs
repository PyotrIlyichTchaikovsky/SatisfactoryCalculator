const {test, expect} = require('@playwright/test');

test('Simplified Chinese localizes UI, official game names, search, and calculation results', async ({page}) => {
  const response = await page.goto('/?lang=zh-CN&analytics_test=1');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('.analytics-test-banner')).toBeVisible();
  expect(await page.evaluate(() => window.PlannerAnalytics.isSynthetic())).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#languageSelect')).toHaveValue('zh-CN');
  await expect(page.getByRole('heading', {name: '生产目标'})).toBeVisible();
  await expect(page.locator('#dataSummary')).toContainText('个配方');

  await page.locator('.item-input').first().click();
  await expect(page.getByRole('dialog', {name: '选择目标材料'})).toBeVisible();
  await page.getByRole('searchbox', {name: '搜索材料'}).fill('铁板');
  await expect(page.getByRole('option', {name: '选择铁板', exact: true})).toBeVisible();
  await page.getByRole('option', {name: '选择铁板', exact: true}).click();
  await expect(page.locator('.item-input').first()).toHaveValue('铁板');
  await page.locator('.amount-input').first().fill('60');
  await page.getByRole('button', {name: '计算', exact: true}).click();
  await expect(page.locator('#statusMessage')).toContainText('已优化');
  await expect(page.locator('#treeView')).toContainText('铁板');
});

test('material order follows the same game progression in every language', async ({page}) => {
  async function visibleOrder(language) {
    await page.goto(`/?lang=${language}&analytics_test=1`);
    await expect(page.locator('#dataSummary')).not.toContainText(language === 'zh-CN' ? '正在连接' : 'Connecting');
    await page.locator('.item-input').first().click();
    await expect(page.locator('.material-picker-dialog')).toBeVisible();
    await page.locator('.material-picker-category').nth(1).click();
    return page.locator('.material-picker-card').evaluateAll(cards => cards.slice(0, 30).map(card => card.dataset.itemId));
  }

  const english = await visibleOrder('en-US');
  const chinese = await visibleOrder('zh-CN');
  expect(chinese).toEqual(english);
  expect(english.slice(0, 4)).toEqual(['Desc_Leaves_C', 'Desc_Wood_C', 'Desc_Mycelia_C', 'Desc_HogParts_C']);
  expect(english.indexOf('Desc_OreIron_C')).toBeLessThan(english.indexOf('Desc_IronIngot_C'));
  expect(english.indexOf('Desc_IronIngot_C')).toBeLessThan(english.indexOf('Desc_IronPlate_C'));
});
