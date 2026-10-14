const assert = require("node:assert/strict");
const test = require("node:test");

const { parseMultiloginProfiles, parseMultiloginCreatedProfile, parseMultiloginCreatedMobileProfile } = require("./multilogin-profiles.cjs");

test("normalizes Multilogin Mimic browser profiles", () => {
  assert.deepEqual(
    parseMultiloginProfiles(JSON.stringify({
      data: {
        profiles: [
          { profile_id: "browser-1", profile_name: "Amazon US", folder_id: "folder-1" },
          { id: "browser-2", name: "Work EU", folderId: "folder-2", state: "stopped" },
        ],
      },
    })),
    [
      { id: "browser-1", name: "Amazon US", folderId: "folder-1", status: undefined },
      { id: "browser-2", name: "Work EU", folderId: "folder-2", status: "stopped" },
    ],
  );
});

test("normalizes cloud phones and removes duplicate IDs", () => {
  assert.deepEqual(
    parseMultiloginProfiles(JSON.stringify({
      profiles: [
        { id: 17, device_name: "Android US", run_status: "running" },
        { id: 17, device_name: "Duplicate" },
        null,
      ],
    })),
    [{ id: "17", name: "Android US", folderId: undefined, status: "running" }],
  );
});

test("rejects invalid Multilogin profile output", () => {
  assert.throws(() => parseMultiloginProfiles("not-json"), /invalid Multilogin profile response/);
});

test("reads the created Multilogin profile identifiers", () => {
  assert.deepEqual(
    parseMultiloginCreatedProfile(JSON.stringify({
      ok: true,
      data: {
        profile: {
          profile: { id: "browser-9", name: "Shop US", folder_id: "folder-3", os_type: "windows" },
          country: "us",
          proxy_scheme: "http",
          storage: "cloud",
        },
      },
    })),
    { id: "browser-9", name: "Shop US", folderId: "folder-3", country: "US", storage: "cloud" },
  );
});

test("rejects a Multilogin create response without an ID", () => {
  assert.throws(
    () => parseMultiloginCreatedProfile(JSON.stringify({ data: { profile: { profile: { name: "Shop US" } } } })),
    /did not return the created profile/,
  );
});

test("reads a created Multilogin cloud phone", () => {
  assert.deepEqual(
    parseMultiloginCreatedMobileProfile(JSON.stringify({
      data: { mobile: { folder_id: "mobile-folder", country: "us", profiles: [{ id: "phone-1", name: "Research phone" }] } },
    })),
    { id: "phone-1", name: "Research phone", folderId: "mobile-folder", country: "US" },
  );
});

test("creates a Multilogin profile with a personal proxy without putting the password on the command line", () => {
  const { multiloginProfileCreateArgs } = require("./multilogin-profiles.cjs");
  const command = multiloginProfileCreateArgs({
    name: "Shop", country: "US", osType: "linux", folderId: "folder-1",
    proxy: { scheme: "socks5", host: "proxy.example", port: 1080, username: "alice", password: "secret" },
  });
  assert.deepEqual(command.args, [
    "--runtime", "multilogin", "--multilogin-folder-id", "folder-1",
    "profiles", "create", "Shop",
    "--manual-proxy", "--proxy-scheme", "socks5", "--proxy-host", "proxy.example", "--proxy-port", "1080", "--proxy-username", "alice",
    "--os-type", "linux", "--format", "json",
  ]);
  assert.deepEqual(command.env, { NBC_PROXY_PASSWORD: "secret" });
  assert.ok(!command.args.includes("secret"));
});

test("keeps the Multilogin country proxy when no personal proxy is chosen", () => {
  const { multiloginProfileCreateArgs } = require("./multilogin-profiles.cjs");
  assert.deepEqual(multiloginProfileCreateArgs({ name: "Shop", country: "ge", osType: "windows" }).args, [
    "--runtime", "multilogin", "profiles", "create", "Shop", "--country", "GE", "--os-type", "windows", "--format", "json",
  ]);
});
