const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_PORT = 22;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_TOTAL_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_FILES = 128;
const MAX_INCLUDE_DEPTH = 8;
const MAX_DIRECTIVES = 5_000;
const MAX_HOSTS = 128;
const MAX_GLOB_PATTERN_LENGTH = 256;
const MAX_DIRECTORY_ENTRIES = 4_096;
const MAX_MATCH_WORK = 5_000_000;
const MAX_PATH_LENGTH = 4_096;
const RESOLVED_KEYS = new Set(["hostname", "user", "port", "identityfile"]);

function defaultSSHConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".ssh", "config");
}

function stripComment(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function splitArguments(value) {
  const values = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        quote = "";
        continue;
      }
      if (char === "\\" && index + 1 < value.length) {
        const next = value[index + 1];
        if (next === quote || next === "\\") {
          current += next;
          index += 1;
          continue;
        }
      }
      current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        values.push(current);
        current = "";
      }
      continue;
    }
    if (char === "\\" && index + 1 < value.length) {
      const next = value[index + 1];
      if (/\s/.test(next) || ["#", "\"", "'", "\\"].includes(next)) {
        current += next;
        index += 1;
        continue;
      }
    }
    current += char;
  }
  if (current) values.push(current);
  return values;
}

function parseDirective(rawLine) {
  const line = stripComment(rawLine).trim();
  if (!line) return null;
  const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*)$/);
  if (!match) return null;
  const args = splitArguments(match[2]);
  if (!args.length) return null;
  return { keyword: match[1].toLowerCase(), args };
}

function isConcreteAlias(alias) {
  return /^[A-Za-z0-9][A-Za-z0-9._:@%+=,-]{0,254}$/.test(alias);
}

function globTokens(pattern, context) {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) return null;
  const cached = context.cache.get(pattern);
  if (cached) return cached;
  const tokens = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (tokens[tokens.length - 1]?.kind !== "star") tokens.push({ kind: "star" });
      continue;
    }
    if (char === "?") {
      tokens.push({ kind: "any" });
      continue;
    }
    if (char === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end >= 0) {
        let value = pattern.slice(index + 1, end);
        const negated = value.startsWith("!") || value.startsWith("^");
        if (negated) value = value.slice(1);
        if (value) {
          tokens.push({ kind: "class", value, negated });
          index = end;
          continue;
        }
      }
    }
    tokens.push({ kind: "literal", value: char });
  }
  context.cache.set(pattern, tokens);
  return tokens;
}

function classMatches(char, token, caseInsensitive) {
  const value = caseInsensitive ? token.value.toLowerCase() : token.value;
  const candidate = caseInsensitive ? char.toLowerCase() : char;
  let matched = false;
  for (let index = 0; index < value.length; index += 1) {
    const start = value[index];
    if (index + 2 < value.length && value[index + 1] === "-") {
      const end = value[index + 2];
      if (start <= end && candidate >= start && candidate <= end) matched = true;
      index += 2;
    } else if (candidate === start) {
      matched = true;
    }
  }
  return token.negated ? !matched : matched;
}

function consumeMatchWork(context, amount) {
  context.remaining -= amount;
  if (context.remaining < 0) throw new Error("SSH config matching is too complex.");
}

function globMatches(value, pattern, caseInsensitive, context) {
  const tokens = globTokens(pattern, context);
  if (!tokens) return false;
  const candidate = caseInsensitive ? value.toLowerCase() : value;
  consumeMatchWork(context, (pattern.length + 1) * (candidate.length + 1));
  let current = new Uint8Array(candidate.length + 1);
  current[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(candidate.length + 1);
    if (token.kind === "star") {
      next[0] = current[0];
      for (let index = 1; index <= candidate.length; index += 1) {
        next[index] = current[index] || next[index - 1];
      }
    } else {
      const literal = token.kind === "literal" && caseInsensitive ? token.value.toLowerCase() : token.value;
      for (let index = 1; index <= candidate.length; index += 1) {
        const char = candidate[index - 1];
        const matches = token.kind === "any" ||
          (token.kind === "literal" && char === literal) ||
          (token.kind === "class" && classMatches(char, token, caseInsensitive));
        next[index] = current[index - 1] && matches ? 1 : 0;
      }
    }
    current = next;
  }
  return current[candidate.length] === 1;
}

