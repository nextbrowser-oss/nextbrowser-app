function boundedString(value, maxLength = 200) {
  if (value == null) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function profileItems(payload) {
  const candidates = [
    payload?.data?.profiles,
    payload?.profiles,
    payload?.data?.items,
    payload?.items,
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizeMultiloginProfile(item, index) {
  if (!item || typeof item !== "object") return null;
  const id = boundedString(
    item.id ?? item.profile_id ?? item.profileId ?? item.uuid ?? item.sid,
  );
  const name = boundedString(
    item.name ?? item.profile_name ?? item.profileName ?? item.device_name ?? id,
  );
  if (!id && !name) return null;
  return {
    id: id || `profile-${index + 1}`,
    name: name || id,
    folderId: boundedString(item.folder_id ?? item.folderId ?? item.group_id ?? item.groupId) || undefined,
    status: boundedString(item.status ?? item.state ?? item.run_status ?? item.runStatus, 80) || undefined,
  };
}

function parseMultiloginProfiles(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ""));
  } catch {
    throw new Error("nextctl returned an invalid Multilogin profile response.");
  }
  const seen = new Set();
  return profileItems(payload).slice(0, 500).flatMap((item, index) => {
    const profile = normalizeMultiloginProfile(item, index);
    if (!profile) return [];
    const key = `${profile.folderId || ""}\u0000${profile.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [profile];
  });
}

function createdProfileRecord(payload) {
  const candidates = [payload?.data?.profile, payload?.profile, payload?.data];
  const result = candidates.find((item) => item && typeof item === "object");
  if (!result) return null;
  const record = result.profile && typeof result.profile === "object" ? result.profile : result;
  return { record, result };
}

// `nbc --runtime multilogin profiles create` answers with the created Mimic
// record plus the proxy Multilogin attached to it. The renderer only needs the
// identifiers required to bind the profile to a workspace.
function parseMultiloginCreatedProfile(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ""));
  } catch {
    throw new Error("nextctl returned an invalid Multilogin profile response.");
  }
  const found = createdProfileRecord(payload);
  const record = found?.record;
  const id = record ? boundedString(record.id ?? record.profile_id ?? record.profileId) : "";
  if (!id) throw new Error("Multilogin did not return the created profile.");
  const country = boundedString(found.result.country, 8).toUpperCase();
  return {
    id,
    name: boundedString(record.name ?? record.profile_name ?? record.profileName) || id,
    folderId: boundedString(record.folder_id ?? record.folderId) || undefined,
    country: country || undefined,
    storage: boundedString(found.result.storage, 20) || undefined,
  };
}

module.exports = { parseMultiloginProfiles, parseMultiloginCreatedProfile };
