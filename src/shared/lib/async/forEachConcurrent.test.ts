import { expect, it } from 'vitest';
import { forEachConcurrent } from './index';

it('limits active work and processes every item once', async () => {
  let active = 0, peak = 0;
  const seen: number[] = [];
  await forEachConcurrent(Array.from({ length: 60 }, (_, i) => i), 3, async (item) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    seen.push(item); active--;
  });
  expect(peak).toBe(3);
  expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i));
});

it('stops scheduling after a failure and waits for active deletions before rejecting', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started: number[] = [];
  let settled = false;
  const error = new Error('removal failed');
  const result = forEachConcurrent([0, 1, 2, 3, 4], 2, async (item) => {
    started.push(item);
    if (item === 0) throw error;
    await pending;
  }).catch((reason) => { settled = true; return reason; });
  await Promise.resolve(); await Promise.resolve();
  expect(started).toEqual([0, 1]);
  expect(settled).toBe(false);
  release();
  expect(await result).toBe(error);
});
