const { isDeepStrictEqual } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const entry = 'https://mini-app.invalid/index.html';
const preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false, webSecurity: true, webviewTag: false, plugins: false, disableDialogs: true,
  navigateOnDragDrop: false, safeDialogs: true, allowRunningInsecureContent: false, enableBlinkFeatures: 'WebMCPTesting' };

// Runs solely in the sandboxed package. The MCP client may supply data and a
// declared tool name; the JavaScript sent by the desktop is fixed.
async function guestTools(request) {
  const api = document.modelContext ?? navigator.modelContext;
  if (!api?.getTools || !api.executeTool) throw Error('WebMCP is unavailable in this runtime.');
  const registered = await api.getTools();
  if (!request) {
    if (registered.length > 64) throw Error('Too many registered tools.');
    const tools = registered.map(({ name, description, inputSchema }) => ({ name, description,
      inputSchema: typeof inputSchema === 'string' ? JSON.parse(inputSchema) : inputSchema }));
    if (JSON.stringify(tools).length > 60000 || tools.some(tool => JSON.stringify(tool).length > 5500)) throw Error('Tool descriptions exceed the package limit.');
    return tools;
  }
  const found = registered.filter(tool => tool.name === request.name);
  if (found.length !== 1) throw Error('The registered tool changed.');
  const output = await api.executeTool(found[0], request.stringInput ? request.input : JSON.parse(request.input));
  if (typeof output !== 'string' || output.length > 7500) throw Error('Invalid or oversized WebMCP result. Check app state before retrying.');
  return output;
}

function bounded(operation, ms) {
  let timeout;
  return Promise.race([operation, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(Error('Mini app timed out. Check its state before retrying.')), ms);
  })]).finally(() => clearTimeout(timeout));
}
function evaluate(guest, request) {
  return guest.executeJavaScript('(' + guestTools.toString() + ')(' + JSON.stringify(request) + ')');
}
async function discover(guest, declared, alive) {
  const end = Date.now() + 5000;
  while (alive() && Date.now() < end) {
    if (!guest.isLoadingMainFrame() && guest.getURL() === entry) {
      const tools = await bounded(evaluate(guest, null), 5000);
      if (tools.length >= declared.length) {
        if (!isDeepStrictEqual(tools.map(t => t.name).sort(), [...declared].sort())
          || tools.some(t => typeof t.description !== 'string' || !t.description.trim() || t.inputSchema?.type !== 'object')) break;
        return tools;
      }
    }
    await delay(60);
  }
  throw Error('The app must register every declared WebMCP tool with a description and object input schema at startup.');
}
async function invokeTool(guest, name, input) {
  const output = await bounded(evaluate(guest, { name, input: JSON.stringify(input),
    stringInput: Number(process.versions.chrome.split('.')[0]) < 155 }), 30000);
  try { return JSON.parse(output); } catch { return output; }
}
module.exports = { entry, preferences, bounded, discover, invokeTool };
