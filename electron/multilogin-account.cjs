// Multilogin tokens are JWTs, and their claims are the only place the app can learn whose
// workspace a token opens. Claims are read for display only - never verified, never trusted.
// Multilogin spells its claims "workspaceID" and "userID", other issuers use "workspace_id", so
// names are compared with case and underscores removed rather than listed in every spelling.
const EMAIL_CLAIMS = ["email", "useremail", "preferredusername", "upn"];
const WORKSPACE_ID_CLAIMS = ["workspaceid", "wsid", "tenantid"];
const WORKSPACE_NAME_CLAIMS = ["workspacename", "tenantname"];
const WORKSPACE_ROLE_CLAIMS = ["workspacerole", "role"];
const MAX_CLAIM_LENGTH = 200;

function normalizeClaimName(name) {
  return String(name).replace(/[_-]/g, "").toLowerCase();
}

function decodeTokenClaims(token) {
  const segments = String(token || "").split(".");
  if (segments.length < 2) return null;
  try {
    const json = Buffer.from(segments[1], "base64url").toString("utf8");
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

function claimValue(claims, names) {
  if (!claims) return "";
  const wanted = new Set(names.map(normalizeClaimName));
  for (const [key, value] of Object.entries(claims)) {
    if (!wanted.has(normalizeClaimName(key))) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text && text.length <= MAX_CLAIM_LENGTH) return text;
  }
  return "";
}

function emailFrom(claims) {
  const direct = claimValue(claims, EMAIL_CLAIMS);
  if (direct.includes("@")) return direct;
  const subject = claimValue(claims, ["sub"]);
  return subject.includes("@") ? subject : "";
}

/**
 * Builds the display-only account identity for the connected Multilogin token. Tokens are read in
 * order, so the pasted bearer token (which carries the signed-in account) wins over the automation
 * token exchanged from it.
 */
function multiloginAccountFromTokens(...tokens) {
  const account = {};
  for (const token of tokens) {
    const claims = decodeTokenClaims(token);
    if (!claims) continue;
    if (!account.email) {
      const email = emailFrom(claims);
      if (email) account.email = email;
    }
    if (!account.workspaceId) {
      const workspaceId = claimValue(claims, WORKSPACE_ID_CLAIMS);
      if (workspaceId) account.workspaceId = workspaceId;
    }
    if (!account.workspaceName) {
      const workspaceName = claimValue(claims, WORKSPACE_NAME_CLAIMS);
      if (workspaceName) account.workspaceName = workspaceName;
    }
    if (!account.workspaceRole) {
      const workspaceRole = claimValue(claims, WORKSPACE_ROLE_CLAIMS);
      if (workspaceRole) account.workspaceRole = workspaceRole;
    }
  }
  return Object.keys(account).length ? account : undefined;
}

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Which folder each profile kind reads from and creates into, when a person picked one. */
function sanitizeMultiloginFolders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const folders = {};
  for (const kind of ["browser", "mobile"]) {
    const id = typeof value[kind] === "string" ? value[kind].trim() : "";
    if (FOLDER_ID_PATTERN.test(id)) folders[kind] = id;
  }
  return Object.keys(folders).length ? folders : undefined;
}

function sanitizeMultiloginAccount(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const account = {};
  for (const key of ["email", "workspaceId", "workspaceName", "workspaceRole"]) {
    const text = typeof value[key] === "string" ? value[key].trim() : "";
    if (text && text.length <= MAX_CLAIM_LENGTH) account[key] = text;
  }
  return Object.keys(account).length ? account : undefined;
}

module.exports = { decodeTokenClaims, multiloginAccountFromTokens, sanitizeMultiloginAccount, sanitizeMultiloginFolders };
