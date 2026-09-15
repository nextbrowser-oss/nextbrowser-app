export type SequentialStepState = "complete" | "current" | "locked";

export function sequentialProgress(ready: readonly boolean[]): {
  currentIndex: number;
  states: SequentialStepState[];
} {
  const currentIndex = ready.findIndex((value) => !value);
  return {
    currentIndex,
    // A step the user has already satisfied stays "complete" even when an
    // earlier one is still open — telling someone with a dozen chats to
    // "complete step 3 first" is simply wrong.
    states: ready.map((value, index) => {
      if (value) return "complete";
      if (index === currentIndex) return "current";
      return "locked";
    }),
  };
}
