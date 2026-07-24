import { invoke } from "./electronBridge";

// Bridge to the Rust backend, which shells out to the `nextctl` binary.
// Mirrors clawdesk/Sources/ClawDesk/Core/Nextctl.swift.

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface NextctlRunOptions {
  requestId?: string;
  timeoutMs?: number;
}

export interface Envelope<T> {
  ok: boolean;
  command?: string;
  data?: T;
  warnings?: string[];
  error?: { code?: string; message?: string; hint?: string };
}

export async function nextctlRun(
  args: string[],
  extraEnv?: Record<string, string>,
  options: NextctlRunOptions = {},
): Promise<RunResult> {
  return invoke<RunResult>("nextctl_run", {
    args,
    extraEnv: extraEnv ?? null,
    requestId: options.requestId,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
}

export async function cancelNextctlRun(requestId: string): Promise<boolean> {
  return invoke<boolean>("nextctl_cancel", { requestId });
}

export function nextctlErrorMessage(res: RunResult): string {
  try {
    const env = JSON.parse(res.stdout) as Envelope<unknown>;
    if (env.error?.message) {
      const code = env.error.code ? ` [${env.error.code}]` : "";
      const hint = env.error.hint ? ` — ${env.error.hint}` : "";
      return `${env.error.message}${code}${hint}`;
    }
    if (env.warnings?.[0]) return env.warnings[0];
  } catch {
    /* not JSON */
  }
  const e = res.stderr.trim();
  if (e) return e;
  const o = res.stdout.trim();
  return o || "nextctl command failed";
}

/// Run a command in JSON mode and decode the `data` payload.
export async function nextctlJson<T>(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<T> {
  const res = await nextctlRun([...args, "--format", "json"], extraEnv);
  let env: Envelope<T>;
  try {
    env = JSON.parse(res.stdout) as Envelope<T>;
  } catch {
    throw new Error(nextctlErrorMessage(res));
  }
  if (env.ok && env.data !== undefined) return env.data;
  if (env.error) throw new Error(nextctlErrorMessage(res));
  if (env.data !== undefined) return env.data;
  throw new Error(nextctlErrorMessage(res));
}

/// Run JSON mode and return envelope + raw result (for eval where ok may be false).
export async function nextctlEnvelope<T>(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<{ env: Envelope<T>; res: RunResult }> {
  const res = await nextctlRun([...args, "--format", "json"], extraEnv);
  let env: Envelope<T>;
  try {
    env = JSON.parse(res.stdout) as Envelope<T>;
  } catch {
    throw new Error(nextctlErrorMessage(res));
  }
  return { env, res };
}
