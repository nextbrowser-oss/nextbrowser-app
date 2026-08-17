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

module.exports = { parseMultiloginProfiles };
