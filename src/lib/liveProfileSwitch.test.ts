import { describe, expect, it } from "vitest";
import {
  createLiveStartTurns,
} from "./liveProfileSwitch";

describe("Live start turns", () => {
  it("keeps a replaced start's session closed before the next one opens", async () => {
    const takeTurn = createLiveStartTurns();
    const events: string[] = [];
    let generation = 0;
    let finishA!: (id: string) => void;
    const backend = (profile: string) => profile === "a"
      ? new Promise<string>((resolve) => { finishA = resolve; })
      : Promise.resolve(`session-${profile}`);
    const start = async (profile: string) => {
      const mine = ++generation;
      const turn = takeTurn();
      try {
        await turn.ready;
        if (mine !== generation) return;
        events.push(`open ${profile}`);
        const session = await backend(profile);
        if (mine !== generation) {
          events.push(`close ${session}`);
          return;
        }
        events.push(`live ${session}`);
      } finally {
        turn.done();
      }
    };

    const a = start("a");
    await Promise.resolve();
    // Fast switching: b is replaced by c before a's nextctl call returns.
    const b = start("b");
    const c = start("c");
    await Promise.resolve();
    expect(events).toEqual(["open a"]);

    finishA("session-a");
    await Promise.all([a, b, c]);
    expect(events).toEqual(["open a", "close session-a", "open c", "live session-c"]);
  });

  it("lets the next start go once the previous one is done", async () => {
    const takeTurn = createLiveStartTurns();
    const first = takeTurn();
    const second = takeTurn();
    let ready = false;
    void second.ready.then(() => { ready = true; });
    await first.ready;
    await Promise.resolve();
    expect(ready).toBe(false);
    first.done();
    first.done();
    await second.ready;
    expect(ready).toBe(true);
  });
});
