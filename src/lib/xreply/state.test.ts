import { describe, expect, it } from "vitest";
import { emptyXReplyState, normalizeXReplyState } from "./state";

const draft = {
  id: "d1", handle: "author", postId: "20",
  postUrl: "https://x.com/author/status/20", postText: "post", replyText: "reply",
  createdAt: 1,
};

describe("reading a state file written by an older build", () => {
  it("sends a draft that was left waiting for an approval nobody asks for now", () => {
    const state = normalizeXReplyState({
      ...emptyXReplyState(),
      autoSend: false,
      drafts: [{ ...draft, status: "pending" }],
    });
    expect(state.drafts[0].status).toBe("approved");
  });

  it("leaves a draft the user had already refused where it is", () => {
    const state = normalizeXReplyState({
      ...emptyXReplyState(),
      drafts: [{ ...draft, status: "rejected" }, { ...draft, id: "d2", status: "sent" }],
    });
    expect(state.drafts.map((item) => item.status)).toEqual(["rejected", "sent"]);
  });
});

describe("settings that no longer exist", () => {
  it("drops the old auto-send key instead of carrying it forward", () => {
    const state = normalizeXReplyState({ ...emptyXReplyState(), autoSend: false, hourlyMax: 7 });
    expect("autoSend" in state).toBe(false);
    expect(state.hourlyMax).toBe(7);
  });
});