function hostPatternsMatch(alias, patterns, context) {
  let positiveMatch = false;
  for (const token of patterns) {
    const negated = token.startsWith("!");
    const pattern = negated ? token.slice(1) : token;
    if (!pattern || !globMatches(alias, pattern, true, context)) continue;
    if (negated) return false;
    positiveMatch = true;
  }
  return positiveMatch;
}

function hasGlobMagic(value) {
  return /[*?[]/.test(value);
}

function isNetworkPath(value) {
  return value.startsWith("\\\\") || /^\/\/[^/]/.test(value);
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isAllowedIncludePath(candidate, sshRoot) {
  if (!isPathInside(candidate, sshRoot)) return false;
  const base = path.basename(candidate).toLowerCase();
  return base === "config" || base.endsWith(".conf") || base.endsWith(".config");
}

function isAllowedExplicitConfigPath(candidate) {
  const base = path.basename(path.resolve(candidate)).toLowerCase();
  return base === "config" || base.endsWith(".conf") || base.endsWith(".config");
}

function looksLikePrivateKey(text) {
  const header = text.slice(0, 2_048);
  return /-----BEGIN (?:OPENSSH |RSA |DSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(header) ||
    /^PuTTY-User-Key-File-/m.test(header);
}

async function hasSymlinkSegment(candidate, lexicalRoot, fsApi, cache) {
  if (!isPathInside(candidate, lexicalRoot)) return true;
  const parts = path.relative(lexicalRoot, candidate).split(path.sep).filter(Boolean);
  let current = lexicalRoot;
  for (const part of parts) {
    current = path.join(current, part);
    if (cache.has(current)) {
      if (cache.get(current)) return true;
      continue;
    }
    try {
      const stat = await fsApi.lstat(current);
      const symlink = stat.isSymbolicLink();
      cache.set(current, symlink);
      if (symlink) return true;
    } catch {
      cache.set(current, true);
      return true;
    }
  }
  return false;
}

async function expandGlob(pattern, options) {
  const { fsApi, matchContext, lexicalSSHRoot, sshRoot, symlinkCache, warnings } = options;
  if (!hasGlobMagic(pattern)) return [pattern];
  const parsed = path.parse(pattern);
  const segments = pattern.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let candidates = [parsed.root || path.sep];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const finalSegment = index === segments.length - 1;
    if (!hasGlobMagic(segment)) {
      candidates = candidates.map((candidate) => path.join(candidate, segment));
      continue;
    }
    const next = [];
    for (const candidate of candidates) {
      if (!isPathInside(candidate, lexicalSSHRoot) ||
          await hasSymlinkSegment(candidate, lexicalSSHRoot, fsApi, symlinkCache)) {
        warnings.add("Some SSH Include paths were skipped because they leave the local .ssh directory or traverse a link.");
        continue;
      }
      let canonicalCandidate;
      try {
        canonicalCandidate = await fsApi.realpath(candidate);
      } catch {
        continue;
      }
      if (isNetworkPath(canonicalCandidate) || !isPathInside(canonicalCandidate, sshRoot)) {
        warnings.add("Some SSH Include paths were skipped because they leave the local .ssh directory or traverse a link.");
        continue;
      }
      let entries;
      try {
        entries = await fsApi.readdir(canonicalCandidate, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries.slice(0, MAX_DIRECTORY_ENTRIES)) {
        if (entry.name.startsWith(".") && !segment.startsWith(".")) continue;
        if (!globMatches(entry.name, segment, process.platform === "win32", matchContext)) continue;
        if (!finalSegment && !entry.isDirectory()) continue;
        next.push(path.join(candidate, entry.name));
        if (next.length >= MAX_CONFIG_FILES) break;
      }
      if (next.length >= MAX_CONFIG_FILES) break;
    }
    candidates = next;
    if (!candidates.length) break;
  }
  return candidates.slice(0, MAX_CONFIG_FILES);
}

function expandConfigPath(value, homeDir, includeBaseDir, env) {
  let expanded = value.replaceAll("%d", homeDir).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => env[name] ?? match);
  if (expanded === "~") expanded = homeDir;
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) expanded = path.join(homeDir, expanded.slice(2));
  if (!path.isAbsolute(expanded)) expanded = path.join(includeBaseDir, expanded);
  return path.normalize(expanded);
}

async function readDirectives(rootConfigPath, options) {
  const fsApi = options.fsApi;
  const homeDir = options.homeDir;
  const includeBaseDir = path.join(homeDir, ".ssh");
  const lexicalSSHRoot = path.resolve(includeBaseDir);
  const activeFiles = new Set();
  const symlinkCache = new Map();
  const warnings = new Set();
  let filesRead = 0;
  let totalBytesRead = 0;
  let directivesRead = 0;
  let sshRoot = path.resolve(includeBaseDir);
  try {
    sshRoot = await fsApi.realpath(sshRoot);
  } catch {
    // The required root read below handles a missing SSH directory.
  }

  async function visit(file, depth, required, conditional = false) {
    const empty = () => ({ directives: [], conditional });
    if (depth > MAX_INCLUDE_DEPTH || filesRead >= MAX_CONFIG_FILES) return empty();
    if (isNetworkPath(file)) {
      if (required) throw new Error("Network SSH config paths are not supported.");
      warnings.add("Some SSH Include paths were skipped because network paths are not supported.");
      return empty();
    }
    const absolutePath = path.resolve(file);
    if (!required && await hasSymlinkSegment(absolutePath, lexicalSSHRoot, fsApi, symlinkCache)) {
      warnings.add("Some SSH Include paths were skipped because they leave the local .ssh directory or traverse a link.");
      return empty();
    }
    let canonicalPath = absolutePath;
    try {
      canonicalPath = await fsApi.realpath(absolutePath);
    } catch {
      if (!required) return empty();
    }
    if (!required && !isAllowedIncludePath(canonicalPath, sshRoot)) {
      warnings.add("Some SSH Include paths were skipped because they do not look like safe SSH config files.");
      return empty();
    }
    const cycleKey = process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath;
    if (activeFiles.has(cycleKey)) return empty();

    let stat;
    try {
      stat = await fsApi.stat(canonicalPath);
    } catch (error) {
      if (!required || error?.code === "ENOENT") return empty();
      throw error;
    }
    if (!stat.isFile()) {
      if (required) throw new Error(`SSH config is not a file: ${absolutePath}`);
      return empty();
    }
    if (stat.size > MAX_CONFIG_BYTES) {
      if (required) throw new Error(`SSH config is too large: ${absolutePath}`);
      return empty();
    }
    totalBytesRead += stat.size;
    if (totalBytesRead > MAX_TOTAL_CONFIG_BYTES) throw new Error("SSH config include set is too large.");

    activeFiles.add(cycleKey);
    filesRead += 1;
    try {
      const text = await fsApi.readFile(canonicalPath, "utf8");
      if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
        if (required) throw new Error(`SSH config is too large: ${absolutePath}`);
        return empty();
      }
      if (looksLikePrivateKey(text)) {
        if (required) throw new Error(`The selected file is a private key, not an SSH config: ${absolutePath}`);
        warnings.add("An SSH Include was skipped because it contains private-key data, not SSH configuration.");
        return empty();
      }
      const directives = [];
      let currentConditional = conditional;
      for (const line of text.split(/\r?\n/)) {
        const directive = parseDirective(line);
        if (!directive) continue;
        directivesRead += 1;
        if (directivesRead > MAX_DIRECTIVES) throw new Error("SSH config contains too many directives.");
        if (directive.keyword !== "include") {
          directives.push({ ...directive, sourcePath: absolutePath });
          if (directive.keyword === "host" || directive.keyword === "match") currentConditional = true;
          continue;
        }
        if (currentConditional) {
          warnings.add("Conditional SSH Include directives were skipped to avoid listing hosts from inactive blocks.");
          continue;
        }
        for (const rawPattern of directive.args) {
          if (rawPattern.length > MAX_PATH_LENGTH || isNetworkPath(rawPattern)) {
            warnings.add("Some SSH Include paths were skipped because network paths are not supported.");
            continue;
          }
          const includePattern = expandConfigPath(rawPattern, homeDir, includeBaseDir, options.env);
          if (includePattern.length > MAX_PATH_LENGTH || isNetworkPath(includePattern)) {
            warnings.add("Some SSH Include paths were skipped because network paths are not supported.");
            continue;
          }
          if (!isPathInside(includePattern, lexicalSSHRoot)) {
            warnings.add("Some SSH Include paths were skipped because they leave the local .ssh directory or traverse a link.");
            continue;
          }
          const matches = await expandGlob(includePattern, {
            fsApi,
            matchContext: options.matchContext,
            lexicalSSHRoot,
            sshRoot,
            symlinkCache,
            warnings,
          });
          for (const includedPath of matches) {
            const nested = await visit(includedPath, depth + 1, false, currentConditional);
            directives.push(...nested.directives);
            currentConditional = nested.conditional;
          }
        }
      }
      return { directives, conditional: currentConditional };
    } finally {
      activeFiles.delete(cycleKey);
    }
  }

  const result = await visit(rootConfigPath, 0, true);
  return { directives: result.directives, warnings: [...warnings] };
}

