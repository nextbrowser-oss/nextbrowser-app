export interface TerminalBrowserSession {
  name: string;
  signal: string;
}

export function terminalBrowserSession(
  output: string,
  allowedProfiles: string[],
): TerminalBrowserSession | undefined {
  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const blocks = [...plain.matchAll(/"session"\s*:\s*\{([^{}]*)\}/gs)];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index][1];
    const name = block.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
    const runtime = block.match(/"runtime"\s*:\s*"([^"]+)"/)?.[1];
    const backend = block.match(/"backend"\s*:\s*"([^"]+)"/)?.[1];
    if (name && allowedProfiles.includes(name) && (runtime || backend)) {
      return { name, signal: `${name}:${runtime || backend}` };
    }
  }
  return undefined;
}
