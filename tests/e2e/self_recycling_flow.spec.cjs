const {test,expect} = require('@playwright/test');

test('same-recipe material recycling is drawn through a bus in normal and compact views', async ({page,request}) => {
  const apiOrigin = process.env.API_URL || 'http://127.0.0.1:8766';
  const catalogResponse = await request.get(`${apiOrigin}/api/recipes`);
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = await catalogResponse.json();
  const enabledRecipeIds = new Set(catalog.defaultEnabledRecipeIds || []);
  enabledRecipeIds.delete('Recipe_AluminumScrap_C');
  enabledRecipeIds.add('Recipe_Alternate_InstantScrap_C');

  await page.addInitScript(({recipeIds}) => {
    localStorage.setItem('satisfactoryProductionPlanner.v1', JSON.stringify({
      targets: [{itemClass:'Desc_AluminumScrap_C', itemName:'Aluminum Scrap', rate:'30'}],
      enabledRecipeIds: recipeIds,
    }));
  }, {recipeIds:Array.from(enabledRecipeIds)});
  await page.goto('/?analytics_test=1');
  await expect(page.locator('#dataSummary')).toContainText('recipes', {timeout:30000});
  await page.locator('#calculateButton').click();

  const instantScrap = page.locator('.graph-node[data-node-id="Recipe_Alternate_InstantScrap_C"]');
  await expect(instantScrap).toBeVisible({timeout:30000});
  await expect(page.locator('#treeView .graph-flow.self-feed.bus-route')).toHaveCount(1);

  await instantScrap.click();
  const focusButton = instantScrap.locator('.compact-focus-entry');
  await expect(focusButton).toBeVisible();
  await focusButton.click();
  const focusView = page.locator('.compact-focus-view');
  await expect(focusView).toBeVisible();
  await expect(focusView.locator('.graph-flow.self-feed.bus-route')).toHaveCount(1);
});
