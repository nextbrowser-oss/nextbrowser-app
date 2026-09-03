import { describe, expect, it, vi } from "vitest";
import { clamp, draftInvocation, draftReply, formatPost, parseDraft, postedAt, systemPrompt } from "./draft";
import { moods } from "./reaction";

const request = {
  author: "author",
  text: "Shipped the new indexer today.",
  url: "https://x.com/author/status/1",
};

describe("the drafting prompt", () => {
  it("quarantines the post text and asks for one JSON object", () => {
    const prompt = systemPrompt(280, "Write like an engineer.");
    expect(prompt).toContain("untrusted quoted content");
    expect(prompt).toContain('{"reply":"the reply text","reaction":"agree"}');
    expect(prompt).toContain("agree, celebrate");
    expect(prompt).toContain("at most 280 characters");
    expect(prompt).toContain("Write like an engineer.");
  });

  it("names the weekday so a reply does not have to guess it", () => {
    expect(postedAt(Date.parse("2026-09-02T09:15:04Z"))).toBe("2026-09-02T09:15:04.000Z (Wednesday, UTC)");
    expect(postedAt(undefined)).toBe("unknown");
    expect(formatPost({ ...request, createdAt: Date.parse("2026-09-02T09:15:04Z") })).toContain("(Wednesday, UTC)");
  });

  it("leaves the model no way to decline a post, and no licence to invent", () => {
    const prompt = systemPrompt(280);
    expect(prompt).toContain("Every post gets a reply and there is no way to decline");
    expect(prompt).toContain("Never invent facts");
    // The old escape hatch is gone: a thin post is answered, not passed over.
    expect(prompt).not.toContain("SKIP");
  });

  it("runs Claude Code with its tools switched off and the prompt on stdin", () => {
    const invocation = draftInvocation("claude", "prompt");
    expect(invocation.args).toEqual([
      "-p", "--output-format", "text",
      "--strict-mcp-config", "--disallowed-tools", "Bash,Edit,Write,Read,WebFetch,WebSearch,NotebookEdit",
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

  it("fails the draft rather than posting a model that answered with nothing", () => {
    // No prompt offers this any more; a model that produces it wrote no reply,
    // and the post is retried instead of having the bare word posted.
    expect(() => parseDraft('{"reply":"SKIP"}', 280)).toThrow(/no reply text/);
  });

  it("clamps an overshooting draft on a word boundary", () => {
    const long = `${"word ".repeat(70)}end`;
    const clamped = clamp(long, 280);
    expect(clamped.length).toBeLessThanOrEqual(280);
    expect(clamped.endsWith("word")).toBe(true);
  });

  it("prefers the last whole sentence over a dangling half of one", () => {
    // What a real overshoot looks like: 295 characters ending mid-question.
    const overshoot = 'The tell will be when nobody writes "AI-powered" on the landing page anymore. '
      + 'Same thing happened with "cloud" and "mobile-first" — the label disappears once the capability is assumed. '
      + "What's the last workflow you touched where the intelligence was invisible enough that you forgot it was there?";
    const clamped = clamp(overshoot, 280);
    expect(clamped.length).toBeLessThanOrEqual(280);
    expect(clamped.endsWith("assumed.")).toBe(true);

    // A decimal point ends no sentence, so this still cuts on a word boundary.
    const version = `Shipped v1.2 today and ${"the same thing again ".repeat(20)}tail`;
    expect(clamp(version, 280).endsWith("v1.")).toBe(false);
    // Nothing to cut at all leaves a short reply alone.
    expect(clamp("Short one.", 280)).toBe("Short one.");
  });
});

describe("reaction moods", () => {
  it("maps a mood onto one curated search phrase and rejects anything else", () => {
    const agree = parseDraft('{"reply":"Yes.","reaction":"agree"}', 280, "https://x.com/a/status/1");
    expect(agree.reaction).toBe("agree");
    expect(["nodding in agreement", "exactly this nodding", "agreed handshake"]).toContain(agree.gifQuery);
    // The same post always resolves to the same phrase.
    expect(parseDraft('{"reply":"Yes.","reaction":"agree"}', 280, "https://x.com/a/status/1").gifQuery).toBe(agree.gifQuery);

    // An invented mood is not in the vocabulary, so the post decides instead.
    const invented = parseDraft('{"reply":"Yes.","reaction":"dancing pineapple"}', 280, "seed");
    expect(moods()).toContain(invented.reaction);
    expect(invented.gifQuery).toBeTruthy();
  });
});

describe("drafting one reply", () => {
  it("passes the post to the agent and returns its reply", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: '{"reply":"Tail latency is the tell."}', stderr: "" });
    const draft = await draftReply("claude", request, run);
    expect(draft.text).toBe("Tail latency is the tell.");
    // The model named no mood, so one came from the post — and a GIF with it.
    expect(moods()).toContain(draft.reaction);
    expect(draft.gifQuery).toBeTruthy();
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

describe("every reply carries a reaction GIF", () => {
  it("resolves a mood the model named", () => {
    const draft = parseDraft('{"reply":"a reply","reaction":"laughing"}', 280, "https://x.com/a/status/1");
    expect(draft.reaction).toBe("laughing");
    expect(draft.gifQuery).toBeTruthy();
  });

  it("falls back to a mood drawn from the post when the model names none", () => {
    for (const answer of ['{"reply":"a reply","reaction":"none"}', '{"reply":"a reply","reaction":"grumpy"}', '{"reply":"a reply"}']) {
      const draft = parseDraft(answer, 280, "https://x.com/a/status/1");
      expect(draft.reaction).not.toBe("none");
      expect(moods()).toContain(draft.reaction);
      expect(draft.gifQuery).toBeTruthy();
    }
  });

  it("keeps one post on one mood and spreads different posts across the vocabulary", () => {
    const bare = '{"reply":"a reply","reaction":"none"}';
    const seeds = Array.from({ length: 40 }, (_, index) => `https://x.com/a/status/${index}`);
    const first = seeds.map((seed) => parseDraft(bare, 280, seed).reaction);
    // Same post, same mood — a retry must not change the GIF that goes out.
    expect(seeds.map((seed) => parseDraft(bare, 280, seed).reaction)).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("offers the model no way to decline a reaction", () => {
    const prompt = systemPrompt(280);
    expect(prompt).not.toContain("none is the normal answer");
    expect(prompt).toContain("there is no way to decline one");
    for (const mood of moods()) expect(prompt).toContain(mood);
  });
});
