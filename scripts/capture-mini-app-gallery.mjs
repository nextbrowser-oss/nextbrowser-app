// Render the shipped guest HTML. All host responses stay in this isolated browser context.
// Pass app IDs to capture only those apps: node scripts/capture-mini-app-gallery.mjs swipeforge
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import catalogModule from '../electron/mini-apps/catalog.cjs';
const { catalog, catalogIds } = catalogModule;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const only = process.argv.slice(2);
// A demonstration SwipeForge workspace: sample titles and gradient placeholders, no real media.
const minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();
const art = (a, b) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="360" height="450" fill="url(#g)"/></svg>`).toString('base64');
const creations = [
  { id:'00000000-0000-4000-8000-000000000001', type:'video', status:'in_progress', title:'A paper boat drifting through a rainy neon street', model:'veo-3', at:2 },
  { id:'00000000-0000-4000-8000-000000000002', type:'video', status:'success', title:'Morning coffee pour in slow motion', model:'gen4_turbo', at:45, art:art('#2b5876', '#4e4376') },
  { id:'00000000-0000-4000-8000-000000000003', type:'image', status:'success', title:'Headphones on warm sand, soft morning light', model:'gen4_image', at:180, art:art('#f7971e', '#ffd200') },
  { id:'00000000-0000-4000-8000-000000000004', type:'text', status:'success', title:'Five hooks for a fitness app launch', model:'gemini-3.5-flash', at:600 },
];
const cards = [
  { id:'draft', stage:'To do', title:'Write the release notes', notes:'Summarize the changes in this release.' },
  { id:'review', stage:'In progress', title:'Review the screenshots', notes:'Check each screen at desktop and mobile sizes.' },
  { id:'qa', stage:'Done', title:'Test the new board', notes:'Verify the task list after reopening.' }
];
try {
  for (const id of catalogIds.filter(id => !only.length || only.includes(id))) {
    const wide = id === 'swipeforge';
    const context = await browser.newContext({ viewport:wide ? {width:1200,height:675} : {width:800,height:450}, deviceScaleFactor:wide ? 1 : 1.5, reducedMotion:'reduce', colorScheme:wide ? 'light' : 'dark' });
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
        else if (input.action === 'thumbnail') json = {image:creations.find(c => c.id === input.contentId)?.art ?? null};
        else {
          const fixtures = {get_workspace:{status:200,data:{tenant:{name:'Demo studio'},email:'demo@example.com',mcp:{unmetered:true}}},
            get_generation_access:{status:200,data:{status:'unlocked'}},
            get_generation_models:{models:[{providerId:'google',model:'veo-3',type:'video',available:true,priced:true}]},
            list_content:{status:200,data:{items:creations.map(c => ({id:c.id,type:c.type,status:c.status,title:c.title,createdAt:minutesAgo(c.at),generationParams:{providerId:'demo',model:c.model}})),pagination:{page:1,totalPages:1}}}};
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
      await page.locator('#recent .item img').nth(1).waitFor();
      await capture('workspace');
      connected = false;
      await page.reload();
      await page.locator('#connect-card').waitFor();
      await capture('connect');
    }
    await context.close();
  }
} finally { await browser.close(); }
