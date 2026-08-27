const assert = require("node:assert/strict");
const test = require("node:test");

const { parseMultiloginProfiles, parseMultiloginCreatedProfile } = require("./multilogin-profiles.cjs");

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
