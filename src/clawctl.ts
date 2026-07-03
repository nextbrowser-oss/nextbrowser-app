import { invoke } from "./electronBridge";

// Bridge to the Rust backend, which shells out to the `clawctl` binary.
// Mirrors clawdesk/Sources/ClawDesk/Core/Clawctl.swift.

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Envelope<T> {
  ok: boolean;
  command?: string;
  data?: T;
  warnings?: string[];
  error?: { code?: string; message?: string; hint?: string };
}

export async function clawctlRun(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<RunResult> {
  return invoke<RunResult>("clawctl_run", { args, extraEnv: extraEnv ?? null });
}

export function clawctlErrorMessage(res: RunResult): string {
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
  return o || "clawctl command failed";
}

/// Run a command in JSON mode and decode the `data` payload.
export async function clawctlJson<T>(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<T> {
  const res = await clawctlRun([...args, "--format", "json"], extraEnv);
  let env: Envelope<T>;
  try {
    env = JSON.parse(res.stdout) as Envelope<T>;
  } catch {
    throw new Error(clawctlErrorMessage(res));
  }
  if (env.ok && env.data !== undefined) return env.data;
  if (env.error) throw new Error(clawctlErrorMessage(res));
  if (env.data !== undefined) return env.data;
  throw new Error(clawctlErrorMessage(res));
}

/// Run JSON mode and return envelope + raw result (for eval where ok may be false).
export async function clawctlEnvelope<T>(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<{ env: Envelope<T>; res: RunResult }> {
  const res = await clawctlRun([...args, "--format", "json"], extraEnv);
  let env: Envelope<T>;
  try {
    env = JSON.parse(res.stdout) as Envelope<T>;
  } catch {
    throw new Error(clawctlErrorMessage(res));
  }
  return { env, res };
}
