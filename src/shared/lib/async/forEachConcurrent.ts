/** Stop scheduling after the first failure, but settle active work before rejecting. */
export async function forEachConcurrent<T>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Concurrency must be a positive integer.');
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { await work(items[index], index); }
      catch (error) { if (!failed) firstError = error; failed = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw firstError;
}
