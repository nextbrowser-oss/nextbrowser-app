import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// Mount the real ChatView and shared UI with a disposable store. All external traffic is blocked.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChatView} from '/src/components/ChatView.tsx';
import {TooltipProvider} from '/src/shared/ui/index.ts';
import {useStore} from '/src/store.ts';
import '/src/styles.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme')||'light';
window.sent=[];
window.nextbrowser={invoke:async(command)=>command==='select_chat_files'?[{name:'brief.md',path:'/fixture/brief.md',size:42}]:command==='multilogin_status'?{connected:false,valid:false}:undefined,on:()=>()=>{},filePathForFile:file=>'/fixture/'+file.name};
const messages=Array.from({length:32},(_,i)=>({id:'message-'+i,role:i%2?'assistant':'user',text:i%2?'The shared palette keeps the interface consistent in both themes. Scroll this conversation to see the messages pass behind the floating glass composer.\\n\\nThe input stays available while you read earlier messages.':'Review the next part of the interface and keep the dialog easy to read.',status:'done',createdAt:Date.now()-60000*(32-i)}));
useStore.setState({agentId:'codex',terminalChat:false,checking:false,authed:true,showOnboarding:false,
 conversations:[{id:'fixture-chat',agent:'codex',workspaceId:'fixture',title:'Project 1',messages,createdAt:Date.now(),updatedAt:Date.now()}],
 workspaces:[{id:'fixture',name:'UI review',profileNames:[],profileToolsets:{},createdAt:Date.now(),updatedAt:Date.now()}],activeWorkspaceId:'fixture',
 activeConversation:()=>useStore.getState().conversations[0],agentReady:()=>true,agentVersion:()=>'1.0.0',agentLoggedIn:()=>true,agentError:()=>undefined,
 enqueue:(...args)=>window.sent.push(args),selectedProfile:undefined,defaultSession:undefined,customScripts:[],appliedScripts:[]});
