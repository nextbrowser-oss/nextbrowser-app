import { describe, expect, it } from "vitest";
import { sequentialProgress } from "./sequentialProgress";

describe("sequential progress", () => {
  it.each([
    [[false, false, false, false], 0, ["current", "locked", "locked", "locked"]],
    [[true, false, false, false], 1, ["complete", "current", "locked", "locked"]],
    [[true, true, false, false], 2, ["complete", "complete", "current", "locked"]],
    [[true, true, true, false], 3, ["complete", "complete", "complete", "current"]],
    [[true, true, true, true], -1, ["complete", "complete", "complete", "complete"]],
    // A step the user already finished is never presented as blocked by an
    // earlier one — that told people with existing chats to "complete step 3".
    [[true, true, false, true], 2, ["complete", "complete", "current", "complete"]],
    [[false, true, true, true], 0, ["current", "complete", "complete", "complete"]],
  ] as const)(
    "locks only unmet steps for readiness %j",
    (ready, currentIndex, states) => {
      expect(sequentialProgress(ready)).toEqual({ currentIndex, states });
    },
  );
});
