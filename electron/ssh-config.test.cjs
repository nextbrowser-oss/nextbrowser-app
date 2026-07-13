const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { defaultSSHConfigPath, discoverSSHHosts } = require("./ssh-config.cjs");

async function tempHome(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-ssh-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, ".ssh", "conf.d"), { recursive: true });
  return homeDir;
}

test("defaultSSHConfigPath is cross-platform through the supplied home directory", () => {
  assert.equal(defaultSSHConfigPath(path.join(path.sep, "home", "operator")), path.join(path.sep, "home", "operator", ".ssh", "config"));
});

test("discovers concrete aliases through Include and never reads identity contents", async (t) => {
  const homeDir = await tempHome(t);
  const sshDir = path.join(homeDir, ".ssh");
  const configPath = path.join(sshDir, "config");
  const includedPath = path.join(sshDir, "conf.d", "servers.conf");
  const identityPath = path.join(sshDir, "id_alpha");
  await fs.writeFile(identityPath, "PRIVATE KEY CONTENT MUST NOT BE READ", "utf8");
  await fs.writeFile(includedPath, [
    "Host beta",
    "  HostName beta.example.test",
    "  User beta-user",
    "Host ignored?.example.test",
    "  HostName ignored.example.test",
  ].join("\r\n"), "utf8");
  await fs.writeFile(configPath, [
    "Include ~/.ssh/id_alpha",
    "Include conf.d/*.conf",
    "Host *",
    "  User shared-user",
    "  Port 2200",
    "Host alpha !blocked",
    "  HostName alpha.example.test",
    "  IdentityFile ~/.ssh/id_alpha",
    "Host *.wild.example.test",
    "  HostName ignored-wildcard.example.test",
    "Host [z-a]",
    "  HostName ignored-invalid-pattern.example.test",
    "Host !negated",
    "  HostName ignored-negated.example.test",
    "Host -option-like",
    "  HostName ignored-option.example.test",
  ].join("\n"), "utf8");

  const reads = [];
  const fsApi = {
    readFile: async (file, encoding) => {
      reads.push(path.resolve(file));
      return fs.readFile(file, encoding);
    },
    readdir: fs.readdir.bind(fs),
    lstat: fs.lstat.bind(fs),
    realpath: fs.realpath.bind(fs),
    stat: fs.stat.bind(fs),
  };
  const { hosts } = await discoverSSHHosts({ configPath, homeDir, fsApi });

  assert.deepEqual(hosts.map((host) => host.alias), ["alpha", "beta"]);
  assert.deepEqual(hosts[0], {
    alias: "alpha",
    hostname: "alpha.example.test",
    port: 2200,
    configPath,
    sourcePath: configPath,
    explicitConfig: false,
    identityFile: identityPath,
    user: "shared-user",
  });
  assert.equal(hosts[1].sourcePath, includedPath);
  assert.equal(hosts[1].hostname, "beta.example.test");
  assert.equal(hosts[1].user, "beta-user");
  assert.equal(reads.includes(await fs.realpath(identityPath)), false);
  assert.deepEqual(reads.sort(), await Promise.all([configPath, includedPath].map((file) => fs.realpath(file))).then((paths) => paths.sort()));
});

test("never executes ssh or Match exec while scanning a custom config", async (t) => {
  const homeDir = await tempHome(t);
  const configPath = path.join(homeDir, "custom.conf");
  const identityPath = path.join(homeDir, ".ssh", "id_prod");
  await fs.writeFile(configPath, [
    "Host prod",
    "  HostName fallback.example.test",
    "  User deploy",
    "  Port 2222",
    `  IdentityFile ${identityPath}`,
    "Match exec \"touch /tmp/must-not-run\"",
    "  LocalCommand unsafe-command",
  ].join("\n"), "utf8");
  await fs.writeFile(identityPath, "SECRET", "utf8");
  let executed = false;
  const execFileImpl = () => { executed = true; };

  const { hosts } = await discoverSSHHosts({
    configPath,
    homeDir,
    explicitConfig: true,
    execFileImpl,
  });

  assert.equal(executed, false);
  assert.deepEqual(hosts, [{
    alias: "prod",
    hostname: "fallback.example.test",
    port: 2222,
    configPath,
    sourcePath: configPath,
    explicitConfig: true,
    identityFile: identityPath,
    user: "deploy",
  }]);
  assert.equal(JSON.stringify(hosts).includes("secret"), false);
  assert.equal(JSON.stringify(hosts).includes("proxycommand"), false);
});

