import assert from 'node:assert/strict';

export async function checkMiniAppDock(page) {
  const tab = page.getByRole('tab', { name: 'Kanban', exact: true });
  const pane = page.getByRole('tabpanel', { name: 'Kanban', exact: true });
  const chat = page.locator('#live-side-chat');
  const guest = pane.locator('webview');
  async function rect(locator) {
    await locator.waitFor({state: 'visible'});
    const box = await locator.boundingBox();
    assert(box && box.width > 0 && box.height > 0);
    return box;
  }
  async function dragTo(target) {
    const from = await rect(tab);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, {steps: 16});
    await page.locator('.live-dock-preview').waitFor({state:'visible'});
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Open beside chat' }).click();
  const first = await rect(pane), primary = await rect(chat);
  assert(first.x > primary.x && Math.abs(first.width - primary.width) <= 1);
  await guest.waitFor();
  const guestId = await guest.evaluate(view => view.getWebContentsId());
  const separator = page.getByRole('separator', {name: 'Resize workspace panels'}).first();
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  assert((await rect(chat)).width > primary.width);
  await dragTo({x: primary.x + 4, y: primary.y + primary.height / 2});
  assert((await rect(pane)).x < (await rect(chat)).x);
  assert.equal(await guest.evaluate(view => view.getWebContentsId()), guestId);
  const pill = await rect(page.getByRole('tab', { name: 'Open Project', exact: true }));
  await dragTo({x: pill.x + pill.width / 2, y: pill.y + pill.height / 2});
  assert.equal(await chat.isVisible(), false);
  await page.getByRole('tab', { name: 'Open Project', exact: true }).click();
  await chat.waitFor({state: 'visible'});
  await tab.click();
  assert.equal(await guest.evaluate(view => view.getWebContentsId()), guestId);
  await page.reload();
  await rect(pane);
  assert.equal(await chat.isVisible(), false);
  await page.getByRole('button', { name:'Close Kanban',exact:true }).click();
  await rect(chat);
  await page.getByRole('button', { name:'Add mini app to session' }).click();
  await page.getByRole('dialog', {name:'Add mini app to session'}).getByRole('button', {name:'Kanban',exact:true}).click();
  await rect(pane);
  await page.getByRole('button', { name:'Close Kanban',exact:true }).click();
  await page.getByRole('button', {name:'Open Extensions',exact:true}).click();
  await page.getByRole('dialog', {name:'Extensions'}).getByRole('button', {name:'Open Mini Apps',exact:true}).click();
  await page.getByRole('navigation', {name:'Installed mini apps'}).getByRole('button', {name:'Kanban',exact:true}).click();
}
