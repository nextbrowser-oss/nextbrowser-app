import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import {
  buildVPSPrompt,
  sshCommandForConnection,
  type SSHHost,
  type VPSConnection,
} from "../lib/vpsPrompt";
import { internalError, needsSupportLink } from "../lib/userFacingError";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

const CUSTOM_CONFIGS_FILE = "ssh-config-paths.json";
const MAX_CUSTOM_CONFIGS = 16;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface SSHDiscoveryResult {
  hosts: SSHHost[];
  warnings?: string[];
}

function uniquePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((path): path is string => typeof path === "string" && !!path.trim()))];
}

function hostKey(host: SSHHost): string {
  return `${host.configPath}\u0000${host.alias}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function resolvedTarget(host: SSHHost): string {
  const hostname = host.hostname || host.alias;
  return `${host.user ? `${host.user}@` : ""}${hostname}:${host.port ?? 22}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function submitErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (
    message === "Finish or cancel queued local work before starting a VPS task."
    || message === "The agent is still connecting. Wait a moment and try again."
    || needsSupportLink(message)
  ) return message;
  return internalError("We couldn't start the VPS task.");
}

function connectionLabel(connection: VPSConnection): string {
  if (connection.kind === "ssh-config") {
    return `${connection.host.alias} · ${resolvedTarget(connection.host)} · ${fileName(connection.host.configPath)}`;
  }
  return `${connection.user ? `${connection.user}@` : ""}${connection.host}:${connection.port ?? 22}`;
}

function localShellPlatform(): "posix" | "windows" {
  return /Windows|Win32|Win64/i.test(`${navigator.userAgent} ${navigator.platform}`)
    ? "windows"
    : "posix";
}

