#!/usr/bin/env node
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { executeAutomationRecipe } = require("../electron/automation-runner.cjs");
const { saveAutomationArtifact } = require("../electron/automation-artifact.cjs");
const { createLocalArtifactStore } = require("../electron/local-artifacts.cjs");

const profile = process.env.NEXTBROWSER_QA_PROFILE || "CMC QA Direct";

async function resolveNextctlBinary() {
  const candidates = [
    process.env.NEXTCTL_BIN,
    path.join(os.homedir(), ".nextbrowser", "managed-nextctl", process.platform === "win32" ? "nextctl.exe" : "nextctl"),
    "nextctl",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* Try the next installed location. */ }
  }
  throw new Error("nextctl is not installed. Start NextBrowser once so it can install the managed runtime.");
}

function rowsContract(fields, minRows = 1) {
  return { kind: "rows", min_rows: minRows, fields: Object.fromEntries(fields.map((field) => [field, field === "url" ? "url" : "non_empty"])) };
}

const scenarios = [
  {
    id: "cmc-market-leaders",
    url: "https://coinmarketcap.com/",
    ready: "a[href*='/currencies/']",
    minRows: 5,
    fields: ["rank", "name", "symbol", "price", "url"],
    expression: `(() => { const rows=[]; for (const link of document.querySelectorAll("a[href*='/currencies/']")) { const tr=link.closest('tr'); if(!tr)continue; const cells=[...tr.querySelectorAll('td')].map(td=>td.innerText.replace(/\\s+/g,' ').trim()); const text=link.innerText.replace(/\\s+/g,' ').trim(); const parts=text.split(' ').filter(Boolean); const rank=cells[1]||cells[0]; const price=cells.find(value=>/^\\$[0-9]/.test(value)); const url=link.href; if(!rank||!text||!price||!/^https?:/.test(url))continue; rows.push({rank,name:parts.slice(0,-1).join(' ')||parts[0],symbol:parts.at(-1),price,url}); if(rows.length===5)break; } if(rows.length<5)throw new Error('Expected at least 5 populated market rows'); return rows; })()`,
  },
  {
    id: "hacker-news-newest",
    url: "https://news.ycombinator.com/newest",
    ready: "tr.athing",
    minRows: 5,
    fields: ["rank", "title", "url"],
    expression: `(() => [...document.querySelectorAll('tr.athing')].slice(0,5).map((row,index)=>{const link=row.querySelector('.titleline>a');return {rank:index+1,title:link?.textContent?.trim(),url:link?.href}}))()`,
  },
  {
    id: "wikipedia-web-browser",
    url: "https://en.wikipedia.org/wiki/Web_browser",
    ready: "#firstHeading",
    fields: ["title", "summary", "url"],
    expression: `(() => [{title:document.querySelector('#firstHeading')?.textContent?.trim(),summary:[...document.querySelectorAll('#mw-content-text p')].map(p=>p.textContent.replace(/\\s+/g,' ').trim()).find(text=>text.length>40),url:location.href}])()`,
  },
  {
    id: "github-trending",
    url: "https://github.com/trending?since=daily",
    ready: "article.Box-row",
    minRows: 5,
    fields: ["repository", "description", "url"],
    expression: `(() => [...document.querySelectorAll('article.Box-row')].slice(0,5).map(row=>{const link=row.querySelector('h2 a');return {repository:link?.textContent?.replace(/\\s+/g,' ').trim(),description:row.querySelector('p')?.textContent?.trim()||'No description',url:link?.href}}))()`,
  },
  {
    id: "arxiv-recent-ai",
    url: "https://arxiv.org/list/cs.AI/recent",
    ready: "dl#articles dt",
    minRows: 5,
    fields: ["title", "authors", "url"],
    expression: `(() => [...document.querySelectorAll('dl#articles dt')].slice(0,5).map(dt=>{const dd=dt.nextElementSibling;const link=dt.querySelector("a[title='Abstract']");return {title:dd?.querySelector('.list-title')?.textContent?.replace(/^Title:\\s*/,'').trim(),authors:dd?.querySelector('.list-authors')?.textContent?.replace(/^Authors:\\s*/,'').trim(),url:link?.href}}))()`,
  },
  {
    id: "mdn-http-status",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status",
    ready: "main h1",
    minRows: 5,
    fields: ["status", "label", "url"],
    expression: `(() => {const seen=new Set();return [...document.querySelectorAll("main a[href*='/Web/HTTP/Reference/Status/']")].map(a=>({status:(a.textContent.match(/\\b[1-5][0-9]{2}\\b/)||[])[0],label:a.textContent.replace(/\\s+/g,' ').trim(),url:a.href})).filter(row=>row.status&&row.label&&/^https?:/.test(row.url)&&!seen.has(row.url)&&seen.add(row.url)).slice(0,5)})()`,
  },
  {
    id: "pypi-requests",
    url: "https://pypi.org/project/requests/",
    ready: "h1.package-header__name",
    fields: ["package", "version", "summary", "url"],
    expression: `(() => {const heading=document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim()||'';const packageName=location.pathname.split('/').filter(Boolean).at(-1);const version=heading.replace(new RegExp('^'+packageName+'\\\\s*','i'),'').trim();return [{package:packageName,version:version||'Current release',summary:document.querySelector('.package-description__summary')?.textContent?.trim()||document.querySelector('meta[name=description]')?.content,url:location.href}]})()`,
  },
  {
    id: "rfc-http-semantics",
    url: "https://www.rfc-editor.org/rfc/rfc9110.html",
    ready: "h1",
    fields: ["title", "identifier", "url"],
    expression: `(() => [{title:document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim(),identifier:(document.body.innerText.match(/RFC\\s*9110/i)||[])[0],url:location.href}])()`,
  },
  {
    id: "w3c-news",
    url: "https://www.w3.org/news/",
    ready: "main",
    minRows: 3,
    fields: ["title", "url"],
    expression: `(() => {const seen=new Set();return [...document.querySelectorAll('main h2 a, main h3 a')].map(a=>({title:a.textContent.replace(/\\s+/g,' ').trim(),url:a.href})).filter(row=>row.title&&/^https?:/.test(row.url)&&!seen.has(row.url)&&seen.add(row.url)).slice(0,5)})()`,
  },
  {
    id: "python-download-release",
    url: "https://www.python.org/downloads/",
    ready: "main",
    fields: ["title", "release", "url"],
    expression: `(() => [{title:document.querySelector('main h1')?.textContent?.replace(/\\s+/g,' ').trim()||document.title,release:(document.body.innerText.match(/Python\\s+[0-9]+(?:\\.[0-9]+){1,2}/i)||[])[0],url:location.href}])()`,
  },
];

