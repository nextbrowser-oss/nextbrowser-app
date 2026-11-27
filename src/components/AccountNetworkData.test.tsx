// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "../electronBridge";
import { AccountNetworkData } from "./AccountNetworkData";
import { AccountPreferences } from "./AccountPreferences";

vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
vi.mock("./PersonalProfiles", () => ({ PersonalProfiles: () => null }));
vi.mock("./AgentImport", () => ({ AgentImport: () => null }));

afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it("keeps the GitHub link on this device and scoped to its Nextbrowser account", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ status: "missing" }).mockResolvedValueOnce({ status: "connected", login: "fixture-user" });
  const onDevices = vi.fn();
  const view = render(<AccountNetworkData owner="first" onDevices={onDevices} />);
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByText(/Install GitHub CLI/);
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByText(/@fixture-user/);
  view.rerender(<AccountNetworkData owner="second" onDevices={onDevices} />);
  expect(screen.queryByText(/@fixture-user/)).toBeNull();
  view.rerender(<AccountNetworkData owner="first" onDevices={onDevices} />);
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(screen.queryByText(/@fixture-user/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View devices" }));
  expect(onDevices).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("opens account security for the requested action and offers provider recovery when unavailable", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  render(<AccountPreferences owner="owner" name="Example" email="fixture@example.test" />);
  fireEvent.click(screen.getByRole("button", { name: "Change sign-in email" }));
  expect(invoke).toHaveBeenCalledWith("account_manage_identity", { action: "email" });
  await vi.waitFor(() => expect((screen.getByRole("button", { name: "Reset password" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(invoke).toHaveBeenCalledWith("account_manage_identity", { action: "password" });
  fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
  expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://github.com/password_reset" });
});