export function VPSSetupModal({ onClose }: { onClose: () => void }) {
  const sendVPSPrompt = useStore((s) => s.sendVPSPrompt);
  const [mode, setMode] = useState<"hosts" | "manual">("hosts");
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [customConfigPaths, setCustomConfigPaths] = useState<string[]>([]);
  const [selectedHostKey, setSelectedHostKey] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [configMutation, setConfigMutation] = useState<"add" | "remove" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const loadGenerationRef = useRef(0);
  const configMutationRef = useRef(false);
  const customConfigPathsRef = useRef<string[]>([]);
  const shellPlatform = useMemo(localShellPlatform, []);
  const mutatingConfig = configMutation !== null;

  const [manualHost, setManualHost] = useState("");
  const [manualUser, setManualUser] = useState("");
  const [manualPort, setManualPort] = useState("22");
  const [manualIdentityFile, setManualIdentityFile] = useState("");
  const [task, setTask] = useState("");

  const saveCustomPaths = async (paths: string[]) => {
    await invoke("app_data_write", {
      name: CUSTOM_CONFIGS_FILE,
      content: JSON.stringify(paths),
    });
  };

  const updateCustomPaths = (paths: string[]) => {
    customConfigPathsRef.current = paths;
    setCustomConfigPaths(paths);
  };

  const loadHosts = async (paths: string[]) => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    const requests = [
      { label: "default SSH config", configPath: undefined, explicitConfig: false },
      ...paths.map((configPath) => ({
        label: configPath,
        configPath,
        explicitConfig: true,
      })),
    ];
    const nextHosts: SSHHost[] = [];
    const seen = new Set<string>();
    const failures: string[] = [];
    const warnings: string[] = [];
    for (const request of requests) {
      if (generation !== loadGenerationRef.current) return;
      try {
        const result = request.configPath
          ? await invoke<SSHDiscoveryResult>("ssh_config_hosts", { configPath: request.configPath })
          : await invoke<SSHDiscoveryResult>("ssh_config_hosts");
        if (generation !== loadGenerationRef.current) return;
        for (const discoveryWarning of result.warnings ?? []) {
          warnings.push(`${request.label}: ${discoveryWarning}`);
        }
        for (const host of result.hosts) {
          const normalizedHost: SSHHost = {
            ...host,
            explicitConfig: host.explicitConfig ?? request.explicitConfig,
          };
          const key = hostKey(normalizedHost);
          if (seen.has(key)) continue;
          seen.add(key);
          nextHosts.push(normalizedHost);
        }
      } catch {
        failures.push(request.label);
      }
    }
    if (generation !== loadGenerationRef.current) return;
    nextHosts.sort((left, right) => left.alias.localeCompare(right.alias, undefined, { sensitivity: "base" }));
    setHosts(nextHosts);
    setSelectedHostKey((current) => nextHosts.some((host) => hostKey(host) === current)
      ? current
      : hostKey(nextHosts[0] ?? { alias: "", configPath: "", explicitConfig: false }));
    if (!nextHosts.length) setMode("manual");
    if (failures.length) {
      setError("Some SSH configuration files couldn't be read. Check the selected files and try again.");
    }
    setScanWarning(warnings.length ? warnings.join(" ") : null);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const saved = await invoke<string | null>("app_data_read", { name: CUSTOM_CONFIGS_FILE });
        let paths: string[] = [];
        if (saved) {
          try {
            const savedPaths = uniquePaths(JSON.parse(saved));
            paths = savedPaths.slice(0, MAX_CUSTOM_CONFIGS);
            if (savedPaths.length > MAX_CUSTOM_CONFIGS) {
              setWarning(`Only the first ${MAX_CUSTOM_CONFIGS} saved SSH configs were loaded.`);
            }
          } catch {
            setWarning("Saved SSH config list is invalid and was ignored.");
          }
        }
        if (cancelled) return;
        updateCustomPaths(paths);
        await loadHosts(paths);
      } catch {
        if (cancelled) return;
        setError(internalError("We couldn't load your SSH connections."));
        setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const preferred = dialog?.querySelector<HTMLElement>(`[data-vps-autofocus="${mode}"]`);
      (preferred ?? dialog)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting && !mutatingConfig) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.matches(":disabled") && element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mutatingConfig, onClose, submitting]);

  const filteredHosts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return hosts;
    return hosts.filter((host) => [
      host.alias,
      host.hostname,
      host.user,
      host.configPath,
      host.sourcePath,
      resolvedTarget(host),
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [hosts, search]);
  const selectedHost = filteredHosts.find((host) => hostKey(host) === selectedHostKey);

  const portNumber = Number(manualPort);
  const manualPortValid = /^\d+$/.test(manualPort) && portNumber >= 1 && portNumber <= 65_535;
  const connection: VPSConnection | null = mode === "hosts"
    ? selectedHost ? { kind: "ssh-config", host: selectedHost, shellPlatform } : null
    : manualHost.trim() && manualPortValid
      ? {
          kind: "manual",
          host: manualHost.trim(),
          user: manualUser.trim() || undefined,
          port: portNumber,
          identityFile: manualIdentityFile.trim() || undefined,
          shellPlatform,
        }
      : null;

  const commandPreview = useMemo(() => {
    if (!connection) return { text: "Complete the connection details to preview the SSH command.", valid: false, error: undefined };
    try {
      return { text: sshCommandForConnection(connection), valid: true, error: undefined };
    } catch (previewError) {
      const message = errorMessage(previewError);
      return { text: message, valid: false, error: message };
    }
  }, [connection]);

  const addConfig = async () => {
    if (configMutationRef.current) return;
    if (customConfigPathsRef.current.length >= MAX_CUSTOM_CONFIGS) {
      setError(`You can add up to ${MAX_CUSTOM_CONFIGS} SSH config files.`);
      return;
    }
    configMutationRef.current = true;
    setConfigMutation("add");
    setError(null);
    try {
      const selected = await invoke<string | null>("select_ssh_config");
      if (!selected) return;
      const paths = uniquePaths([...customConfigPathsRef.current, selected]).slice(0, MAX_CUSTOM_CONFIGS);
      await saveCustomPaths(paths);
      updateCustomPaths(paths);
      await loadHosts(paths);
      setMode("hosts");
    } catch {
      setError(internalError("We couldn't add the SSH configuration."));
    } finally {
      configMutationRef.current = false;
      setConfigMutation(null);
    }
  };

  const removeConfig = async (path: string) => {
    if (configMutationRef.current) return;
    configMutationRef.current = true;
    setConfigMutation("remove");
    const paths = customConfigPathsRef.current.filter((candidate) => candidate !== path);
    setError(null);
    try {
      await saveCustomPaths(paths);
      updateCustomPaths(paths);
      await loadHosts(paths);
    } catch {
      setError(internalError("We couldn't remove the SSH configuration."));
    } finally {
      configMutationRef.current = false;
      setConfigMutation(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !commandPreview.valid || submitting || mutatingConfig || (mode === "hosts" && loading)) return;
    setSubmitting(true);
    setError(null);
    try {
      const prompt = buildVPSPrompt(connection, task.trim() || undefined);
      await sendVPSPrompt(prompt, connectionLabel(connection));
      onClose();
    } catch (submitError) {
      setError(submitErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={() => !submitting && !mutatingConfig && onClose()}>
      <form
        ref={dialogRef}
        className="modal-card vps-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting || mutatingConfig}
        aria-labelledby="vps-modal-title"
        tabIndex={-1}
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="vps-modal-header">
          <div className="vps-modal-mark"><Icon name="network" size={20} /></div>
          <div>
            <strong id="vps-modal-title">Use VPS</strong>
            <p className="muted small">Run the agent and Clawbrowser tools on a remote server over SSH.</p>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="plain-icon-btn"
            aria-label="Close VPS setup"
            title="Close"
            disabled={submitting || mutatingConfig}
            onClick={onClose}
          >
            <Icon name="xmark.circle.fill" size={18} />
          </button>
        </div>

        <fieldset className="vps-form-fields" disabled={submitting || mutatingConfig}>
          <div className="vps-mode-tabs" role="group" aria-label="SSH connection type">
          <button
            type="button"
            aria-pressed={mode === "hosts"}
            className={mode === "hosts" ? "active" : ""}
            onClick={() => setMode("hosts")}
          >
            <Icon name="terminal" size={13} /> Configured hosts
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            <Icon name="plus" size={13} /> Manual connection
          </button>
          </div>

        {mode === "hosts" ? (
          <section className="vps-configured-panel" aria-label="Configured SSH hosts">
            <div className="vps-host-toolbar">
              <label className="vps-search-field">
                <Icon name="magnifyingglass" size={14} />
                <span>Search SSH hosts</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                  placeholder="Alias, hostname, or user"
                  data-vps-autofocus="hosts"
                />
              </label>
              <button
                type="button"
                className="secondary small"
                disabled={mutatingConfig || loading || customConfigPaths.length >= MAX_CUSTOM_CONFIGS}
                title={customConfigPaths.length >= MAX_CUSTOM_CONFIGS
                  ? `Up to ${MAX_CUSTOM_CONFIGS} custom SSH configs are supported`
                  : "Add another SSH config file"}
                onClick={() => void addConfig()}
              >
                {configMutation === "add" ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                Add SSH config
              </button>
            </div>

            {customConfigPaths.length > 0 && (
              <div className="vps-custom-sources" aria-label="Additional SSH config files">
                {customConfigPaths.map((path) => (
                  <div className="vps-custom-source" key={path} title={path}>
                    <Icon name="doc" size={13} />
                    <span>{fileName(path)}</span>
                    <span className="muted vps-source-path">{path}</span>
                    <button
                      type="button"
                      className="plain-icon-btn plain-icon-btn-compact"
                      aria-label={`Remove SSH config ${fileName(path)}`}
                      title="Remove custom SSH config"
                      disabled={mutatingConfig}
                      onClick={() => void removeConfig(path)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <div className="vps-panel-state" aria-live="polite" aria-atomic="true">
                <Spinner size={16} /> Scanning SSH configs…
              </div>
            ) : filteredHosts.length ? (
              <div className="vps-host-list" role="group" aria-label="SSH hosts">
                {filteredHosts.map((host) => {
                  const selected = hostKey(host) === selectedHostKey;
                  const source = host.sourcePath && host.sourcePath !== host.configPath
                    ? host.sourcePath
                    : host.configPath;
                  return (
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-describedby={selected && commandPreview.error ? "vps-command-error" : undefined}
                      className={`vps-host-row${selected ? " selected" : ""}`}
                      key={hostKey(host)}
                      onClick={() => setSelectedHostKey(hostKey(host))}
                    >
                      <span className="vps-host-icon"><Icon name="terminal" size={14} /></span>
                      <span className="vps-host-copy">
                        <span className="vps-host-title">
                          <strong>{host.alias}</strong>
                          <span className="muted">{resolvedTarget(host)}</span>
                        </span>
                        <span className="vps-host-meta" title={source}>
                          {fileName(host.configPath)}
                          {host.sourcePath && host.sourcePath !== host.configPath && ` · included from ${fileName(host.sourcePath)}`}
                          {host.identityFile && ` · ${fileName(host.identityFile)} configured`}
                        </span>
                      </span>
                      {selected && <Icon name="checkmark.circle.fill" size={15} className="ok" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="vps-panel-state" role="status" aria-live="polite">
                <Icon name="folder" size={18} />
                <span>{hosts.length ? "No SSH hosts match this search." : "No concrete hosts found in your SSH configs."}</span>
                {!hosts.length && (
                  <button type="button" className="mini" onClick={() => setMode("manual")}>Enter connection manually</button>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="vps-manual-panel" aria-label="Manual SSH connection">
            <div className="vps-manual-grid">
              <label className="modal-field vps-host-field">
                <span>Host</span>
                <input
                  value={manualHost}
                  onChange={(event) => setManualHost(event.target.value)}
                  placeholder="vps.example.com"
                  data-vps-autofocus="manual"
                  aria-invalid={!!commandPreview.error && commandPreview.error.startsWith("SSH host")}
                  aria-describedby={commandPreview.error ? "vps-command-error" : undefined}
                  required
                />
              </label>
              <label className="modal-field">
                <span>User (optional)</span>
                <input
                  value={manualUser}
                  onChange={(event) => setManualUser(event.target.value)}
                  placeholder="root"
                  aria-invalid={!!commandPreview.error && commandPreview.error.startsWith("SSH user")}
                  aria-describedby={commandPreview.error ? "vps-command-error" : undefined}
                />
              </label>
              <label className="modal-field">
                <span>Port</span>
                <input
                  value={manualPort}
                  onChange={(event) => setManualPort(event.target.value)}
                  inputMode="numeric"
                  aria-invalid={!manualPortValid}
                  aria-describedby={!manualPortValid ? "vps-port-error" : undefined}
                  required
                />
              </label>
              <label className="modal-field vps-identity-field">
                <span>Identity file (optional)</span>
                <input
                  value={manualIdentityFile}
                  onChange={(event) => setManualIdentityFile(event.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                  aria-invalid={!!commandPreview.error && commandPreview.error.startsWith("SSH identity file")}
                  aria-describedby={commandPreview.error ? "vps-command-error" : undefined}
                />
              </label>
            </div>
            {!manualPortValid && <div className="error small" id="vps-port-error">Port must be a number from 1 to 65535.</div>}
            <p className="muted small vps-password-note">Passwords are never stored. Use your SSH agent or an identity file.</p>
          </section>
        )}

        <label className="modal-field vps-task-field">
          <span>Task (optional)</span>
          <textarea
            rows={3}
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="What should the agent do with Clawbrowser on this VPS?"
          />
        </label>

        <section className={`vps-command-preview${commandPreview.error ? " is-error" : ""}`} aria-label="SSH command preview">
          <div>
            <Icon name="terminal" size={13} />
            <span>SSH command</span>
          </div>
          <code id={commandPreview.error ? "vps-command-error" : undefined} role={commandPreview.error ? "alert" : undefined}>
            {commandPreview.text}
          </code>
        </section>

          <div className="vps-safety-note">
            <Icon name="checkmark.shield.fill" size={15} />
            <span>The prompt keeps Clawbrowser and nextctl on the VPS. Only safe host fields are imported; the source config is not passed to ssh and configured identity-file contents are not read or sent.</span>
          </div>
        </fieldset>

        {warning && <div className="small vps-warning" role="status">{warning}</div>}
        {scanWarning && <div className="small vps-warning" role="status">{scanWarning}</div>}
        {error && (
          <div className="error small vps-error" role="alert">
            <UserFacingError message={error} surface="vps_setup" />
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={submitting || mutatingConfig} onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="primary"
            disabled={!connection || !commandPreview.valid || submitting || mutatingConfig || (mode === "hosts" && loading)}
          >
            {submitting ? <Spinner size={14} /> : <Icon name="arrow.up.circle.fill" size={14} />}
            {submitting ? "Starting…" : "Start in chat"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
