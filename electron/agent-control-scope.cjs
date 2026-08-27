function resolveScopedProfile(profileScope, requestedProfile) {
  const requested = String(requestedProfile || "");
  if (profileScope.has(requested)) return requested;
  if (profileScope.size === 1) return profileScope.keys().next().value || "";
  return "";
}

module.exports = { resolveScopedProfile };
