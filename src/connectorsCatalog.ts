import type { AppTab } from "./types";

export const CONNECTORS = [
  { id: "multilogin", label: "Multilogin" },
] as const;

export type ConnectorId = (typeof CONNECTORS)[number]["id"];

export const CONNECTOR_PROMPT_RESUMED_EVENT = "nextbrowser:connector-prompt-resumed";

/// A flow that needs a connector before it can finish sends the person to the
/// Connectors page and records where to hand them back afterwards.
export interface ConnectorPrompt {
  id: ConnectorId;
  returnTab?: AppTab;
  resume?: "profile-create";
}
