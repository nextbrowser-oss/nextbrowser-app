// Render the shipped guest HTML. All host responses stay in this isolated browser context.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import catalogModule from '../electron/mini-apps/catalog.cjs';
const { catalog, catalogIds } = catalogModule;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const cards = [
  { id:'draft', stage:'To do', title:'Write the release notes', notes:'Summarize the changes in this release.' },
  { id:'review', stage:'In progress', title:'Review the screenshots', notes:'Check each screen at desktop and mobile sizes.' },
  { id:'qa', stage:'Done', title:'Test the new board', notes:'Verify the task list after reopening.' }
];
try {
  for (const id of catalogIds) {
    const wide = id === 'swipeforge';
    const context = await browser.newContext({ viewport:wide ? {width:960,height:540} : {width:800,height:450}, deviceScaleFactor:wide ? 1.25 : 1.5, reducedMotion:'reduce', colorScheme:wide ? 'light' : 'dark' });
    const page = await context.newPage();
    await page.addInitScript(() => Object.defineProperty(document, 'modelContext', {value:{registerTool() {}}}));
    let connected = true;
    const html = JSON.parse(catalog(id)).html;
    const capture = async file => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({path:fileURLToPath(new URL('../public/mini-app-listings/'+id+'/'+file+'.png', import.meta.url)),animations:'disabled'});
    };
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://gallery.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      const input = req.postDataJSON() || {};
      let json = {};
      if (url.pathname === '/state') json = {revision:1,value:{cards}};
      if (url.pathname === '/music') json = input.action === 'status'
        ? {available:true,playing:false,title:'Evening Session',artist:'Demo track'}
        : {selected:'demo',accounts:[{id:'demo',label:'Studio playlist',service:'spotify'}],services:[{id:'spotify',name:'Spotify'},{id:'youtube',name:'YouTube Music'}]};
      if (url.pathname === '/swipeforge') {
        if (input.action === 'status') json = {connected};
        else {
          const fixtures = {get_workspace:{tenant:{name:'Demo studio'}},get_generation_models:{models:[{providerId:'demo',model:'Demo video model',type:'video',available:true}]},list_content:{items:[]}};
          json = {value:fixtures[input.tool] || {}};
        }
      }
      return route.fulfill({json});
    });
    await page.goto('https://gallery.test/');
    if (id === 'kanban') {
      await page.getByText(cards[1].title).waitFor();
      await capture('board');
      await page.getByRole('button',{name:'Edit',exact:true}).first().click();
      await capture('editor');
    } else if (id === 'music-player') {
      await page.getByText('Evening Session').waitFor();
      await capture('player');
      await page.locator('#choose').click();
      await page.locator('#manage').click();
      await capture('account');
    } else {
      await page.getByText('Demo studio').waitFor();
      await page.locator('#model option').first().waitFor({state:'attached'});
      await capture('workspace');
      connected = false;
      await page.reload();
      await page.locator('#connect-card').waitFor();
      await capture('connect');
    }
    await context.close();
  }
} finally { await browser.close(); }
