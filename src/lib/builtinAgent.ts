// The built-in Nextbrowser agent's setup, as the window sees it. The agent
// itself runs in the main process (electron/builtin-agent*.cjs), which also
// keeps its settings: the non-secret choice — provider, base URL, model — in
// the app settings file, and the API key encrypted in a file of its own. The
// key goes from the setup's field straight to the main process and comes back
// only as "a key is saved".

export type BuiltinProviderId = "nvidia" | "openrouter" | "gemini" | "custom";

export interface BuiltinProviderPreset {
  id: BuiltinProviderId;
  name: string;
  /** Empty for the custom provider, whose URL the user enters. */
  baseURL: string;
  keyURL?: string;
  keyRequired: boolean;
  /** One line: what is free and how much. */
  limits: string;
  /** One line: what the provider may do with what it receives. */
  dataUse: string;
}

// Base URLs mirror electron/builtin-agent-providers.cjs, which is what the
// main process actually calls; a node test keeps the two in step.
export const BUILTIN_PROVIDERS: readonly BuiltinProviderPreset[] = [
  {
    id: "nvidia",
    name: "NVIDIA",
    baseURL: "https://integrate.api.nvidia.com/v1",
    keyURL: "https://build.nvidia.com",
    keyRequired: true,
    limits: "Free key, about 40 requests a minute. Nemotron models call tools well.",
    dataUse: "NVIDIA offers its hosted models for development and testing.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    keyURL: "https://openrouter.ai/keys",
    keyRequired: true,
    limits: "Free models end in :free; openrouter/free picks one. About 50 requests a day on a free account.",
    dataUse: "Free models can come from providers that log or train on prompts.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyURL: "https://aistudio.google.com/apikey",
    keyRequired: true,
    limits: "Free tier of Gemini Flash, with daily limits.",
    dataUse: "On the free tier, Google may use your prompts to improve its products.",
  },
  {
    id: "custom",
    name: "Custom",
    baseURL: "",
    keyRequired: false,
    limits: "Any OpenAI-compatible API: Groq, Ollama (http://localhost:11434/v1), LM Studio, or a paid key.",
    dataUse: "The provider you enter decides what happens to your data; a local model keeps it on this computer.",
  },
];

export const DEFAULT_BUILTIN_PROVIDER: BuiltinProviderId = "nvidia";

export function builtinProvider(id: string | undefined): BuiltinProviderPreset {
  return BUILTIN_PROVIDERS.find((provider) => provider.id === id) ?? BUILTIN_PROVIDERS[0];
}

export interface BuiltinAgentSettings {
  provider: BuiltinProviderId;
  /** The custom provider's base URL; presets use their own. */
  baseURL: string;
  model: string;
}

/** The saved settings from a status, with the default provider when none is saved. */
export function builtinAgentSettings(status: Pick<BuiltinAgentStatus, "settings"> | undefined): BuiltinAgentSettings {
  const settings = status?.settings ?? {};
  return {
    provider: builtinProvider(settings.provider).id,
    baseURL: settings.baseURL ?? "",
    model: settings.model ?? "",
  };
}

/** What builtin_agent_status returns. */
export interface BuiltinAgentStatus {
  settings: { provider?: string; baseURL?: string; model?: string };
  /** Providers with a saved key. */
  keys: Record<string, boolean>;
  secureStorage: boolean;
  configured: boolean;
  /** Why the agent cannot run yet, when it cannot. */
  problem: string;
  providerName?: string;
  model?: string;
}

/** How a built-in agent run failed (electron/builtin-agent-run.cjs). */
export interface BuiltinAgentFailure {
  code: string;
  /** The user fixes it in Settings: a key, a limit, a model. */
  expected: boolean;
  status?: number;
  networkCode?: string;
}

export interface BuiltinModelOption {
  id: string;
  vision?: boolean;
  free?: boolean;
  tools?: boolean;
}

export interface BuiltinModelList {
  models: BuiltinModelOption[];
  defaultModel: string;
  error?: string;
  code?: string;
}

export interface BuiltinTestResult {
  ok: boolean;
  key: "ok" | "failed" | "unknown";
  tools: "ok" | "no" | "unknown";
  message: string;
  code?: string;
}

/** The agent runtime fields for a status: ready once set up, labelled with its provider and model. */
export function builtinAgentRuntime(status: BuiltinAgentStatus): { ready: boolean; version?: string; loggedIn: boolean | null; error?: string } {
  if (status.configured) {
    return {
      ready: true,
      version: [status.providerName, status.model].filter(Boolean).join(" · ") || "Nextbrowser agent",
      loggedIn: true,
      error: undefined,
    };
  }
  return {
    ready: false,
    version: undefined,
    loggedIn: null,
    error: `Set up the Nextbrowser agent in Settings → Agent.${status.problem ? ` ${status.problem}` : ""}`,
  };
}