test("parses host metadata without invoking an SSH binary", async (t) => {
  const homeDir = await tempHome(t);
  const configPath = path.join(homeDir, ".ssh", "config");
  await fs.writeFile(configPath, [
    "Host fallback",
    "  HostName fallback.example.test",
    "  User operator",
    "  Port 2022",
  ].join("\n"), "utf8");
  let executed = false;
  const execFileImpl = () => { executed = true; };

  const { hosts } = await discoverSSHHosts({
    configPath,
    homeDir,
    execFileImpl,
  });

  assert.equal(executed, false);
  assert.deepEqual(hosts, [{
    alias: "fallback",
    hostname: "fallback.example.test",
    port: 2022,
    configPath,
    sourcePath: configPath,
    explicitConfig: false,
    user: "operator",
  }]);
});

test("marks aliases from the default config as non-explicit", async (t) => {
  const homeDir = await tempHome(t);
  const configPath = path.join(homeDir, ".ssh", "config");
  await fs.writeFile(configPath, "Host default-host\n", "utf8");
  const { hosts } = await discoverSSHHosts({ configPath, homeDir });
  assert.equal(hosts[0].explicitConfig, false);
});

test("handles adversarial wildcard patterns in bounded time", { timeout: 1000 }, async (t) => {
  const homeDir = await tempHome(t);
  const configPath = path.join(homeDir, ".ssh", "config");
  const pattern = `${"*a".repeat(400)}z`;
  await fs.writeFile(configPath, [
    `Host ${pattern}`,
    "  User ignored",
    "Host safe",
    "  HostName safe.example.test",
  ].join("\n"), "utf8");

  const { hosts } = await discoverSSHHosts({ configPath, homeDir });
  assert.deepEqual(hosts.map((host) => host.alias), ["safe"]);
});

test("ignores network and outside-root Includes without reading them", async (t) => {
  const homeDir = await tempHome(t);
  const configPath = path.join(homeDir, ".ssh", "config");
  const outsidePath = path.join(homeDir, "secrets.conf");
  await fs.writeFile(outsidePath, "Host leaked\n  User super-secret\n", "utf8");
  await fs.writeFile(configPath, [
    `Include ${outsidePath}`,
    "Include //server/share/*.conf",
    "Host safe",
    "  HostName safe.example.test",
  ].join("\n"), "utf8");

  const reads = [];
  const directoryReads = [];
  const fsApi = {
    readFile: async (file, encoding) => {
      reads.push(path.resolve(file));
      return fs.readFile(file, encoding);
    },
    readdir: async (directory, options) => {
      directoryReads.push(String(directory));
      return fs.readdir(directory, options);
    },
    lstat: fs.lstat.bind(fs),
    realpath: fs.realpath.bind(fs),
    stat: fs.stat.bind(fs),
  };

  const { hosts, warnings } = await discoverSSHHosts({ configPath, homeDir, fsApi });

  assert.deepEqual(hosts.map((host) => host.alias), ["safe"]);
  assert.deepEqual(reads, [await fs.realpath(configPath)]);
  assert.equal(directoryReads.some((directory) => directory.includes("server")), false);
  assert.ok(warnings.length > 0);
});

test("rejects a network root config before filesystem access", async () => {
  let touchedFilesystem = false;
  const fail = async () => {
    touchedFilesystem = true;
    throw new Error("filesystem should not be touched");
  };

  await assert.rejects(
    discoverSSHHosts({
      configPath: "//server/share/config",
      homeDir: path.join(path.sep, "home", "operator"),
      fsApi: { readFile: fail, readdir: fail, lstat: fail, realpath: fail, stat: fail },
    }),
    /Network SSH config paths are not supported/,
  );
  assert.equal(touchedFilesystem, false);
});

