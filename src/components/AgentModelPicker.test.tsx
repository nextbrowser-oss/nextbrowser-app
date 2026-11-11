// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentModelPicker } from "./AgentModelPicker";
import { invoke } from "../electronBridge";
import { TooltipProvider } from "../shared/ui";
import type { BuiltinAgentStatus } from "../lib/builtinAgent";

const state = vi.hoisted(() => ({ agentId: "codex", switchAgent: vi.fn(), refreshBuiltinAgent: vi.fn(async () => {}) }));
vi.mock("../store", () => ({ useStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));
const saved = (): BuiltinAgentStatus => ({ settings: { provider: "nvidia", model: "nemotron" }, keys: { nvidia: true, deepseek: true }, secureStorage: true, configured: true, problem: "" });
const activate = vi.fn(), refresh = vi.fn(async () => {});
const mount = (disabled = false) => render(<TooltipProvider><AgentModelPicker agentId="codex" disabled={disabled} onActivate={activate} onRefresh={refresh} /></TooltipProvider>);
const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Choose agent provider and model" })); await waitFor(() => expect(screen.getByLabelText("Agent provider").hasAttribute("disabled")).toBe(false)); };
const choose = (name: string) => { fireEvent.click(screen.getByRole("combobox", { name: "Agent provider" })); fireEvent.click(screen.getByRole("option", { name })); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "builtin_agent_status") return saved();
    if (command === "builtin_agent_models") return args?.provider === "openrouter" ? {
      models: [{ id: "openrouter/free", free: true }, { id: "nvidia/lightning:free", free: true }, { id: "anthropic/claude-paid" }],
      defaultModel: "openrouter/free",
    } : { models: [{ id: "nemotron" }], defaultModel: "nemotron" };
    if (command === "builtin_agent_settings_save") return { ...saved(), settings: args };
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(cleanup);
it("keeps manual model selection for providers with a personal key", async () => {
  mount(); await open();
  choose("DeepSeek");
  await screen.findByRole("button", { name: "nemotron" });
  fireEvent.change(screen.getByLabelText("Agent model ID"), { target: { value: "deepseek-flash" } });
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  await waitFor(() => expect(activate).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("builtin_agent_settings_save", { provider: "deepseek", baseURL: "", model: "deepseek-flash" });
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("filters the OpenRouter dropdown to free models and activates the searched choice", async () => {
  mount(); await open();
  choose("OpenRouter");
  const trigger = screen.getByRole("combobox", { name: "Free OpenRouter model" });
  await waitFor(() => expect(trigger.textContent).toContain("OpenRouter Free (auto)"));
  fireEvent.click(trigger);
  expect(screen.getAllByRole("option").map(option => option.textContent?.trim())).toEqual(["OpenRouter Free (auto)", "nvidia/lightning:free"]);
  const search = screen.getByRole("combobox", { name: "Search free models…" });
  fireEvent.change(search, { target: { value: "LIGHTNING" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(trigger.textContent).toContain("nvidia/lightning:free");
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  await waitFor(() => expect(activate).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("builtin_agent_settings_save", { provider: "openrouter", baseURL: "", model: "nvidia/lightning:free" });
});
it("proposes a replacement for a saved model missing from the OpenRouter catalog", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    ...saved(), settings: { provider: "openrouter", model: "thinkingmachines/inkling-2-small:free" },
  });
  mount(); await open();
  const trigger = await screen.findByRole("combobox", { name: "Free OpenRouter model" });
  await waitFor(() => expect(trigger.textContent).toContain("OpenRouter Free (auto)"));
  expect(invoke).not.toHaveBeenCalledWith("builtin_agent_settings_save", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("builtin_agent_settings_save", {
    provider: "openrouter", baseURL: "", model: "openrouter/free",
  }));
});
it("routes a provider without a key to the existing secure setup without changing the current agent", async () => {
  mount(); await open();
  choose("Anthropic");
  expect(screen.getByText("Add your Anthropic API key to choose a model.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Use model" }).hasAttribute("disabled")).toBe(true);
  expect(vi.mocked(invoke).mock.calls.some(([command, args]) => command === "builtin_agent_models" && args?.provider === "anthropic")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Provider settings" }));
  await screen.findByLabelText("Anthropic API key");
  expect(screen.getByRole("dialog", { name: "Agent provider settings" })).toBeTruthy();
  expect(activate).not.toHaveBeenCalled(); expect(state.switchAgent).not.toHaveBeenCalled();
});
it("ignores a slow model list from a previously selected provider", async () => {
  let finish!: (value: unknown) => void;
  const initial = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) => command === "builtin_agent_models" && args?.provider === "openrouter" ? new Promise(resolve => { finish = resolve; }) : initial(command, args));
  mount(); await open();
  choose("OpenRouter");
  choose("DeepSeek");
  await screen.findByRole("button", { name: "nemotron" });
  finish({ models: [{ id: "stale-openrouter-model" }], defaultModel: "stale-openrouter-model" });
  await waitFor(() => expect(screen.getByLabelText("Agent model ID").getAttribute("value")).toBe("nemotron"));
  expect(screen.queryByText("stale-openrouter-model")).toBeNull();
});
it("keeps failures visible without switching agents, and disables changes while busy", async () => {
  mount(); await open();
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Settings could not be saved"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Use model" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Settings could not be saved");
  expect(activate).not.toHaveBeenCalled();
  cleanup(); mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Choose agent provider and model" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
