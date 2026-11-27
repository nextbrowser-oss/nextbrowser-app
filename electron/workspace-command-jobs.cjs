const { randomUUID } = require('node:crypto');

// A handle belongs to one authenticated MCP lease. Closing the turn or
// changing its permissions stops the same process tree as a foreground call.
function createCommandJobs(leaseSignal) {
  const jobs = new Map();
  return {
    start(run, check) {
      if ([...jobs.values()].some(job => !job.finished)) throw Error('Wait for the active command before starting another background command.');
      if (jobs.size >= 8) jobs.delete(jobs.keys().next().value);
      const id = randomUUID();
      const controller = new AbortController();
      const signal = AbortSignal.any([leaseSignal, controller.signal]);
      const job = { check, state: { job_id: id, status: 'running', output: '' } };
      jobs.set(id, job);
      const poll = setInterval(() => { try { check(); } catch { controller.abort(); } }, 150);
      job.promise = Promise.resolve().then(() => {
        check();
        return run(signal, chunk => { job.state.output = (job.state.output + chunk).slice(-3400); });
      }).then(result => {
        const output = result.truncated && job.state.output
          ? result.output.slice(0, 1500) + '\n…\n' + job.state.output : result.output;
        job.state = { ...result, output, job_id: id, status: 'finished' };
      }, () => {
        job.state = { job_id: id, status: 'stopped', output: job.state.output };
      }).finally(() => { job.finished = true; clearInterval(poll); });
      return { ...job.state };
    },
    async read(id, waitMs, signal) {
      const job = jobs.get(id);
      if (!job) throw Error('Unknown command handle for this turn.');
      job.check();
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20000) throw Error('wait_ms must be between 0 and 20000.');
      if (waitMs && !job.finished) {
        let timeout, abort;
        try {
          signal.throwIfAborted();
          await Promise.race([job.promise, new Promise((resolve, reject) => {
            timeout = setTimeout(resolve, waitMs);
            abort = () => reject(Error('Command status request cancelled.'));
            signal.addEventListener('abort', abort, { once: true });
          })]);
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
      }
      job.check();
      return { ...job.state };
    },
  };
}
module.exports = { createCommandJobs };