window.fixtureStore=useStore;
createRoot(document.getElementById('root')).render(React.createElement(TooltipProvider,null,React.createElement(ChatView)));
`;
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", chromium.executablePath()].find(path => path && existsSync(path));
if (!executablePath) throw new Error("Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an installed Chromium browser.");
const output = resolve("e2e-out/chat-composer");
await mkdir(output, { recursive: true });
const server = await createServer({ cacheDir: resolve(output, "vite-cache"), configFile: false, define: { __APP_VERSION__: JSON.stringify("composer-fixture") }, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "chat-composer-fixture",
  resolveId: id => id === "virtual:chat-composer-fixture" ? "\0chat-composer-fixture" : undefined,
  load: id => id === "\0chat-composer-fixture" ? fixture : undefined,
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/composer-fixture")) return next();
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>Isolated ChatView fixture</title><style>#root{display:flex;height:100dvh}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__chat-composer-fixture"></script></body></html>');
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: "reduce" });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /ResizeObserver/.test(message.text())) errors.push(message.text()); });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/composer-fixture`;
  const textarea = page.locator(".composer textarea");
  const send = page.getByRole("button", { name: "Send message to the selected agent" });
  const latest = page.locator(".messages .msg-assistant-wrap").last();
  const jump = page.getByRole("button", { name: "Scroll to latest message", exact: true });
  const composer = page.locator(".composer");
  const scrollToEnd = async () => {
    await page.locator(".messages").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => { const scroll = document.querySelector('.messages'); return scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<2; });
  };
  const lastIsVisible = async () => {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.messages .msg-assistant-wrap');
      return rows[rows.length - 1].getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top;
    });
    assert.ok((await latest.boundingBox()).y + (await latest.boundingBox()).height <= (await composer.boundingBox()).y, "last message clears the floating input");
  };
  for (const theme of ["light", "dark"]) {
    await page.goto(`${url}?theme=${theme}`);
    await textarea.waitFor().catch(async error => { console.error(errors); console.error((await page.locator("body").innerText()).slice(-3000)); throw error; });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.getByRole('group', { name: 'Project chat mode' }).count(), 0);
    assert.equal(await page.getByText(/Separate chat context/).count(), 0);
    const projectTitle = page.locator('.chat-project-title');
    assert.ok(await projectTitle.evaluate(node => Number(getComputedStyle(node).fontWeight)) >= 700);
    assert.equal(await page.locator('.chat-header').evaluate(node => getComputedStyle(node).position), 'absolute');
    const floatingHeader = await page.locator('.chat-header').boundingBox();
    const historyBounds = await page.locator('.messages').boundingBox();
    assert.ok(floatingHeader.y >= historyBounds.y && floatingHeader.y + floatingHeader.height > historyBounds.y, 'project title floats above the same scroll area');
    await scrollToEnd();
    await lastIsVisible();
    assert.equal(await jump.count(), 0, "no jump action while already at the bottom");
    await page.locator(".messages").evaluate(element => { element.scrollTop -= 200; });
    await jump.waitFor();
    const jumpBox = await jump.boundingBox();
    const composerBox = await composer.boundingBox();
    assert.ok(Math.abs(jumpBox.x + jumpBox.width / 2 - composerBox.x - composerBox.width / 2) <= 1, "jump action is centered over the composer");
    assert.ok(jumpBox.y + jumpBox.height < composerBox.y, "jump action clears the input");
    const readingPosition = await page.locator(".messages").evaluate(element => element.scrollTop);
    await page.evaluate(() => {
      const state = window.fixtureStore.getState();
      state.conversations[0].messages[state.conversations[0].messages.length - 1].text += '\n\nIncoming text while reading history. '.repeat(15);
      window.fixtureStore.setState({ conversations: [...state.conversations] });
    });
    await page.waitForTimeout(100);
    assert.ok(Math.abs(await page.locator(".messages").evaluate(element => element.scrollTop) - readingPosition) < 2, "incoming content does not pull the reader down");
    await page.screenshot({ path: resolve(output, `${theme}-scroll-to-latest.png`) });
    await jump.click();
    await jump.waitFor({ state: "detached" });
    await lastIsVisible();
    const colors = await composer.evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color, border: getComputedStyle(element).borderWidth, blur: getComputedStyle(element).backdropFilter }));
    assert.equal(colors.border, "0px");
    assert.equal(colors.text, theme === "light" ? "rgb(255, 255, 255)" : "rgb(244, 246, 251)");
    assert.ok(colors.bg.includes(theme === "light" ? "25, 28, 35" : "29, 32, 40"));
    assert.ok(colors.blur.includes("blur(18px)"));
    assert.ok(Number(colors.bg.match(/,\s*([\d.]+)\)$/)?.[1]) < 0.9, "glass tint stays translucent");
    assert.equal(await textarea.evaluate(element => getComputedStyle(element).borderWidth), "0px");
    assert.equal(await send.isDisabled(), true);
    const button = await send.boundingBox();
    assert.equal(button.width, button.height);
    assert.equal(await send.evaluate(element => getComputedStyle(element).borderRadius), "50%");
    for (const label of ["Attach local files to the next message", "Open scripts menu"]) {
      const action = page.getByRole("button", { name: label });
      const bounds = await action.boundingBox();
      assert.equal(bounds.height, 28);
      assert.ok(bounds.width > bounds.height);
      assert.ok((await action.textContent()).trim().length > 0);
    }
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(["Drop feedback test"], "drop-note.txt", { type: "text/plain" }));
      return data;
    });
    await page.locator(".messages").dispatchEvent("dragenter", { dataTransfer: transfer });
    await page.getByRole("status").filter({ hasText: "Drop files to attach" }).waitFor();
    await textarea.dispatchEvent("dragenter", { dataTransfer: transfer });
    await page.locator(".messages").dispatchEvent("dragleave", { dataTransfer: transfer });
    await page.screenshot({ path: resolve(output, `${theme}-file-drag.png`) });
    await textarea.dispatchEvent("drop", { dataTransfer: transfer });
    await page.getByRole("button", { name: "Remove drop-note.txt" }).waitFor();
    assert.equal(await page.locator(".file-drop-area__indicator").count(), 0);
    await page.getByRole("button", { name: "Remove drop-note.txt" }).click();
    await textarea.fill("A multiline draft\n".repeat(12));
    await page.waitForFunction(() => document.querySelector('.composer').getBoundingClientRect().height>180);
    await lastIsVisible();
    await page.getByRole("button", { name: "Attach local files to the next message" }).click();
    await page.getByText("brief.md", { exact: true }).waitFor();
    await scrollToEnd();
    await lastIsVisible();
    await page.getByRole("button", { name: "Open scripts menu" }).click();
    await page.locator(".script-menu").waitFor();
    const menu = await page.locator(".script-menu").boundingBox();
    const trigger = await page.getByRole("button", { name: "Open scripts menu" }).boundingBox();
    const area = await page.locator(".overlay-scroll-area").boundingBox();
    assert.ok(menu.height > 0 && menu.height <= 240 && menu.width <= 248);
    assert.ok(Math.abs(menu.x - trigger.x) <= 1, "menu starts at its trigger when there is room");
    assert.ok(menu.x >= area.x && menu.x + menu.width <= area.x + area.width);
    await page.screenshot({ path: resolve(output, `${theme}-scripts.png`) });
    await page.keyboard.press("Escape");
    await page.locator(".script-menu").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Remove brief.md" }).click();
    await textarea.fill("Hello");
    await textarea.press("Shift+Enter");
    assert.ok((await textarea.inputValue()).includes("\n"));
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    await textarea.press("Enter");
    assert.equal(await page.evaluate(() => window.sent[0][0]), "Hello");
    assert.equal(await textarea.inputValue(), "");
    await textarea.fill("Preview the lighter interface");
    await page.getByRole("button", { name: "Send message to the selected agent" }).click();
    assert.equal(await page.evaluate(() => window.sent.length), 2);

    // Put an earlier message under the glass, rather than only taking an empty-background screenshot.
    await page.locator(".messages").evaluate(element => {
      const earlier = element.querySelectorAll('.msg-assistant-wrap')[12];
      const panel = document.querySelector('.composer').getBoundingClientRect();
      element.scrollTop += earlier.getBoundingClientRect().top - panel.top - 12;
    });
    await page.screenshot({ path: resolve(output, `${theme}-chat.png`) });
    await page.setViewportSize({ width: 420, height: 620 });
    await textarea.fill("Long draft on a narrow window\n".repeat(8));
    await scrollToEnd();
    await lastIsVisible();
    await page.locator(".messages").evaluate(element => { element.scrollTop -= 100; });
    await jump.waitFor();
    const compactJump = await jump.boundingBox();
    const compactComposer = await composer.boundingBox();
    assert.ok(Math.abs(compactJump.x + compactJump.width / 2 - compactComposer.x - compactComposer.width / 2) <= 1);
    assert.ok(compactJump.y + compactJump.height < compactComposer.y);
    await jump.click();
    await jump.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: resolve(output, `${theme}-compact.png`) });
    await page.evaluate(() => window.fixtureStore.setState({ customScripts: Array.from({ length: 18 }, (_, index) => ({ id: 'script-'+index, title: 'Reusable script with a longer name '+index, domain: 'example.com', js: '' })) }));
    await page.getByRole("button", { name: "Open scripts menu" }).click();
    await page.locator(".script-menu").waitFor();
    const narrowMenu = await page.locator(".script-menu").boundingBox();
    const narrowArea = await page.locator(".overlay-scroll-area").boundingBox();
    assert.ok(narrowMenu.height <= 240 && narrowMenu.width <= 248);
    assert.ok(narrowMenu.x >= narrowArea.x && narrowMenu.x + narrowMenu.width <= narrowArea.x + narrowArea.width);
    assert.ok(narrowMenu.y >= narrowArea.y, "menu remains inside the chat viewport");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate(() => {
      window.fixtureStore.setState(state => ({
        runtime: { ...state.runtime, codex: { ...state.runtime.codex, runningReplyId: 'message-31' } },
        stopRunning: () => { window.stopped = true; },
      }));
    });
    await page.getByRole("button", { name: "Stop the running agent response" }).click();
    assert.equal(await page.evaluate(() => window.stopped), true);
    await page.evaluate(() => window.fixtureStore.setState({ agentReady: () => false }));
    await page.getByRole("button", { name: "Attach local files to the next message" }).waitFor();
    assert.equal(await textarea.isDisabled(), true);
    await page.locator(".messages").dispatchEvent("dragenter", { dataTransfer: transfer });
    await page.getByRole("status").filter({ hasText: "Connect an agent to attach files" }).waitFor();
    await page.locator(".messages").dispatchEvent("drop", { dataTransfer: transfer });
    assert.equal(await page.locator(".file-drop-area__indicator").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Remove drop-note.txt" }).count(), 0);
    await transfer.dispose();
    await scrollToEnd();
    await lastIsVisible();
    await page.evaluate(() => window.fixtureStore.setState({ agentReady: () => true, workingDir: '/fixture/project', runtime: {} }));
    assert.equal(await page.getByRole('button', { name: 'Open commands' }).count(), 0);
    const sentBeforeCommands = await page.evaluate(() => window.sent.length);
    await textarea.fill('/');
    const commands = page.getByRole('listbox', { name: 'Agent commands' });
    await commands.waitFor();
    assert.equal(await commands.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none');
    assert.ok(await commands.evaluate(node => getComputedStyle(node).backdropFilter.includes('blur(18px)')));
    assert.equal(await commands.evaluate(node => node.parentElement === document.body), true);
    await commands.hover();
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => document.querySelector('.shared-command-list').scrollTop > 0);
    await textarea.press('ArrowDown');
    assert.equal(await commands.getByRole('option', { selected: true }).getAttribute('id'), (await textarea.getAttribute('aria-activedescendant')));
    await page.screenshot({ path: resolve(output, `${theme}-slash-commands.png`) });
    await textarea.fill('/tit');
    await textarea.press('Tab');
    assert.equal(await textarea.inputValue(), '/title ');
    await textarea.fill('/title Renamed project');
    await send.click();
    await page.locator('.chat-project-title').filter({ hasText: 'Renamed project' }).waitFor();
    await textarea.fill('/title Project 1');
    await send.click();
    await projectTitle.waitFor();
    await textarea.fill('/version ');
    await textarea.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Codex: 1.0.0' }).waitFor();
    assert.equal(await page.evaluate(() => window.sent.length), sentBeforeCommands, 'client commands never go to the model');
    await textarea.fill('/compress ');
    await send.click();
    await page.getByRole('alert').filter({ hasText: 'not supported by this chat adapter' }).waitFor();
    assert.equal(await page.evaluate(() => window.sent.length), sentBeforeCommands);
    await textarea.fill('');
    // The project popover lives in the permanent rail, outside this ChatView fixture.
    await page.evaluate(() => window.addEventListener('nextbrowser:open-projects', () => { window.projectMenuRequested = true; }));
    await textarea.fill('/sessions ');
    await send.click();
    assert.equal(await page.evaluate(() => window.projectMenuRequested), true);
    // A persisted terminal project still opens the regular chat and retains its summary.
    await page.evaluate(() => window.fixtureStore.setState(state => ({
      terminalChat: true,
      conversations: state.conversations.map((c, i) => i ? c : { ...c, chatMode: 'terminal', terminalPreview: 'Saved terminal activity for this project.', executionTarget: 'vps' }),
    })));
    assert.equal(await textarea.isVisible(), true);
    await page.getByText('Previous terminal activity', { exact: true }).click();
    await page.getByText('Saved terminal activity for this project.', { exact: true }).waitFor();
    await textarea.fill('Continue from the previous activity');
    await send.click();
    const continuedRequest = await page.evaluate(() => window.sent.at(-1));
    assert.equal(continuedRequest[0], 'Continue from the previous activity');
    assert.ok(continuedRequest[4].includes('Saved terminal activity for this project.'));
    await page.evaluate(() => window.fixtureStore.setState({
      runScript: (script, host) => { window.scriptRun = { title: script.title, host }; },
      runCustomScript: script => { window.scriptRun = { title: script.title, host: script.domain }; },
    }));
    await page.getByRole('button', { name: 'Open scripts menu' }).click();
    await page.locator('.script-menu button').first().click();
    assert.ok((await page.evaluate(() => window.scriptRun)).title);
    assert.equal(await textarea.isVisible(), true);
    for (const width of [420, 320]) {
      await page.setViewportSize({ width, height: 620 });
      await textarea.fill('');
      await textarea.fill('/');
      await commands.waitFor();
      const bounds = await commands.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 620);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.evaluate(() => {
      window.fixtureStore.setState({ createProject: (...args) => { window.createdProject = args; return 'created'; } });
      window.dispatchEvent(new Event('nextbrowser:create-project'));
    });
    const createProject = page.getByRole('dialog', { name: 'New project', exact: true });
    await createProject.waitFor();
    assert.equal(await createProject.getByRole('radio').count(), 0);
    await createProject.getByPlaceholder('Product research').fill('New chat project');
    await page.evaluate(() => window.fixtureStore.setState({ createProject: () => '' }));
    await createProject.getByRole('button', { name: 'Create project', exact: true }).click();
    await createProject.getByRole('alert').filter({ hasText: "couldn't create the project" }).waitFor();
    assert.equal(await createProject.getByPlaceholder('Product research').inputValue(), 'New chat project');
    await page.evaluate(() => window.fixtureStore.setState({ createProject: () => { throw new Error('This workspace is being deleted.'); } }));
    await createProject.getByRole('button', { name: 'Create project', exact: true }).click();
    await createProject.getByRole('alert').filter({ hasText: 'This workspace is being deleted.' }).waitFor();
    await page.evaluate(() => window.fixtureStore.setState({ createProject: (...args) => { window.createdProject = args; return 'created'; } }));
    await createProject.getByRole('button', { name: 'Create project', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.createdProject), ['New chat project', 'chat', 'codex']);
    await createProject.waitFor({ state: 'detached' });
    console.log(`${theme}: glass inversion, round actions, text entry, send, attachments, menu, growing overlay and compact scrolling passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
