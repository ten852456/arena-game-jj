// Persistent worker_threads pool for the tuner. Each task carries the knob values it must run with; a worker
// switches its live tuning (setTuning) only when they change. Workers start once and are reused every generation.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { simulate } from '../../src/sim/combat';
import { HEROES } from '../../src/sim/heroes';
import { hashSeed } from '../../src/sim/rng';
import { setTuning } from '../../src/sim/tuning';
import type { Build } from '../../src/sim/types';
import { runJob, type Job } from '../sim/jobs';

export type WatchJob = { k: 'watch'; seed: number; day: number; build: Build; builds: Record<string, Build[]> };
export type TJob = Job | WatchJob;
export interface Task {
  tune: Record<string, number>;
  job: TJob;
}

function runWatch(j: WatchJob) {
  let s = 0;
  let n = 0;
  for (const h of HEROES)
    j.builds[h.id].forEach((b, i) => {
      const seed = hashSeed(j.seed, 'watch', j.day, h.id, i);
      const r1 = simulate(j.build, b, seed, j.day);
      const r2 = simulate(b, j.build, seed, j.day);
      s += (r1.winner === 0 ? 1 : r1.winner === -1 ? 0.5 : 0) + (r2.winner === 1 ? 1 : r2.winner === -1 ? 0.5 : 0);
      n += 2;
    });
  return { s, n };
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  let key = '';
  port.on('message', (m: { id: number; task: Task }) => {
    const k = JSON.stringify(m.task.tune);
    if (k !== key) {
      setTuning(m.task.tune);
      key = k;
    }
    const j = m.task.job;
    port.postMessage({ id: m.id, res: j.k === 'watch' ? runWatch(j) : runJob(j) });
  });
}

export class TunePool {
  private workers: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) this.workers.push(new Worker(new URL(import.meta.url)));
  }
  /** Runs tasks on all workers; results come back in task order. Tasks with the same tuning go to the same worker when possible. */
  run<T>(tasks: Task[]): Promise<T[]> {
    const out: T[] = new Array(tasks.length);
    let next = 0;
    // group by tuning so a worker rarely switches knobs (switching rebuilds the skill table: cheap, but not free)
    const order = tasks.map((_, i) => i).sort((a, b) => (JSON.stringify(tasks[a].tune) < JSON.stringify(tasks[b].tune) ? -1 : 1));
    return new Promise((resolve, reject) => {
      let done = 0;
      if (!tasks.length) return resolve(out);
      const feed = (w: Worker) => {
        if (next >= order.length) return;
        const id = order[next++];
        w.postMessage({ id, task: tasks[id] });
      };
      for (const w of this.workers) {
        w.removeAllListeners('message');
        w.removeAllListeners('error');
        w.on('message', (m: { id: number; res: T }) => {
          out[m.id] = m.res;
          if (++done === tasks.length) resolve(out);
          else feed(w);
        });
        w.on('error', reject);
        feed(w);
      }
    });
  }
  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
