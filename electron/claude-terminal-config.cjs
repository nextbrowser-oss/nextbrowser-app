const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Before its prompt, Claude Code asks a new user to pick a color theme, to
// trust the folder it runs in, and to try its fullscreen renderer. The trust
// question defaults to "No, exit", so pressing Enter closed the app's
// terminal. That terminal always runs Claude Code in the app's own workspace
// folder, so before starting it the app records these answers in Claude
// Code's global config (~/.claude.json) the way Claude Code records them
// itself (checked against Claude Code 2.1.309 and 2.1.310):
// - hasCompletedOnboarding: true skips the first-run screens, the theme picker
//   among them; the theme stays Claude Code's default. Added only when
//   missing: Claude Code sets it to false itself to show them again after an
//   account switch.
// - fullscreenUpsellSeenCount: 3 is how many times Claude Code offers the
//   fullscreen renderer before it stops asking. Added only when missing.
// - projects[<folder>].hasTrustDialogAccepted: true trusts the folder. Claude
//   Code writes false into every folder entry it saves (a chat run in the
//   same folder does), and "No, exit" saves no answer, so false there means
//   "not asked yet" and becomes true as well.
// Nothing else in the file changes, and the file is replaced in one rename.

const FULLSCREEN_UPSELL_LIMIT = 3;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The global config file Claude Code reads, or null when the app cannot be
 * sure which one: a custom sign-in endpoint uses a file of its own, and an
 * old `.config.json` takes precedence when it exists.
 */
async function claudeGlobalConfigFile({ env = process.env, homeDir }) {
  if (env.CLAUDE_CODE_CUSTOM_OAUTH_URL) return null;
  const root = env.CLAUDE_CONFIG_DIR || homeDir;
  if (!root) return null;
  const legacy = path.join(env.CLAUDE_CONFIG_DIR || path.join(homeDir, ".claude"), ".config.json");
  const legacyExists = await fs.stat(legacy).then(() => true, (error) => error.code !== "ENOENT");
  return legacyExists ? null : path.join(root, ".claude.json");
}

/** Claude Code's key for a folder: on Windows with forward slashes. */
function claudeProjectKey(dir, platform = process.platform) {
  return platform === "win32" ? dir.replaceAll("\\", "/") : dir;
}

/** The config with the answers added, or null when it already has them. */
function seededClaudeConfig(config, projectKey) {
  const next = { ...config };
  let changed = false;
  if (!Object.hasOwn(config, "hasCompletedOnboarding")) {
    next.hasCompletedOnboarding = true;
    changed = true;
  }
  if (!Object.hasOwn(config, "fullscreenUpsellSeenCount")) {
    next.fullscreenUpsellSeenCount = FULLSCREEN_UPSELL_LIMIT;
    changed = true;
  }
  const projects = config.projects === undefined ? {} : config.projects;
  const project = isPlainObject(projects) ? projects[projectKey] : undefined;
  if (isPlainObject(projects) && (project === undefined || (isPlainObject(project) && project.hasTrustDialogAccepted !== true))) {
    next.projects = { ...projects, [projectKey]: { ...project, hasTrustDialogAccepted: true } };
    changed = true;
  }
  return changed ? next : null;
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Records the first-run answers for Claude Code started in `workspaceDir`.
 * Returns whether the config changed. Leaves the file alone when it cannot be
 * read as a JSON object or changes while the update is prepared.
 */
async function prepareClaudeTerminalConfig({ workspaceDir, env = process.env, homeDir, platform = process.platform }) {
  const configFile = await claudeGlobalConfigFile({ env, homeDir });
  if (!configFile || !workspaceDir) return false;
  // A symlinked config (dotfiles) is updated where it points.
  const file = await fs.realpath(configFile).catch(() => configFile);
  const text = await readIfExists(file);
  let config = {};
  if (text !== undefined) {
    try {
      config = JSON.parse(text);
    } catch {
      return false;
    }
  }
  if (!isPlainObject(config)) return false;
  const next = seededClaudeConfig(config, claudeProjectKey(workspaceDir, platform));
  if (!next) return false;
  const mode = text === undefined ? 0o600 : (await fs.stat(file)).mode & 0o777;
  // A config the user made read-only stays as it is.
  if (!(mode & 0o200)) return false;
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.nextbrowser-${randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode, flag: "wx" });
  try {
    if (await readIfExists(file) !== text) return false;
    await fs.rename(temp, file);
    return true;
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

module.exports = {
  claudeGlobalConfigFile,
  claudeProjectKey,
  prepareClaudeTerminalConfig,
  seededClaudeConfig,
};
