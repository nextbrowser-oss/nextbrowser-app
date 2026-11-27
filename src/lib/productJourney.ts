import { invoke } from "../electronBridge";

export function reportJourney(event: "login_succeeded" | "agent_action_succeeded"): void {
  // Main resolves the paired account key. Never pass identity or event params.
  void invoke("product_journey", { event }).catch(() => undefined);
}