function configuredAliases(directives) {
  const hosts = new Map();
  for (const directive of directives) {
    if (directive.keyword !== "host") continue;
    for (const alias of directive.args) {
      if (!isConcreteAlias(alias)) continue;
      const key = alias.toLowerCase();
      if (!hosts.has(key)) hosts.set(key, { alias, sourcePath: directive.sourcePath });
      if (hosts.size >= MAX_HOSTS) break;
    }
    if (hosts.size >= MAX_HOSTS) break;
  }
  return [...hosts.values()].sort((left, right) => left.alias.localeCompare(right.alias));
}

function fallbackValues(directives, alias, matchContext) {
  consumeMatchWork(matchContext, directives.length);
  const values = {};
  let active = true;
  for (const directive of directives) {
    if (directive.keyword === "host") {
      active = hostPatternsMatch(alias, directive.args, matchContext);
      continue;
    }
    if (directive.keyword === "match") {
      active = false;
      continue;
    }
    if (!active || !RESOLVED_KEYS.has(directive.keyword) || values[directive.keyword] != null) continue;
    values[directive.keyword] = directive.args[0];
  }
  return values;
}

function validPort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function validHostname(value) {
  return typeof value === "string" && value.length <= 255 && /^[A-Za-z0-9._:%\[\]-]+$/.test(value)
    ? value
    : undefined;
}

