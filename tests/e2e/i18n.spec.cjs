const {test, expect} = require('@playwright/test');

test('Simplified Chinese localizes UI, official game names, search, and calculation results', async ({page}) => {
  const response = await page.goto('/?lang=zh-CN');
  expect(response.ok()).toBeTruthy();
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
