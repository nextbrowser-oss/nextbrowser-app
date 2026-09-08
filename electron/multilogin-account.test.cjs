const assert = require("node:assert/strict");
const test = require("node:test");

const { decodeTokenClaims, multiloginAccountFromTokens, sanitizeMultiloginAccount } = require("./multilogin-account.cjs");

function jwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

test("reads the account and workspace a token belongs to", () => {
  const account = multiloginAccountFromTokens(jwt({ email: "pasha@example.com", workspace_id: "ws-1", workspace_name: "Shared" }));
  assert.deepEqual(account, { email: "pasha@example.com", workspaceId: "ws-1", workspaceName: "Shared" });
});

test("reads the claim spelling Multilogin actually ships", () => {
  // Shape taken from a real Multilogin bearer token: capitalised IDs, no workspace name claim.
  const account = multiloginAccountFromTokens(jwt({
    "bpds.bucket": "mlx-bpds-prod-eu-1",
    workspaceRole: "manager",
    planName: "Business 300 (yearly)",
    userID: "7764d8ff-b3cf-4126-ba76-d10d2bb67770",
    email: "someone@example.dev",
    isAutomation: false,
    workspaceID: "a95f936a-4bc8-451e-bbfb-9123e98b16c3",
    sub: "MLX",
  }));

  assert.deepEqual(account, {
    email: "someone@example.dev",
    workspaceId: "a95f936a-4bc8-451e-bbfb-9123e98b16c3",
    workspaceRole: "manager",
  });
});

test("prefers the first token but fills gaps from later ones", () => {
  const account = multiloginAccountFromTokens(
    jwt({ email: "owner@example.com" }),
    jwt({ email: "automation@example.com", workspace_id: "ws-2" }),
  );
  assert.deepEqual(account, { email: "owner@example.com", workspaceId: "ws-2" });
});

test("falls back to an email-shaped subject claim", () => {
  assert.equal(multiloginAccountFromTokens(jwt({ sub: "someone@example.com" }))?.email, "someone@example.com");
  assert.equal(multiloginAccountFromTokens(jwt({ sub: "4f3a-uuid" })), undefined);
});

test("ignores tokens that are not JWTs at all", () => {
  assert.equal(decodeTokenClaims("not-a-token"), null);
  assert.equal(multiloginAccountFromTokens("not-a-token", ""), undefined);
});

test("drops oversized and non-string claims", () => {
  const account = multiloginAccountFromTokens(jwt({ email: `${"a".repeat(300)}@example.com`, workspace_id: { nested: true }, workspace_name: "Ops" }));
  assert.deepEqual(account, { workspaceName: "Ops" });
});

test("sanitizes account metadata read back from disk", () => {
  assert.deepEqual(sanitizeMultiloginAccount({ email: " a@b.co ", workspaceId: "", extra: "x" }), { email: "a@b.co" });
  assert.equal(sanitizeMultiloginAccount("nope"), undefined);
});
