import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// An isolated renderer fixture: no app account, Electron bridge, user profile or network services.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Tooltip,TooltipProvider} from '/src/shared/ui/index.ts';
import '/src/styles.css';
const h=React.createElement;
document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme')||'light';
window.parentEscapes=0;
window.addEventListener('keydown',e=>{if(e.key==='Escape')window.parentEscapes++});
const hint=(content,props,text,side='top')=>h(Tooltip,{content,side},h('button',props,text));
createRoot(document.getElementById('root')).render(h(TooltipProvider,null,
 h('main',{style:{padding:40,display:'grid',gap:32}},
  h('h1',null,'Shared tooltip — isolated interaction fixture'),
  h('p',null,'The component and palette below are imported directly from the app source.'),
  h('div',{style:{overflow:'hidden',width:100,border:'1px solid var(--line)',padding:8}},
   hint('Skills',{id:'rail',style:{width:70}},'Skills','right')),
  hint('Connect an account first',{id:'disabled',disabled:true,style:{width:100}},'Send'),
  h(Tooltip,{content:'Read only when keywords are set'},h('label',{style:{width:180}},h('input',{id:'toggle',type:'checkbox'}),'Watch comments')),
  hint('Long explanation. '.repeat(200),{id:'long',style:{width:140}},'Long explanation'),
  hint('This hint stays inside the viewport',{id:'edge',style:{position:'fixed',right:8,bottom:8}},'Edge','right')
 )));
`;
const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", chromium.executablePath()];
const executablePath = candidates.find(path => path && existsSync(path));
if (!executablePath) throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an installed Chromium browser.");
const output = resolve("e2e-out/shared-tooltips");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "shared-tooltip-fixture",
  resolveId: id => id === "virtual:tooltip-fixture" ? "\0tooltip-fixture" : undefined,
  load: id => id === "\0tooltip-fixture" ? fixture : undefined,
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/tooltip-fixture")) return next();
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>Tooltip fixture</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__tooltip-fixture"></script></body></html>');
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tooltip-fixture`;
  const popup = page.getByRole("tooltip");
  for (const theme of ["light", "dark"]) {
    await page.goto(`${url}?theme=${theme}`);
    await page.locator("#rail").waitFor();
    await page.keyboard.press("Tab");
    await popup.waitFor();
    assert.equal(await popup.textContent(), "Skills", "keyboard focus opens the rail hint");
    const rail = await page.locator("#rail").boundingBox();
    const hint = await popup.boundingBox();
    assert.ok(hint.x >= rail.x + rail.width, "portal escapes the rail's clipped container");
    const style = await popup.evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color, blur: getComputedStyle(element).backdropFilter, radius: getComputedStyle(element).borderRadius }));
    assert.equal(style.text, theme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 28)");
    assert.ok(style.bg.includes(theme === "light" ? "25, 25, 32" : "244, 244, 250"));
    assert.ok(style.blur.includes("blur(22px)"));
    assert.equal(style.radius, "13px");
    await page.screenshot({ path: resolve(output, `${theme}-rail.png`) });
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.parentEscapes), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.parentEscapes), 1);

    await page.keyboard.press("Tab");
    await popup.waitFor();
    assert.equal(await popup.textContent(), "Read only when keywords are set");
    assert.equal(await page.locator("#toggle").getAttribute("aria-describedby"), await popup.getAttribute("id"));
    await page.keyboard.press("Escape");

    await page.locator("#disabled").hover();
    await popup.waitFor();
    assert.equal(await popup.textContent(), "Connect an account first");
    assert.equal(await page.locator("#disabled").isDisabled(), true);
    await page.screenshot({ path: resolve(output, `${theme}-disabled.png`) });

    await page.locator("#long").hover();
    await popup.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent?.startsWith("Long explanation"));
    await popup.hover();
    await page.waitForTimeout(150);
    assert.equal(await popup.count(), 1, "hint remains hoverable");
    await popup.evaluate(element => { element.scrollTop = 100; });
    await page.waitForTimeout(50);
    assert.equal(await popup.count(), 1, "internal scrolling keeps the hint open");

    await page.locator("#edge").hover();
    await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent === "This hint stays inside the viewport");
    const edge = await popup.boundingBox();
    assert.ok(edge.x >= 8 && edge.y >= 8 && edge.x + edge.width <= 892 && edge.y + edge.height <= 642);
    assert.equal(await page.locator("[title]").count(), 0);
    console.log(`${theme}: keyboard, Escape, clipping, disabled hover, hoverable long content, viewport edges and glass colors passed`);
  }
  await page.setViewportSize({ width: 320, height: 240 });
  await page.locator("#edge").hover();
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent === "This hint stays inside the viewport");
  const compact = await popup.boundingBox();
  assert.ok(compact.x >= 8 && compact.y >= 8 && compact.x + compact.width <= 312 && compact.y + compact.height <= 232);
  console.log("Compact viewport: hint stays within 320x240");
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
