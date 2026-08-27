import { describe, expect, it, vi } from "vitest";
import { SkippedPost, clamp, draftInvocation, draftReply, parseDraft, systemPrompt } from "./draft";

const request = {
  author: "author",
  text: "Shipped the new indexer today.",
  url: "https://x.com/author/status/1",
};

describe("the drafting prompt", () => {
  it("quarantines the post text and asks for one JSON object", () => {
    const prompt = systemPrompt(280, "Write like an engineer.");
    expect(prompt).toContain("untrusted quoted content");
    expect(prompt).toContain('{"reply":"the reply text","reaction":"none"}');
    expect(prompt).toContain("none, agree, celebrate");
    expect(prompt).toContain("at most 280 characters");
    expect(prompt).toContain("Write like an engineer.");
  });

  it("runs Claude Code with its tools switched off and the prompt on stdin", () => {
    const invocation = draftInvocation("claude", "prompt");
    expect(invocation.args).toEqual([
      "-p", "--output-format", "text",
      "--disallowed-tools", "Bash,Edit,Write,Read,WebFetch,WebSearch,NotebookEdit",
    ]);
    expect(invocation.stdin).toBe("prompt");
    // --disallowed-tools is variadic: a prompt in argv after it is parsed as a
    // list of tool names and the CLI exits without writing an answer.
    expect(invocation.args).not.toContain("prompt");
  });

  it("runs Codex read-only and hands it the prompt on stdin", () => {
    const invocation = draftInvocation("codex", "prompt");
    expect(invocation.args).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"]);
    expect(invocation.stdin).toBe("prompt");
  });
});

describe("reading the agent's answer", () => {
  it("takes the reply out of a session log wrapped around the JSON", () => {
    const output = `Reading the post…\n{"tool":"none"}\nHere it is:\n{"reply":"An indexer rewrite usually shows up in tail latency first."}\nDone.`;
    expect(parseDraft(output, 280).text).toBe("An indexer rewrite usually shows up in tail latency first.");
  });

  it("accepts a fenced JSON block and bare short text", () => {
    expect(parseDraft('```json\n{"reply":"Nice."}\n```', 280).text).toBe("Nice.");
    expect(parseDraft('"Bare text answer."', 280).text).toBe("Bare text answer.");
  });

  it("refuses to turn a long log without JSON into a reply", () => {
    const log = "step ".repeat(400);
    expect(() => parseDraft(log, 280)).toThrow(/no JSON reply/);
    expect(() => parseDraft("   ", 280)).toThrow(/returned nothing/);
  });

  it("reports the model's own decision to skip a post", () => {
    expect(() => parseDraft('{"reply":"SKIP"}', 280)).toThrow(SkippedPost);
  });

  it("clamps an overshooting draft on a word boundary", () => {
    const long = `${"word ".repeat(70)}end`;
    const clamped = clamp(long, 280);
    expect(clamped.length).toBeLessThanOrEqual(280);
    expect(clamped.endsWith("word")).toBe(true);
  });
});

describe("reaction moods", () => {
  it("maps a mood onto one curated search phrase and rejects anything else", () => {
    const agree = parseDraft('{"reply":"Yes.","reaction":"agree"}', 280, "https://x.com/a/status/1");
    expect(agree.reaction).toBe("agree");
    expect(["nodding in agreement", "exactly this nodding", "agreed handshake"]).toContain(agree.gifQuery);
    // The same post always resolves to the same phrase.
    expect(parseDraft('{"reply":"Yes.","reaction":"agree"}', 280, "https://x.com/a/status/1").gifQuery).toBe(agree.gifQuery);

    const invented = parseDraft('{"reply":"Yes.","reaction":"dancing pineapple"}', 280, "seed");
    expect(invented.reaction).toBe("none");
    expect(invented.gifQuery).toBe("");
  });
});

describe("drafting one reply", () => {
  it("passes the post to the agent and returns its reply", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: '{"reply":"Tail latency is the tell."}', stderr: "" });
    await expect(draftReply("claude", request, run)).resolves.toMatchObject({ text: "Tail latency is the tell.", reaction: "none", gifQuery: "" });
    const call = run.mock.calls[0][0];
    expect(call.binary).toBe("claude");
    expect(call.stdinText).toContain("Post author: @author");
    expect(call.stdinText).toContain("Shipped the new indexer today.");
  });

  it("surfaces a failed agent run instead of inventing a reply", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "not logged in" });
    await expect(draftReply("claude", request, run)).rejects.toThrow(/not logged in/);
  });
});
