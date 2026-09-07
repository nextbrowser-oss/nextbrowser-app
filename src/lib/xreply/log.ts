// The engine's own log: one line per thing it did or saw, kept apart from the
// panel. The panel shows the last three reasons of a pass; when a reply is
// refused on a page nobody was looking at, those three lines are the whole
// record, and "not signed in" on a signed-in profile cannot be explained from
// them. The log keeps every step, every CLI call with its timing, and what the
// page looked like at each refusal, so a failure on someone else's machine can
// be read instead of guessed at.
//
// The sink is installed by the app; without one the engine logs nothing, which
// is what the tests want.

export interface XReplyLogEntry {
  t: string;
  ev: string;
  [key: string]: unknown;
}

export type XReplyLogSink = (entry: XReplyLogEntry) => void;

let sink: XReplyLogSink | undefined;

/** setXReplyLogSink installs where log lines go. Pass undefined to silence. */
export function setXReplyLogSink(next?: XReplyLogSink): void {
  sink = next;
}

/** xlog records one event. It never throws: a log must not end a pass. */
export function xlog(ev: string, data: Record<string, unknown> = {}): void {
  if (!sink) return;
  try {
    sink({ t: new Date().toISOString(), ev, ...data });
  } catch {
    /* a log line that cannot be written is not the engine's problem */
  }
}

/** compact trims a value for a log line: long strings are cut, objects are
 *  serialised and cut, so a timeline snapshot does not turn into a page. */
export function compact(value: unknown, max = 600): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= max) return value;
  return `${text.slice(0, max)}… (${text.length} chars)`;
}

/** errorText names an error for a log line. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
