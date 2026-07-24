import { describe, expect, it } from "vitest";
import { sequentialProgress } from "./sequentialProgress";

describe("sequential progress", () => {
  it.each([
    [[false, true, true, true], 0, ["current", "locked", "locked", "locked"]],
    [[true, false, true, true], 1, ["complete", "current", "locked", "locked"]],
    [[true, true, false, true], 2, ["complete", "complete", "current", "locked"]],
    [[true, true, true, false], 3, ["complete", "complete", "complete", "current"]],
    [[true, true, true, true], -1, ["complete", "complete", "complete", "complete"]],
  ] as const)(
    "keeps later steps locked for readiness %j",
    (ready, currentIndex, states) => {
      expect(sequentialProgress(ready)).toEqual({ currentIndex, states });
    },
  );
});
