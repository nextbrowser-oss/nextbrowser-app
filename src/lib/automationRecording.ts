export type ActiveAutomationRecording = {
  id: string;
  workspaceId: string;
  agentId?: string;
  startedAt: number;
  phase: "recording";
  destination?: "recording" | "workflow";
  source?: "manual" | "hybrid" | "agent";
};

const STATE_KEY = "automationRecordingState";
export const AUTOMATION_RECORDING_EVENT = "nextbrowser:automation-recording-change";

export function activeAutomationRecording(): ActiveAutomationRecording | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (saved?.id && saved?.workspaceId && Number(saved?.startedAt)) return saved as ActiveAutomationRecording;
  } catch { /* fall through to legacy keys */ }
  const id = localStorage.getItem("automationRecordingId");
  const workspaceId = localStorage.getItem("automationRecordingWorkspaceId");
  const startedAt = Number(localStorage.getItem("automationRecordingSince") || 0);
  return id && workspaceId && startedAt ? { id, workspaceId, startedAt, phase: "recording" } : undefined;
}

export function setActiveAutomationRecording(recording: ActiveAutomationRecording) {
  localStorage.setItem(STATE_KEY, JSON.stringify(recording));
  localStorage.setItem("automationRecordingId", recording.id);
  localStorage.setItem("automationRecordingWorkspaceId", recording.workspaceId);
  localStorage.setItem("automationRecordingSince", String(recording.startedAt));
  window.dispatchEvent(new CustomEvent(AUTOMATION_RECORDING_EVENT, { detail: recording }));
}

export function clearActiveAutomationRecording() {
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem("automationRecordingId");
  localStorage.removeItem("automationRecordingWorkspaceId");
  localStorage.removeItem("automationRecordingSince");
  window.dispatchEvent(new CustomEvent(AUTOMATION_RECORDING_EVENT));
}
