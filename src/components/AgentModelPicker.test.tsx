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
const saved = (): BuiltinAgentStatus => ({ settings: { provider: "nvidia", model: "nemotron" }, keys: { nvidia: true, openrouter: true, deepseek: true }, secureStorage: true, configured: true, problem: "" });
const activate = vi.fn(), refresh = vi.fn(async () => {});
const mount = (disabled = false) => render(<TooltipProvider><AgentModelPicker agentId="codex" disabled={disabled} onActivate={activate} onRefresh={refresh} /></TooltipProvider>);
const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Choose agent provider and model" })); await waitFor(() => expect(screen.getByLabelText("Agent provider").hasAttribute("disabled")).toBe(false)); };
const choose = (name: string) => { fireEvent.click(screen.getByRole("combobox", { name: "Agent provider" })); fireEvent.click(screen.getByRole("option", { name })); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "builtin_agent_status") return saved();
    if (command === "builtin_agent_models") return { models: [{ id: args?.provider === "openrouter" ? "anthropic/claude-paid" : "nemotron" }], defaultModel: "nemotron" };
    if (command === "builtin_agent_settings_save") return { ...saved(), settings: args };
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(cleanup);
it("loads real model options and saves a paid OpenRouter selection before activating the API agent", async () => {
  mount(); await open();
  choose("OpenRouter");
  fireEvent.change(screen.getByLabelText("Search provider models"), { target: { value: "claude" } });
  fireEvent.click(await screen.findByRole("button", { name: "anthropic/claude-paid" }));
  fireEvent.click(screen.getByRole("button", { name: "Use model" }));
  await waitFor(() => expect(activate).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith("builtin_agent_settings_save", { provider: "openrouter", baseURL: "", model: "anthropic/claude-paid" });
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
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
