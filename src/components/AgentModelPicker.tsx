import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, isBuiltinAgent } from "../agents";
import { invoke } from "../electronBridge";
import { DEFAULT_BUILTIN_PROVIDER, BUILTIN_PROVIDERS, builtinAgentSettings, builtinProvider, freeOpenRouterOptions, type BuiltinAgentStatus, type BuiltinModelList, type BuiltinModelOption, type BuiltinProviderId } from "../lib/builtinAgent";
import { Dialog, Glyph, IconButton, Popover, Select } from "../shared/ui";
import { BuiltinAgentSetup } from "./BuiltinAgentSetup";
import "./agent-model-picker.css";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/** Composer entry point to the same encrypted keys and API settings as Agent settings. */
export function AgentModelPicker({ agentId, version, disabled, onActivate, onRefresh }: {
  agentId: string; version?: string; disabled?: boolean; onActivate: () => void; onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<BuiltinProviderId>();
  const [status, setStatus] = useState<BuiltinAgentStatus>();
  const [provider, setProvider] = useState<BuiltinProviderId>(DEFAULT_BUILTIN_PROVIDER);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<BuiltinModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const changeOpen = useCallback((value: boolean) => { if (!saving) setOpen(value); }, [saving]);
  const [error, setError] = useState<string>();
  const [modelsNote, setModelsNote] = useState<string>();
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const preset = builtinProvider(provider);
  const baseURL = provider === "custom" ? status?.settings.baseURL ?? "" : "";
  const keyReady = !!status && (provider === "nvidia" || !preset.keyRequired || !!status.keys[provider]);
  const canChoose = keyReady && (provider !== "custom" || !!baseURL);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setStatus(undefined); setError(undefined); setModels([]); setModel("");
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
      const offered = list.models.filter(item => item.tools !== false && (provider !== "openrouter" || item.free));
      setModels(offered);
      setModel(current => {
        if (current && (provider !== "openrouter" || list.error || offered.some(item => item.id === current))) return current;
        if (provider === "openrouter") return offered.find(item => item.id === list.defaultModel)?.id || offered[0]?.id || "";
        return list.defaultModel || offered[0]?.id || "";
      });
      setModelsNote(list.error);
    }).catch(failure => { if (active) setModelsNote(message(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, provider, baseURL, canChoose, catalogAttempt]);

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
  const freeModels = freeOpenRouterOptions(models);
  const managedNvidia = provider === "nvidia" && !status?.keys.nvidia;
  const modelFields = <>
    <div className="agent-model-picker-field"><span>Model</span>
      <Select overlay label="Provider model" searchPlaceholder="Search provider models" value={model}
        options={models.map(item => ({ value: item.id, label: item.id, description: item.free ? "Free" : undefined }))}
        disabled={!canChoose || loading || saving} onChange={setModel} />
      {loading && <div role="status">Loading models…</div>}
      {!loading && canChoose && !models.length && <div>{managedNvidia ? "NVIDIA model list is unavailable." : "No models available. Enter a model ID below."}</div>}
    </div>
    {!managedNvidia && <label className="agent-model-picker-field">Model ID
      <input aria-label="Agent model ID" value={model} spellCheck={false} disabled={!status || saving} onChange={event => setModel(event.target.value)} placeholder="Model ID" />
    </label>}
  </>;
  return <>
    <Popover label="Agent provider and model" open={open && !disabled} onOpenChange={changeOpen} side="top" align="start"
      className="agent-model-picker shared-scrollbarless"
      trigger={props => <IconButton {...props} label="Choose agent provider and model" hint={disabled ? "Stop the agent to change its model. API providers run locally." : label}
        appearance="embedded" size="small" className="agent-model-picker-trigger" text={label} disabled={disabled}>
        <Glyph name="sparkles" size={14} />
      </IconButton>}>
      <div className="agent-model-picker-heading"><strong>Provider & model</strong><span>Nextbrowser agent</span></div>
      <div className="agent-model-picker-field"><span>Provider</span>
        <Select overlay label="Agent provider" autoFocus value={provider} disabled={!status || saving} onChange={value => {
          const next = value as BuiltinProviderId;
          setProvider(next); setModel(next === status?.settings.provider ? status.settings.model ?? "" : ""); setError(undefined);
        }} options={BUILTIN_PROVIDERS.map(item => ({ value: item.id, label: item.name }))} />
      </div>
      {status && !canChoose ? <div className="agent-model-picker-note">{keyReady ? "Add a base URL in provider settings." : `Add your ${preset.name} API key to choose a model.`}</div> : provider === "openrouter" ? <>
        <div className="agent-model-picker-field">
          <span>Free model</span>
          <Select overlay label="Free OpenRouter model" searchPlaceholder="Search free models…" value={model}
            options={freeModels} onChange={setModel} disabled={!canChoose || loading || saving || !freeModels.length} />
          {loading && <div role="status">Loading free models…</div>}
        </div>
      </> : modelFields}
      {modelsNote && <div className="agent-model-picker-note" role="status">{modelsNote}</div>}
      <p className="agent-model-picker-note">{isBuiltinAgent(agentId) ? "Applies to your Nextbrowser agent chats." : "Uses the API agent. Your current chat is kept; a new session opens if it has messages."}{provider === "nvidia" && !status?.keys.nvidia ? " NVIDIA is included with your Nextbrowser account." : provider !== "openrouter" && " Paid models use your provider balance."}</p>
      {error && <div className="agent-model-picker-note" role="alert">{error}</div>}
      <div className="agent-model-picker-actions">
        {provider === "openrouter" && modelsNote && <button type="button" disabled={loading || saving} onClick={() => setCatalogAttempt(attempt => attempt + 1)}>Retry model list</button>}
        <button type="button" disabled={!status || saving} onClick={() => { setOpen(false); setSetup(provider); }}>Provider settings</button>
        <button type="button" disabled={!canChoose || !model.trim() || saving || disabled || (provider === "openrouter" && !freeModels.some(item => item.value === model))} onClick={() => void activate()}>{saving ? "Saving…" : "Use model"}</button>
      </div>
    </Popover>
    {setup && <Dialog title="Agent provider settings" onClose={() => setSetup(undefined)} className="agent-model-setup">
      <BuiltinAgentSetup initialProvider={setup} activateOnSave={false} onReady={() => { onActivate(); setSetup(undefined); }} />
    </Dialog>}
  </>;
}
