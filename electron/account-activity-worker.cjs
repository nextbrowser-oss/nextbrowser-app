const { parentPort } = require('node:worker_threads');

const dayKey = time => {
  const date = new Date(time);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
function createTimeline() {
  const accounts = new Map();
  let previous;
  return function sample({ owner, at, monotonic, seed }) {
    const changed = new Map();
    if (previous?.owner) {
      const log = accounts.get(previous.owner);
      const elapsed = Math.round(monotonic - previous.monotonic);
      // A missing heartbeat can mean sleep or process suspension. Ignore that gap.
      if (elapsed > 0 && elapsed <= 30_000) {
        const wallDelta = at - previous.at;
        const duration = Math.abs(wallDelta - elapsed) <= 250 && wallDelta >= 0 ? wallDelta : elapsed;
        let start = previous.at;
        const end = start + duration;
        while (start < end) {
          const midnight = new Date(start);
          midnight.setHours(24, 0, 0, 0);
          const stop = Math.min(end, midnight.getTime());
          (log.days[dayKey(start)] ??= { ms: 0, sessions: 0 }).ms += stop - start;
          start = stop;
        }
      }
      log.lastVisit = at;
      changed.set(previous.owner, log);
    }
    if (owner) {
      if (!accounts.has(owner)) {
        let data;
        try { data = JSON.parse(seed); } catch { /* New account on this device. */ }
        accounts.set(owner, data && typeof data.first === 'string' && Number.isFinite(data.lastVisit) && data.days && typeof data.days === 'object'
          ? data : { first: dayKey(at), lastVisit: 0, days: {} });
      }
      const log = accounts.get(owner);
      const day = log.days[dayKey(at)] ??= { ms: 0, sessions: 0 };
      if (owner !== previous?.owner && (!log.lastVisit || at - log.lastVisit >= 30 * 60_000)) day.sessions++;
      log.lastVisit = at;
      const cutoff = new Date(at);
      cutoff.setDate(cutoff.getDate() - 89);
      for (const key of Object.keys(log.days)) if (key < dayKey(cutoff)) delete log.days[key];
      changed.set(owner, log);
    }
    previous = { owner, at, monotonic };
    return [...changed];
  };
}
if (parentPort) {
  const sample = createTimeline();
  parentPort.on('message', message => parentPort.postMessage({ id: message.id, updates: sample(message), persist: message.persist }));
}
module.exports = { createTimeline };