function validUser(value) {
  return typeof value === "string" && /^[A-Za-z0-9._@-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function expandIdentityPath(value, homeDir) {
  if (!value || value.length > MAX_PATH_LENGTH || /[\0-\x1f\x7f]/.test(value) || value.toLowerCase() === "none") return undefined;
  let expanded = value.replaceAll("%d", homeDir);
  if (expanded === "~") expanded = homeDir;
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) expanded = path.join(homeDir, expanded.slice(2));
  return path.normalize(expanded);
}

async function discoverSSHHosts(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const requestedConfigPath = options.configPath || defaultSSHConfigPath(homeDir);
  if (isNetworkPath(requestedConfigPath)) throw new Error("Network SSH config paths are not supported.");
  const configPath = path.resolve(requestedConfigPath);
  const fsApi = options.fsApi || fs;
  if (options.explicitConfig === true && !isAllowedExplicitConfigPath(configPath)) {
    throw new Error("Choose an SSH config named config or using a .conf or .config extension.");
  }
  if (options.explicitConfig === true) {
    let canonicalPath = configPath;
    try {
      canonicalPath = await fsApi.realpath(configPath);
    } catch {
      // The required config read below returns the useful filesystem error.
    }
    if (!isAllowedExplicitConfigPath(canonicalPath)) {
      throw new Error("Choose an SSH config named config or using a .conf or .config extension.");
    }
  }
  const env = options.env || process.env;
  const matchContext = { remaining: MAX_MATCH_WORK, cache: new Map() };
  const parsed = await readDirectives(configPath, { fsApi, homeDir, env, matchContext });
  const hosts = configuredAliases(parsed.directives).map((configured) => {
    const fallback = fallbackValues(parsed.directives, configured.alias, matchContext);
    const identityFile = expandIdentityPath(fallback.identityfile, homeDir);
    const user = validUser(fallback.user);
    const host = {
      alias: configured.alias,
      hostname: validHostname(fallback.hostname) || configured.alias,
      port: validPort(fallback.port) || DEFAULT_PORT,
      configPath,
      sourcePath: configured.sourcePath,
      explicitConfig: options.explicitConfig === true,
    };
    if (identityFile) host.identityFile = identityFile;
    if (user) host.user = user;
    return host;
  });
  return { hosts, warnings: parsed.warnings };
}

module.exports = {
  defaultSSHConfigPath,
  discoverSSHHosts,
  isAllowedExplicitConfigPath,
};