test("does not enumerate an Include glob through a symlinked directory", async (t) => {
  const homeDir = await tempHome(t);
  const sshDir = path.join(homeDir, ".ssh");
  const configPath = path.join(sshDir, "config");
  const outsideDir = path.join(homeDir, "outside");
  await fs.mkdir(outsideDir);
  await fs.writeFile(path.join(outsideDir, "leaked.conf"), "Host leaked\n", "utf8");
  await fs.symlink(outsideDir, path.join(sshDir, "conf.d", "link"), "dir");
  await fs.writeFile(configPath, [
    "Include conf.d/link/*.conf",
    "Host safe",
  ].join("\n"), "utf8");

  const enumerated = [];
  const fsApi = {
    readFile: fs.readFile.bind(fs),
    readdir: async (directory, options) => {
      enumerated.push(await fs.realpath(directory));
      return fs.readdir(directory, options);
    },
    lstat: fs.lstat.bind(fs),
    realpath: fs.realpath.bind(fs),
    stat: fs.stat.bind(fs),
  };

  const { hosts, warnings } = await discoverSSHHosts({ configPath, homeDir, fsApi });

  assert.deepEqual(hosts.map((host) => host.alias), ["safe"]);
  assert.equal(enumerated.includes(await fs.realpath(outsideDir)), false);
  assert.ok(warnings.some((warning) => warning.includes("traverse a link")));
});

test("skips conditional Includes instead of listing phantom aliases", async (t) => {
  const homeDir = await tempHome(t);
  const sshDir = path.join(homeDir, ".ssh");
  const configPath = path.join(sshDir, "config");
  const conditionalPath = path.join(sshDir, "conf.d", "conditional.conf");
  await fs.writeFile(conditionalPath, "Host phantom\n", "utf8");
  await fs.writeFile(configPath, [
    "Host active-only",
    "  Include conf.d/conditional.conf",
    "Host safe",
  ].join("\n"), "utf8");

  const { hosts, warnings } = await discoverSSHHosts({ configPath, homeDir });

  assert.deepEqual(hosts.map((host) => host.alias), ["active-only", "safe"]);
  assert.ok(warnings.some((warning) => warning.startsWith("Conditional SSH Include")));
});

test("skips extensionless Includes before reading them", async (t) => {
  const homeDir = await tempHome(t);
  const sshDir = path.join(homeDir, ".ssh");
  const configPath = path.join(sshDir, "config");
  const includedPath = path.join(sshDir, "work");
  await fs.writeFile(includedPath, "PRIVATE KEY CONTENT MUST NOT BE READ", "utf8");
  await fs.writeFile(configPath, "Include work\nHost safe\n", "utf8");

  const reads = [];
  const fsApi = {
    readFile: async (file, encoding) => {
      reads.push(path.resolve(file));
      return fs.readFile(file, encoding);
    },
    readdir: fs.readdir.bind(fs),
    lstat: fs.lstat.bind(fs),
    realpath: fs.realpath.bind(fs),
    stat: fs.stat.bind(fs),
  };

  const { hosts, warnings } = await discoverSSHHosts({ configPath, homeDir, fsApi });
  assert.deepEqual(hosts.map((host) => host.alias), ["safe"]);
  assert.equal(reads.includes(await fs.realpath(includedPath)), false);
  assert.ok(warnings.some((warning) => warning.includes("safe SSH config files")));
});

test("rejects private-key data disguised as a config file", async (t) => {
  const homeDir = await tempHome(t);
  const keyPath = path.join(homeDir, "stolen.conf");
  await fs.writeFile(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n", "utf8");

  await assert.rejects(
    discoverSSHHosts({ configPath: keyPath, homeDir, explicitConfig: true }),
    /private key, not an SSH config/,
  );
});

test("rejects an arbitrary explicit file before reading it", async (t) => {
  const homeDir = await tempHome(t);
  const keyPath = path.join(homeDir, "id_ed25519");
  await fs.writeFile(keyPath, "PRIVATE KEY", "utf8");
  let read = false;

  await assert.rejects(
    discoverSSHHosts({
      configPath: keyPath,
      homeDir,
      explicitConfig: true,
      fsApi: {
        readFile: async (...args) => { read = true; return fs.readFile(...args); },
        readdir: fs.readdir.bind(fs),
        lstat: fs.lstat.bind(fs),
        realpath: fs.realpath.bind(fs),
        stat: fs.stat.bind(fs),
      },
    }),
    /Choose an SSH config/,
  );
  assert.equal(read, false);
});
