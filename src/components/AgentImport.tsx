import { useEffect, useState } from "react";
import { BookOpen, Cable, FileText, MessagesSquare, Settings2 } from "lucide-react";
import { invoke } from "../electronBridge";
import { Button, Dialog } from "../shared/ui";
import { useStore } from "../store";
import { stageStartPageDraft } from "../lib/startPageDraft";

const kinds = {
  chats: ["Conversations", MessagesSquare],
  settings: ["Settings", Settings2],
  mcp: ["MCP servers", Cable],
  instructions: ["Skills and instructions", FileText],
} as const;
type Kind = keyof typeof kinds;
type Source = { provider: string; counts: Record<Kind, number>; warnings: number };
type Entry = { id: string; provider: string; kind: Kind; title: string };
type Library = { entries: Entry[]; archivePath?: string; keyPath?: string };
type Detail = Entry & { body: unknown };

export function AgentImport({ owner }: { owner: string }) {
  const workspaceId = useStore((s) => s.activeWorkspaceId);
  return workspaceId
    ? <AgentSources key={JSON.stringify([owner, workspaceId])} owner={owner} workspaceId={workspaceId} />
    : <section className="personal-profiles account-network-section"><h3>Agent profiles</h3><p>Select a workspace to import agent data.</p></section>;
}

