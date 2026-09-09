export function codexMcpRecovery(agentId: string, output: string): string | undefined {
  if (agentId !== "codex") return undefined;
  if (/invalid transport\s*(?:\r?\n|\s)+in\s+mcp_servers\.clawbrowser/i.test(output)) {
    return "Codex rejected a legacy ClawBrowser MCP entry before startup. Update NextBrowser; if it still occurs, remove or repair [mcp_servers.clawbrowser] in ~/.codex/config.toml, then restart Terminal.";
  }
  if (/MCP client for [`']?clawbrowser[`']? failed to start|MCP startup incomplete \(failed: clawbrowser\)/i.test(output)) {
    return "The legacy standalone ClawBrowser MCP did not start. Restart Terminal; NextBrowser uses its managed nextbrowser MCP. If it repeats, see the Codex MCP troubleshooting steps in the NextBrowser README.";
  }
  return undefined;
}