async function main() {
  const binary = await resolveNextctlBinary();
  const runtimeRoot = path.join(os.homedir(), ".nextbrowser", "runtime");
  const qaEnv = {
    ...process.env,
    NEXTBROWSER_CONFIG_DIR: process.env.NEXTBROWSER_CONFIG_DIR || path.join(runtimeRoot, "config"),
    CLAWBROWSER_CACHE_DIR: process.env.CLAWBROWSER_CACHE_DIR || path.join(runtimeRoot, "cache"),
    CLAWBROWSER_DATA_DIR: process.env.CLAWBROWSER_DATA_DIR || path.join(runtimeRoot, "data"),
    CLAWBROWSER_STATE_ROOT: process.env.CLAWBROWSER_STATE_ROOT || path.join(runtimeRoot, "state"),
    CLAWBROWSER_SESSION_ROOT: process.env.CLAWBROWSER_SESSION_ROOT || path.join(runtimeRoot, "sessions"),
    NBC_PROFILE_ROOT: process.env.NBC_PROFILE_ROOT || path.join(runtimeRoot, "profiles"),
  };
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-automation-live-qa-"));
  const store = createLocalArtifactStore({ rootDir });
  const results = [];
  for (const scenario of scenarios) {
    const contract = rowsContract(scenario.fields, scenario.minRows || 1);
    const recipe = { version: 1, actions: [
      { tool: "open", arguments: { url: scenario.url } },
      { tool: "wait", arguments: { selector: scenario.ready, timeout: 20 } },
      { tool: "evaluate", arguments: { expression: scenario.expression } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: `${scenario.id}.json`, contract } },
    ] };
    const result = await executeAutomationRecipe({
      executionId: `live-${scenario.id}`,
      profile,
      recipe,
    }, {
      binary,
      env: qaEnv,
      onLocalAction: (action, context) => saveAutomationArtifact({ action, ...context, workspaceId: "live-qa", store }),
    });
    results.push({ id: scenario.id, status: result.status, error: result.error, failedStep: result.failedStep, artifact: result.results?.at(-1)?.output?.artifact?.name });
  }
  const failed = results.filter((result) => result.status !== "completed");
  process.stdout.write(`${JSON.stringify({ profile, binary, rootDir, passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
