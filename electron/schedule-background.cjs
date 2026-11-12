const fs = require("node:fs/promises");
const path = require("node:path");

const SCHEDULE_WORKER_ARG = "--nextbrowser-schedule-worker";

async function hasEnabledSchedules(dataDirectory) {
  try {
    const runs = JSON.parse(await fs.readFile(path.join(dataDirectory, "scheduled-runs.json"), "utf8"));
    return Array.isArray(runs) && runs.some(run => run?.enabled === true);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Let the renderer drain its queued writes before the next process opens this
// profile. The timeout keeps a crashed or stuck renderer from blocking Quit.
function flushScheduleWindow(ipcMain, window, timeoutMs = 2000) {
  if (!window || window.isDestroyed()) return Promise.resolve();
  const contents = window.webContents;
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timeout);
      ipcMain.removeListener("nextbrowser:schedule-flushed", acknowledge);
      contents.removeListener("destroyed", finish);
      resolve();
    };
    const acknowledge = event => {
      if (event.sender === contents && event.senderFrame === contents.mainFrame) finish();
    };
    const timeout = setTimeout(finish, timeoutMs);
    ipcMain.on("nextbrowser:schedule-flushed", acknowledge);
    contents.once("destroyed", finish);
    try { contents.send("schedule:flush"); } catch { finish(); }
  });
}

module.exports = { SCHEDULE_WORKER_ARG, hasEnabledSchedules, flushScheduleWindow };
