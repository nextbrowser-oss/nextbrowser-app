import { useCallback, useEffect, useState } from "react";
import { BUILTIN_AGENT_ID } from "../agents";
import { invoke } from "../electronBridge";
import { trackEvent } from "../lib/analytics";
import {
  BUILTIN_PROVIDERS,
  DEFAULT_BUILTIN_PROVIDER,
  builtinAgentSettings,
  builtinProvider,
  type BuiltinAgentStatus,
  type BuiltinModelList,
  type BuiltinModelOption,
  type BuiltinProviderId,
  type BuiltinTestResult,
} from "../lib/builtinAgent";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") || "Something went wrong. Try again.";
}

const TEST_LABELS: Record<BuiltinTestResult["key"] | BuiltinTestResult["tools"], string> = {
  ok: "works",
  failed: "rejected",
  no: "not supported",
  unknown: "not checked",
};

function modelLabel(model: BuiltinModelOption): string {
  return `${model.id}${model.vision ? " · sees screenshots" : ""}`;
}

/**
 * Setup of the built-in Nextbrowser agent: a provider, its API key, a model,
 * and a Test that proves the key and tool calling before the first task. The
 * key goes to the main process on Save and never comes back; the field is
 * cleared as soon as it is saved.
 */
export function BuiltinAgentSetup({ onReady }: { onReady?: () => void }) {
  const agentId = useStore((s) => s.agentId);
  const switchAgent = useStore((s) => s.switchAgent);
  const refreshBuiltinAgent = useStore((s) => s.refreshBuiltinAgent);
  const [status, setStatus] = useState<BuiltinAgentStatus>();
  const [provider, setProvider] = useState<BuiltinProviderId>(DEFAULT_BUILTIN_PROVIDER);
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [models, setModels] = useState<BuiltinModelOption[]>([]);
  const [modelsNote, setModelsNote] = useState<string>();
  const [busy, setBusy] = useState<"key" | "models" | "test" | "save">();
  const [test, setTest] = useState<BuiltinTestResult>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const preset = builtinProvider(provider);
  const keySaved = !!status?.keys[provider];
  const keyReady = keySaved || !preset.keyRequired;
  const baseURLReady = provider !== "custom" || !!baseURL.trim();

  const loadModels = useCallback(async (target: BuiltinProviderId, targetURL: string, current: string) => {
    setBusy("models");
    setModelsNote(undefined);
    try {
      const list = await invoke<BuiltinModelList>("builtin_agent_models", { provider: target, baseURL: targetURL });
      setModels(list.models);
      if (list.error) setModelsNote(`${list.error} You can still type a model ID.`);
      const keep = current && (list.models.some((item) => item.id === current) || !list.models.length);
      setModel(keep ? current : list.defaultModel || list.models[0]?.id || "");
    } catch (failure) {
      setModels([]);
      setModelsNote(errorText(failure));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void invoke<BuiltinAgentStatus>("builtin_agent_status").then((next) => {
      if (!active) return;
      const settings = builtinAgentSettings(next);
      setStatus(next);
      setProvider(settings.provider);
      setBaseURL(settings.baseURL);
      setModel(settings.model);
      const hasKey = !!next.keys[settings.provider] || !builtinProvider(settings.provider).keyRequired;
      if (hasKey && (settings.provider !== "custom" || settings.baseURL)) void loadModels(settings.provider, settings.baseURL, settings.model);
    }).catch((failure) => { if (active) setError(errorText(failure)); });
    return () => { active = false; };
  }, [loadModels]);

  const chooseProvider = (next: BuiltinProviderId) => {
    if (next === provider) return;
    trackEvent("builtin_agent_provider_selected", { provider: next });
    setProvider(next);
    setModels([]);
    setModelsNote(undefined);
    setTest(undefined);
    setError(undefined);
    setSaved(false);
    setKeyDraft("");
    setReplacingKey(false);
    const sameAsSaved = status?.settings.provider === next;
    const nextModel = sameAsSaved ? status?.settings.model ?? "" : "";
    setModel(nextModel);
    if ((status?.keys[next] || !builtinProvider(next).keyRequired) && (next !== "custom" || baseURL.trim())) {
      void loadModels(next, baseURL, nextModel);
    }
  };

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setBusy("key");
    setError(undefined);
    setTest(undefined);
    try {
      const next = await invoke<BuiltinAgentStatus>("builtin_agent_key_save", { provider, key: keyDraft });
      setKeyDraft("");
      setReplacingKey(false);
      setStatus(next);
      trackEvent("builtin_agent_key_saved", { provider });
      setBusy(undefined);
      if (baseURLReady) await loadModels(provider, baseURL, model);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(undefined);
    }
  };

  const removeKey = async () => {
    setBusy("key");
    setError(undefined);
    try {
      setStatus(await invoke<BuiltinAgentStatus>("builtin_agent_key_clear", { provider }));
      setModels([]);
      setTest(undefined);
      trackEvent("builtin_agent_key_removed", { provider });
      await refreshBuiltinAgent();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setError(undefined);
    setTest(undefined);
    try {
      const result = await invoke<BuiltinTestResult>("builtin_agent_test", { provider, baseURL, model });
      setTest(result);
      trackEvent("builtin_agent_tested", { provider, ok: result.ok, key: result.key, tools: result.tools, code: result.code ?? "" });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(undefined);
    try {
      const next = await invoke<BuiltinAgentStatus>("builtin_agent_settings_save", { provider, baseURL, model });
      setStatus(next);
      setSaved(true);
      trackEvent("builtin_agent_saved", { provider, configured: next.configured });
      if (agentId !== BUILTIN_AGENT_ID) switchAgent(BUILTIN_AGENT_ID);
      await refreshBuiltinAgent();
      if (next.configured) onReady?.();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="builtin-agent-setup">
      <div className="builtin-agent-providers" role="radiogroup" aria-label="Model provider">
        {BUILTIN_PROVIDERS.map((item) => (
          <button
            type="button"
            role="radio"
            aria-checked={item.id === provider}
            key={item.id}
            className={"builtin-agent-provider" + (item.id === provider ? " is-selected" : "")}
            onClick={() => chooseProvider(item.id)}
          >
            <span className="builtin-agent-provider-head">
              <strong>{item.name}</strong>
              {item.id === DEFAULT_BUILTIN_PROVIDER && <span className="experimental-pill">Free</span>}
              {status?.keys[item.id] && <Icon name="checkmark.circle.fill" size={14} className="ok" />}
            </span>
            <span className="muted small">{item.limits}</span>
          </button>
        ))}
      </div>
      <p className="muted small builtin-agent-data-use">
        Your tasks and the page text the agent reads are sent to {provider === "custom" ? "the provider you enter" : preset.name}. {preset.dataUse}
      </p>

      {provider === "custom" && (
        <label className="modal-field">
          <span>Base URL</span>
          <input
            value={baseURL}
            placeholder="http://localhost:11434/v1"
            spellCheck={false}
            onChange={(event) => { setBaseURL(event.target.value); setModels([]); setTest(undefined); setSaved(false); }}
            onBlur={() => { if (baseURL.trim() && keyReady) void loadModels(provider, baseURL, model); }}
          />
        </label>
      )}

      <div className="modal-field">
        <span className="modal-field-heading">
          <span>{preset.keyRequired ? "API key" : "API key (optional)"}</span>
          {preset.keyURL && (
            <a href={preset.keyURL} target="_blank" rel="noreferrer" onClick={() => trackEvent("builtin_agent_key_link_opened", { provider })}>
              Get a free key <Icon name="arrow.up.forward.app" size={11} />
            </a>
          )}
        </span>
        {keySaved && !replacingKey ? (
          <div className="builtin-agent-key-saved">
            <Icon name="lock.fill" size={12} />
            <span className="muted small">Key saved, encrypted on this computer.</span>
            <button type="button" className="mini" disabled={!!busy} onClick={() => setReplacingKey(true)}>Replace</button>
            <button type="button" className="mini" disabled={!!busy} onClick={() => void removeKey()}>Remove</button>
          </div>
        ) : (
          <form className="builtin-agent-key-row" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`${preset.name} API key`}
              value={keyDraft}
              placeholder={preset.keyRequired ? "Paste your key" : "Only if your server needs one"}
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <button type="submit" className="mini primary-mini" disabled={!keyDraft.trim() || !!busy}>
              {busy === "key" ? <Spinner size={11} /> : null} Save key
            </button>
          </form>
        )}
        {status && !status.secureStorage && (
          <span className="warn small">Secure key storage is unavailable on this computer, so a key cannot be saved.</span>
        )}
      </div>

      <label className="modal-field">
        <span className="modal-field-heading">
          <span>Model</span>
          <button
            type="button"
            className="plain-icon-btn plain-icon-btn-compact"
            title="Reload the provider's models"
            aria-label="Reload the provider's models"
            disabled={!keyReady || !baseURLReady || !!busy}
            onClick={() => void loadModels(provider, baseURL, model)}
          >
            {busy === "models" ? <Spinner size={11} /> : <Icon name="arrow.clockwise" size={11} />}
          </button>
        </span>
        {models.length ? (
          <select value={model} onChange={(event) => { setModel(event.target.value); setTest(undefined); setSaved(false); }}>
            {!models.some((item) => item.id === model) && model && <option value={model}>{model}</option>}
            {models.map((item) => <option key={item.id} value={item.id}>{modelLabel(item)}</option>)}
          </select>
        ) : (
          <input
            value={model}
            spellCheck={false}
            placeholder={keyReady ? "Model ID, such as llama3.1" : "Save a key to load the models"}
            onChange={(event) => { setModel(event.target.value); setTest(undefined); setSaved(false); }}
          />
        )}
        {modelsNote && <small className="muted">{modelsNote}</small>}
      </label>

      <div className="builtin-agent-actions">
        <button type="button" className="mini" disabled={!keyReady || !baseURLReady || !model.trim() || !!busy} onClick={() => void runTest()}>
          {busy === "test" ? <Spinner size={11} /> : <Icon name="checkmark.seal.fill" size={12} />} Test
        </button>
        <button type="button" className="mini primary-mini" disabled={!keyReady || !baseURLReady || !model.trim() || !!busy} onClick={() => void save()}>
          {busy === "save" ? <Spinner size={11} /> : null} Use this model
        </button>
        {saved && status?.configured && <span className="ok small" role="status">Saved. The Nextbrowser agent is ready.</span>}
      </div>

      {test && (
        <div className={(test.ok && test.tools === "ok" ? "ok" : test.ok ? "warn" : "error") + " small builtin-agent-test"} role="status">
          <span>Key: {TEST_LABELS[test.key]} · Tool calling: {TEST_LABELS[test.tools]}</span>
          <span>{test.message}</span>
        </div>
      )}
      {error && <div className="error small" role="alert">{error}</div>}
    </div>
  );
}
