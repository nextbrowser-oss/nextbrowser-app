const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimeline } = require('./account-activity-worker.cjs');

test('UTC intervals split at local midnight with a single visit and no duplicate milliseconds', () => {
  const sample = createTimeline(), midnight = new Date(2026,10,25).getTime();
  sample({owner:'a', at:midnight-4000, monotonic:0});
  sample({owner:'a', at:midnight, monotonic:4000});
  sample({owner:'a', at:midnight, monotonic:4000});
  const [[,log]]=sample({owner:null, at:midnight+7000, monotonic:11000});
  assert.deepEqual(log.days, {'2026-11-24':{ms:4000,sessions:1},'2026-11-25':{ms:7000,sessions:0}});
  assert.deepEqual(sample({owner:null, at:midnight+18000, monotonic:22000}),[]);
});
test('wall clock changes do not create or erase hours, and sleep gaps are excluded', () => {
  const sample=createTimeline(), start=new Date(2026,10,25,12).getTime();
  sample({owner:'a',at:start,monotonic:0});
  sample({owner:'a',at:start+3605000,monotonic:5000});
  sample({owner:'a',at:start+10000,monotonic:10000});
  const [[,log]]=sample({owner:null,at:start+3710000,monotonic:3710000});
  assert.equal(log.days['2026-11-25'].ms,10000);
});
test('keeps historic totals and counts a new visit after 30 minutes away', () => {
  const sample=createTimeline(), at=new Date(2026,10,25,9).getTime();
  const seed=JSON.stringify({first:'2026-11-25',lastVisit:at-1800000,days:{'2026-11-25':{ms:3000,sessions:1}}});
  sample({owner:'a',at,monotonic:0,seed});
  const [[,a],[,b]]=sample({owner:'b',at:at+17000,monotonic:17000});
  assert.deepEqual(a.days['2026-11-25'],{ms:20000,sessions:2});
  assert.deepEqual(b.days['2026-11-25'],{ms:0,sessions:1});
});
