export type SequentialStepState = "complete" | "current" | "locked";

export function sequentialProgress(ready: readonly boolean[]): {
  currentIndex: number;
  states: SequentialStepState[];
} {
  const currentIndex = ready.findIndex((value) => !value);
  return {
    currentIndex,
    states: ready.map((_, index) => {
      if (currentIndex === -1 || index < currentIndex) return "complete";
      if (index === currentIndex) return "current";
      return "locked";
    }),
  };
}
