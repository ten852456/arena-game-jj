// Tiny worker_threads pool. Workers run this same file (tsx loads TypeScript in workers too).
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { runJob, type Job } from './jobs';

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on('message', (m: { id: number; job: Job }) => port.postMessage({ id: m.id, res: runJob(m.job) }));
}

/** Runs jobs on `workers` threads (0 = inline, for debugging). Results come back in job order. */
export async function runJobs<T>(jobs: Job[], workers: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  if (workers <= 0 || jobs.length <= 1) {
    jobs.forEach((j, i) => (out[i] = runJob(j) as T));
    return out;
  }
  const n = Math.min(workers, jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, () => new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url));
      const feed = () => {
        if (next >= jobs.length) {
          w.terminate().then(() => resolve(), reject);
          return;
        }
        const id = next++;
        w.postMessage({ id, job: jobs[id] });
      };
      w.on('message', (m: { id: number; res: T }) => {
        out[m.id] = m.res;
        feed();
      });
      w.on('error', reject);
      feed();
    })),
  );
  return out;
}