function AgentSources({ owner, workspaceId }: { owner: string; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Source[]>();
  const [scanFailed, setScanFailed] = useState(false);
  useEffect(() => {
    let active = true;
    // The shell publishes the workspace scope in the same commit.
    Promise.resolve().then(async () => {
      if (!active) return;
      try {
        const found = await invoke<Source[]>("personal_profiles_agent_scan", { owner: "account/" + owner, workspaceId });
        if (active) setSources(found);
      } catch { if (active) setScanFailed(true); }
    });
    return () => { active = false; };
  }, [owner, workspaceId]);
  return (
    <section className="personal-profiles account-network-section">
      <header>
        <h3>Agent profiles</h3>
        <Button disabled={!sources && !scanFailed} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close library" : "Import agent data"}
        </Button>
      </header>
      {!open && <div className="account-agent-sources">
        {sources ? sources.map(s => {
          const available = (Object.keys(kinds) as Kind[]).filter(kind => s.counts[kind] > 0);
          return <div key={s.provider}>{s.provider} · {available.length ? available.map(kind => kinds[kind][0]).join(", ") : s.warnings ? "Scan incomplete" : "No local files found"}</div>;
        }) : scanFailed ? "Could not scan local sources. Open the library to try again." : "Checking for local Codex and Claude data…"}
      </div>}
      {open && (
        <AgentLibrary owner={owner} workspaceId={workspaceId} initialSources={sources} onScan={setSources} />
      )}
    </section>
  );
}

function AgentLibrary({ owner, workspaceId, initialSources, onScan }: {
  owner: string; workspaceId: string; initialSources?: Source[]; onScan: (sources: Source[]) => void;
}) {
  const scope = { owner: "account/" + owner, workspaceId };
  const call = <T,>(action: string, args: Record<string, unknown> = {}) =>
    invoke<T>("personal_profiles_agent_" + action, { ...scope, ...args });
  const [sources, setSources] = useState<Source[]>(initialSources ?? []);
  const [provider, setProvider] = useState("Codex");
  const [selected, setSelected] = useState<Kind[]>([]);
  const [library, setLibrary] = useState<Library>({ entries: [] });
  const [detail, setDetail] = useState<Detail>();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    Promise.all([initialSources ?? call<Source[]>("scan"), call<Library>("list")])
      .then(([found, saved]) => {
        if (current) {
          setSources(found);
          onScan(found);
          setLibrary(saved);
          setProvider(found.find((s) => Object.values(s.counts).some(Boolean))?.provider || "Codex");
        }
      })
      .catch((e) => {
        if (current) setError(String(e.message));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [owner, workspaceId]);
  async function run(job: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const source = sources.find((s) => s.provider === provider);
  async function transfer(action: "import" | "restore" | "file") {
    const result = await call<{ count: number; skipped: string[] } | null>(action, { provider, selected });
    if (!result) return;
    setLibrary(await call<Library>("list"));
    setSelected([]);
    setNotice(
      `${result.count} items saved or updated.` +
        (result.skipped.length ? " Skipped files: " + result.skipped.join(", ") : ""),
    );
  }
  const entries = library.entries.filter((e) =>
    (e.provider + " " + e.title + " " + e.kind).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="personal-import">
      <div className="personal-profile-actions">
        {sources.map((s) => (
          <Button
            key={s.provider}
            disabled={busy}
            aria-pressed={provider === s.provider}
            onClick={() => {
              setProvider(s.provider);
              setSelected([]);
            }}
          >
            {s.provider}
          </Button>
        ))}
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const refreshed = await call<Source[]>("scan");
              setSources(refreshed);
              onScan(refreshed);
              setSelected([]);
            })
          }
        >
          Rescan
        </Button>
        <Button disabled={busy} onClick={() => void run(() => transfer("file"))}>
          Choose {provider} export…
        </Button>
        <Button disabled={busy} onClick={() => void run(() => transfer("restore"))}>
          Restore library…
        </Button>
      </div>
      {source && (
        <fieldset className="personal-source-items">
          <legend>Local {source.provider} data</legend>
          {(Object.keys(kinds) as Kind[]).map((k) => {
            const [label, Icon] = kinds[k];
            return (
              <label className="personal-data-row" key={k}>
                <Icon size={15} />
                <span>{label}</span>
                <small>{source.counts[k]} source files</small>
                <span className="toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={label}
                    checked={selected.includes(k)}
                    disabled={busy || !source.counts[k]}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, k] : selected.filter((x) => x !== k))
                    }
                  />
                  <span className="toggle-track">
                    <span className="toggle-knob" />
                  </span>
                </span>
              </label>
            );
          })}
          {source.warnings > 0 && <small>{source.warnings} paths could not be scanned.</small>}
        </fieldset>
      )}
      <div className="personal-import-footer">
        <p>
          Selected data stays in your encrypted library on this device. MCP servers require review before
          connection.
        </p>
        <Button disabled={busy || !selected.length} onClick={() => void run(() => transfer("import"))}>
          Import selected
        </Button>
      </div>
      {library.entries.length > 0 && (
        <>
          <input
            className="shared-text-field"
            aria-label="Search imported agent data"
            placeholder="Search imported items"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="personal-source-list agent-library-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setDetail({ ...entry, ...(await call<Detail>("read", { id: entry.id })) }),
                    )
                  }
                >
                  <BookOpen size={15} />
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.provider} · {kinds[entry.kind][0]}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <details className="personal-recovery">
            <summary>Library and recovery key</summary>
            <p>Save both files separately to restore the library.</p>
            <code>{library.archivePath}</code>
            <code>{library.keyPath}</code>
          </details>
        </>
      )}
      {busy && <p role="status">Reading local data…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {detail && (
        <Dialog title={detail.title} onClose={() => setDetail(undefined)}>
          <div className="agent-import-preview">
            {detail.kind === "chats" && Array.isArray(detail.body) ? (
              detail.body.map((m, i) => (
                <section key={i}>
                  <strong>{m.role === "user" ? "You" : detail.provider}</strong>
                  <p>{m.text}</p>
                </section>
              ))
            ) : (
              <pre>
                {typeof detail.body === "string" ? detail.body : JSON.stringify(detail.body, null, 2)}
              </pre>
            )}
          </div>
          {detail.kind === "chats" && Array.isArray(detail.body) && (
            <Button
              onClick={() => {
                if (!Array.isArray(detail.body)) return;
                const text = detail.body
                  .map((turn) => (turn.role === "user" ? "You" : detail.provider) + ": " + turn.text)
                  .join("\n\n");
                const store = useStore.getState();
                const id = store.newChat();
                stageStartPageDraft(id, text);
                store.setTab("chat");
              }}
            >
              Continue as an unsent draft
            </Button>
          )}
          {detail.kind === "mcp" && (
            <Button
              onClick={() =>
                void run(async () => {
                  await call("review", { id: detail.id });
                  setDetail(undefined);
                })
              }
            >
              Review in Extensions → MCP
            </Button>
          )}
        </Dialog>
      )}
    </div>
  );
}
