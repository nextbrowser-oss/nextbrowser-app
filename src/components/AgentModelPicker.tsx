import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, isBuiltinAgent } from "../agents";
import { invoke } from "../electronBridge";
import { BUILTIN_PROVIDERS, builtinAgentSettings, builtinProvider, type BuiltinAgentStatus, type BuiltinModelList, type BuiltinModelOption, type BuiltinProviderId } from "../lib/builtinAgent";
import { Dialog, Glyph, IconButton, Popover } from "../shared/ui";
import { BuiltinAgentSetup } from "./BuiltinAgentSetup";
import "./agent-model-picker.css";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Composer entry point to the same encrypted keys and API settings as Agent settings. */
export function AgentModelPicker({ agentId, version, disabled, onActivate, onRefresh }: {
  agentId: string; version?: string; disabled?: boolean; onActivate: () => void; onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<BuiltinProviderId>();
  const [status, setStatus] = useState<BuiltinAgentStatus>();
  const [provider, setProvider] = useState<BuiltinProviderId>("nvidia");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<BuiltinModelOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const changeOpen = useCallback((value: boolean) => { if (!saving) setOpen(value); }, [saving]);
  const [error, setError] = useState<string>();
  const [modelsNote, setModelsNote] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const preset = builtinProvider(provider);
  const baseURL = provider === "custom" ? status?.settings.baseURL ?? "" : "";
  const keyReady = !!status && (!preset.keyRequired || !!status.keys[provider]);
  const canChoose = keyReady && (provider !== "custom" || !!baseURL);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setStatus(undefined); setError(undefined); setQuery(""); setModels([]); setModel("");
    void invoke<BuiltinAgentStatus>("builtin_agent_status").then(next => {
      if (!active) return;
      if (!next?.settings || !next.keys) throw new Error("Provider settings are unavailable. Try again.");
      setStatus(next);
      const saved = builtinAgentSettings(next);
      setProvider(saved.provider); setModel(saved.model);
    }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    setModels([]); setModelsNote(undefined);
    if (!open || !canChoose) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void invoke<BuiltinModelList>("builtin_agent_models", { provider, baseURL }).then(list => {
      if (!active) return;
      setModels(list.models.filter(item => item.tools !== false));
      setModel(current => current || list.defaultModel || list.models.find(item => item.tools !== false)?.id || "");
      setModelsNote(list.error);
    }).catch(failure => { if (active) setModelsNote(message(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, provider, baseURL, canChoose]);

  const activate = async () => {
    setSaving(true); setError(undefined);
    try {
      const next = await invoke<BuiltinAgentStatus>("builtin_agent_settings_save", { provider, baseURL, model });
      if (!mounted.current) return;
      if (!next?.configured) throw new Error(next?.problem || "Configure the provider before using this model.");
      setStatus(next);
      onActivate();
      await onRefresh();
      setOpen(false);
    } catch (failure) { setError(message(failure)); }
    finally { setSaving(false); }
  };
  const label = isBuiltinAgent(agentId) ? (version || "Choose model") : agentById(agentId).name;
  return <>
    <Popover label="Agent provider and model" open={open && !disabled} onOpenChange={changeOpen} side="top" align="start"
      className="agent-model-picker shared-scrollbarless"
      trigger={props => <IconButton {...props} label="Choose agent provider and model" hint={disabled ? "Stop the agent to change its model. API providers run locally." : label}
        appearance="embedded" size="small" className="agent-model-picker-trigger" text={label} disabled={disabled}>
        <Glyph name="sparkles" size={14} />
      </IconButton>}>
      <div className="agent-model-picker-heading"><strong>Provider & model</strong><span>Nextbrowser agent</span></div>
      <label className="agent-model-picker-field">Provider
        <select aria-label="Agent provider" data-autofocus value={provider} disabled={!status || saving} onChange={event => {
          const next = event.target.value as BuiltinProviderId;
          setProvider(next); setModel(next === status?.settings.provider ? status.settings.model ?? "" : ""); setQuery(""); setError(undefined);
        }}>{BUILTIN_PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </label>
      {status && !canChoose ? <div className="agent-model-picker-note">{keyReady ? "Add a base URL in provider settings." : `Add your ${preset.name} API key to choose a model.`}</div> : <>
        <label className="agent-model-picker-field">Find a model
          <input aria-label="Search provider models" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search models…" disabled={!status || saving} />
        </label>
        <div className="agent-model-picker-models shared-scrollbarless" aria-label="Provider models" aria-busy={loading}>
          {loading && <div role="status">Loading models…</div>}
          {!loading && models.filter(item => item.id.toLowerCase().includes(query.toLowerCase())).map(item => <button type="button" key={item.id}
            aria-pressed={model === item.id} disabled={saving} onClick={() => setModel(item.id)}>
            <span>{item.id}</span>{item.free && <small>Free</small>}
          </button>)}
          {!loading && !models.some(item => item.id.toLowerCase().includes(query.toLowerCase())) && <div>No matching models. Enter a model ID below.</div>}
        </div>
        <label className="agent-model-picker-field">Model ID
          <input aria-label="Agent model ID" value={model} spellCheck={false} disabled={!status || saving} onChange={event => setModel(event.target.value)} placeholder="Model ID" />
        </label>
      </>}
      {modelsNote && <div className="agent-model-picker-note" role="status">{modelsNote}</div>}
      <p className="agent-model-picker-note">{isBuiltinAgent(agentId) ? "Applies to your Nextbrowser agent chats." : "Uses the API agent. Your current chat is kept; a new session opens if it has messages."} Paid models use your provider balance.</p>
      {error && <div className="agent-model-picker-note" role="alert">{error}</div>}
      <div className="agent-model-picker-actions">
        <button type="button" disabled={!status || saving} onClick={() => { setOpen(false); setSetup(provider); }}>Provider settings</button>
        <button type="button" disabled={!canChoose || !model.trim() || saving || disabled} onClick={() => void activate()}>{saving ? "Saving…" : "Use model"}</button>
      </div>
    </Popover>
    {setup && <Dialog title="Agent provider settings" onClose={() => setSetup(undefined)} className="agent-model-setup">
      <BuiltinAgentSetup initialProvider={setup} activateOnSave={false} onReady={() => { onActivate(); setSetup(undefined); }} />
    </Dialog>}
  </>;
}
