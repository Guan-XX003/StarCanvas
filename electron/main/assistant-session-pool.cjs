// Bounded, session-scoped runtime ownership. Idle conversations own no dedicated
// process beyond the two warm slots; transcript persistence belongs elsewhere.
const fail = code => Object.assign(new Error(code), {code});

function createAssistantSessionPool({open, close, size = 2, maxQueue = 16}) {
  if (typeof open !== 'function' || typeof close !== 'function' || !Number.isInteger(size) || size < 1 || size > 4 || !Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 64) throw fail('ASSISTANT_POOL_INVALID');
  const workers = Array.from({length:size}, () => ({id:null, resource:null, job:null, quarantined:false}));
  const jobs = new Map(), waiting = [];
  let accepting = true, shutdown = false, closing = null;
  async function dispose(worker) {
    if (worker.disposing) return worker.disposing;
    const resource = worker.resource;
    const pending = (async () => {
      try {await close(resource); if (worker.resource === resource) {worker.resource = null; worker.id = null;} worker.quarantined = false;}
      catch {worker.quarantined = true; throw fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');}
    })();
    worker.disposing = pending;
    try {await pending;} finally {if (worker.disposing === pending) worker.disposing = null;}
  }
  function pump() {
    if (!accepting) return;
    if (workers.some(worker => worker.quarantined)) {
      // A quarantined exit blocks new processes, not completion of unrelated
      // active turns. Queued callers get an explicit failure, never an endless
      // spinner or a hidden retry after a later reset.
      for (const job of waiting.splice(0)) {jobs.delete(job.id); job.reject(fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED'));}
      return;
    }
    while (waiting.length) {
      // Prefer the warm owner when it is idle, without starving the FIFO queue.
      const first = waiting[0];
      const worker = workers.find(item => item.id === first.id && !item.job) || workers.find(item => !item.job);
      if (!worker) break;
      const job = waiting.shift(); worker.job = job; job.worker = worker; job.phase = 'starting';
      job.completion = (async () => {
        try {
          if (worker.id !== job.id) {
            await dispose(worker);
            if (job.controller.signal.aborted) throw fail('ASSISTANT_CANCELLED');
            // Allocate a mutable ownership slot BEFORE asynchronous startup so
            // Stop can fence credentials/probes before a child has been created.
            worker.resource = {}; worker.id = job.id;
            await open(worker.resource, job.id, job.controller.signal);
            job.fresh = true;
          }
          if (job.controller.signal.aborted) throw fail('ASSISTANT_CANCELLED');
          job.phase = 'running';
          const result = await job.work(worker.resource, {fresh:job.fresh === true, signal:job.controller.signal});
          if (job.controller.signal.aborted) throw fail('ASSISTANT_CANCELLED');
          job.resolve(result);
        } catch (error) {
          if (error?.code === 'ASSISTANT_RUNTIME_STOP_UNCONFIRMED') worker.quarantined = true;
          if (!worker.quarantined) try {await dispose(worker);} catch (stopError) {error = stopError;}
          const code = worker.quarantined ? 'ASSISTANT_RUNTIME_STOP_UNCONFIRMED' : job.controller.signal.aborted ? 'ASSISTANT_CANCELLED' : error?.code || 'ASSISTANT_FAILED';
          job.reject(fail(/^ASSISTANT_[A-Z_]+$/.test(code) ? code : 'ASSISTANT_FAILED'));
        } finally {jobs.delete(job.id); worker.job = null; pump();}
      })();
    }
  }
  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return;
    job.controller.abort();
    if (!job.worker) {
      waiting.splice(waiting.indexOf(job), 1); jobs.delete(id); job.reject(fail('ASSISTANT_CANCELLED')); return;
    }
    // open() must check the signal at asynchronous boundaries; close() must
    // independently confirm child exit, not merely acknowledge cancellation.
    await dispose(job.worker);
    await job.completion;
  }
  return Object.freeze({
    run(id, work) {
      if (typeof id !== 'string' || !id || id.length > 100 || typeof work !== 'function') return Promise.reject(fail('ASSISTANT_POOL_INVALID'));
      if (!accepting) return Promise.reject(fail(shutdown ? 'ASSISTANT_RUNTIME_CLOSED' : 'ASSISTANT_BUSY'));
      if (workers.some(worker => worker.quarantined)) return Promise.reject(fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED'));
      if (jobs.has(id)) return Promise.reject(fail('ASSISTANT_BUSY'));
      if (waiting.length >= maxQueue && workers.every(worker => worker.job)) return Promise.reject(fail('ASSISTANT_QUEUE_FULL'));
      return new Promise((resolve, reject) => {
        const job = {id, work, resolve, reject, controller:new AbortController(), phase:'queued', worker:null};
        jobs.set(id, job); waiting.push(job); pump();
      });
    },
    status: () => [
      ...[...jobs.values()].map(job => ({sessionId:job.id,phase:job.worker?.quarantined ? 'stop_unconfirmed' : job.phase})),
      ...workers.filter(worker => worker.quarantined && !worker.job).map(worker => ({sessionId:worker.id,phase:'stop_unconfirmed'})),
    ],
    cancel,
    async reset(id) {
      await cancel(id);
      const worker = workers.find(item => item.id === id);
      if (worker) await dispose(worker);
      pump();
    },
    closeAll({permanent = false} = {}) {
      if (permanent) shutdown = true;
      if (closing) return closing;
      accepting = false;
      closing = (async () => {
        for (const job of [...jobs.values()]) job.controller.abort();
        for (const job of waiting.splice(0)) {jobs.delete(job.id); job.reject(fail('ASSISTANT_CANCELLED'));}
        const outcomes = await Promise.allSettled(workers.map(dispose));
        await Promise.all(workers.map(worker => worker.job?.completion));
        if (outcomes.some(result => result.status === 'rejected') || workers.some(worker => worker.quarantined)) throw fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
      })().finally(() => {closing = null; accepting = !shutdown;});
      return closing;
    },
  });
}
module.exports = {createAssistantSessionPool};
