import { describe, expect, it } from "vitest";
import { mergeSessionName, namedSession, SessionTitleHeader } from "./sessionTitle";
import type { Conversation } from "../types";

it("keeps manual names across remote message updates and accepts a later manual edit", () => {
  const root: Conversation = { id: "root", title: "Research project", agent: "codex", messages: [], createdAt: 1, updatedAt: 1 };
  const generated = namedSession(root, "Model title");
  const manual = { ...namedSession(root, "Custom title"), sessionTitleEditedAt: 10 };
  expect(mergeSessionName(root, manual)).toMatchObject({ title: root.title, sessionTitle: "Custom title" });
  expect(mergeSessionName(manual, generated)).toEqual(manual);
  expect(mergeSessionName(generated, manual)).toEqual(manual);
  const newer = { ...manual, sessionTitle: "Updated name", sessionTitleEditedAt: 12 };
  expect(mergeSessionName(manual, newer)).toEqual(newer);
});

describe("session metadata in CLI replies", () => {
  it("separates even a character-at-a-time title from the visible answer", () => {
    const buffer = new SessionTitleHeader();
    const text = "  [[session-title: Ночные поезда]]\r\nОтвет\nна вопрос";
    expect([...text].map(c => buffer.read(c)).join("") + buffer.read("", true)).toBe("Ответ\nна вопрос");
    expect(buffer.title).toBe("Ночные поезда");
  });
  it.each(["An ordinary answer", "[[unrelated: example]]\nAnswer", "[[session-title:", ""])("preserves a reply without a title (%s)", answer => {
    const buffer = new SessionTitleHeader();
    expect(buffer.read(answer) + buffer.read("", true)).toBe(answer);
    expect(buffer.title).toBeUndefined();
  });
});
