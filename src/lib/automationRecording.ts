export type ActiveAutomationRecording = {
  id: string;
  workspaceId: string;
  agentId?: string;
  startedAt: number;
  phase: "recording";
  destination?: "recording" | "workflow";
  source?: "manual" | "hybrid" | "agent";
  profile?: string;
  runtime?: string;
};

const STATE_KEY = "automationRecordingState";
const SESSION_KEY = "automationRecordingSessionId";
export const AUTOMATION_RECORDING_EVENT = "nextbrowser:automation-recording-change";

function removeStoredRecording() {
  // Storage access can throw (private browsing, a blocked/missing store, or
  // — as this module now gets called from clearAccountEntityCache — a
  // headless/test environment without sessionStorage at all). A failed
  // best-effort cleanup must not take down the caller (logout()).
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem("automationRecordingId");
    localStorage.removeItem("automationRecordingWorkspaceId");
    localStorage.removeItem("automationRecordingSince");
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* best effort */ }
}

export function activeAutomationRecording(): ActiveAutomationRecording | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (saved?.id && saved?.workspaceId && Number(saved?.startedAt)) {
      // The browser tracer lives in Electron's main process and cannot survive
      // an app restart. Never resurrect a client-only "recording" indicator.
      if (sessionStorage.getItem(SESSION_KEY) !== saved.id) {
        removeStoredRecording();
        return undefined;
      }
      return saved as ActiveAutomationRecording;
    }
  } catch { /* fall through to legacy keys */ }
  const id = localStorage.getItem("automationRecordingId");
  const workspaceId = localStorage.getItem("automationRecordingWorkspaceId");
  const startedAt = Number(localStorage.getItem("automationRecordingSince") || 0);
  if (id && workspaceId && startedAt && sessionStorage.getItem(SESSION_KEY) === id) return { id, workspaceId, startedAt, phase: "recording" };
  if (id || workspaceId || startedAt) removeStoredRecording();
  return undefined;
}

export function setActiveAutomationRecording(recording: ActiveAutomationRecording) {
  localStorage.setItem(STATE_KEY, JSON.stringify(recording));
  localStorage.setItem("automationRecordingId", recording.id);
  localStorage.setItem("automationRecordingWorkspaceId", recording.workspaceId);
  localStorage.setItem("automationRecordingSince", String(recording.startedAt));
  sessionStorage.setItem(SESSION_KEY, recording.id);
  window.dispatchEvent(new CustomEvent(AUTOMATION_RECORDING_EVENT, { detail: recording }));
}

export function clearActiveAutomationRecording() {
  removeStoredRecording();
  try {
    window.dispatchEvent(new CustomEvent(AUTOMATION_RECORDING_EVENT));
  } catch { /* best effort — e.g. called from a non-DOM context */ }
}
