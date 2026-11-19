/**
 * Firing timeline for the grid shop (GC1): when each placed block fires during the first seconds of a fight.
 * Computed with the real sim (simulate) against a training dummy with no skills, so cooldowns, connect bonuses
 * (haste, ⚡ trigger), engines (gear, overclock), marks and hero passives are exactly what the fight uses.
 * The one thing it can't know is the enemy: their freezes and slows push your blocks later in a real fight.
 */
import { L } from '../../i18n';
import { TPS, simulate } from '../../sim/combat';
import { SKILLS, nodeOf } from '../../sim/skills';
import type { Build } from '../../sim/types';

export const TIMELINE_SECS = 12;
/** a hero id with no passive, and a late day so the dummy's HP lasts well past the preview */
const DUMMY: Build = { hero: '__dummy', w: 1, h: 1, skills: [] };
const DUMMY_DAY = 40;
const SEED = 1;

export interface Fire {
  /** tick (10 per second) */
  t: number;
  /** index into build.skills */
  idx: number;
  /** set off by a ⚡ trigger bonus or an engine of this build.skills index */
  from?: number;
  echo?: boolean;
}

export function firesOf(b: Build, secs = TIMELINE_SECS): Fire[] {
  if (!b.skills.some((k) => k.x >= 0)) return [];
  const res = simulate(b, DUMMY, SEED, DUMMY_DAY);
  const out: Fire[] = [];
  for (const e of res.events) {
    if (e.t > secs * TPS) break;
    if (e.type === 'cast' && e.side === 0) out.push({ t: e.t, idx: e.idx, from: e.from, echo: e.echo });
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sec = (t: number) => (t / TPS).toFixed(1);

/** Lanes (one per placed block, in the sim's reading order) with a dot per fire, an axis, then the first fires in order. */
export function timelineHTML(b: Build): string {
  const placed = b.skills
    .map((k, i) => ({ k, i }))
    .filter((p) => p.k.x >= 0)
    .sort((p, q) => p.k.y - q.k.y || p.k.x - q.k.x || p.i - q.i);
  if (!placed.length) return `<div class="tl-empty">${L('วางบล็อกลงตารางแล้วดูตรงนี้ว่าแต่ละอันทำงานวินาทีไหน', 'Place blocks on the grid to see when each one fires')}</div>`;
  const fires = firesOf(b);
  const max = TIMELINE_SECS * TPS;
  const pos = (t: number) => `${((t / max) * 100).toFixed(2)}%`;
  const name = (i: number) => nodeOf(b.skills[i]).name;
  const lanes = placed
    .map(({ k, i }) => {
      const mine = fires.filter((f) => f.idx === i);
      const dots = mine
        .map((f) => {
          const kind = f.from !== undefined ? 'trig' : f.echo ? 'echo' : 'own';
          const why =
            f.from !== undefined
              ? L(`⚡ ${esc(name(f.from))} สั่งให้ทำงาน`, `⚡ fired by ${esc(name(f.from))}`)
              : f.echo
                ? L('ตีซ้ำ (ตรา)', 'Echo (mark)')
                : L('ครบคูลดาวน์', 'Cooldown ready');
          const tip = `<div class="tt-h"><b>${esc(name(i))}</b> · ${sec(f.t)}${L(' วิ', 's')}</div><div class="muted small">${why}</div>`;
          return `<i class="tl-dot ${kind}" style="left:${pos(f.t)}" data-ttxt="${esc(tip)}">${kind === 'trig' ? '⚡' : ''}</i>`;
        })
        .join('');
      const n = mine.filter((f) => !f.echo).length;
      const trig = mine.filter((f) => f.from !== undefined).length;
      return `<div class="tl-lane arch-${SKILLS[k.id].arch}" data-tl="${i}">
        <span class="tl-name">${esc(name(i))}</span>
        <div class="tl-track">${dots}</div>
        <span class="tl-n" title="${L(`ทำงานกี่ครั้งใน ${TIMELINE_SECS} วิแรก`, `Fires in the first ${TIMELINE_SECS} s`)}">×${n}${trig ? `<small>⚡${trig}</small>` : ''}</span>
      </div>`;
    })
    .join('');
  const ticks = [0, 3, 6, 9, 12].map((s) => `<span style="left:${pos(s * TPS)}">${s}</span>`).join('');
  const seq = fires
    .filter((f) => !f.echo)
    .slice(0, 8)
    .map((f) => `<li class="${f.from !== undefined ? 'trig' : ''}"><b>${sec(f.t)}</b> ${f.from !== undefined ? '⚡' : ''}${esc(name(f.idx))}</li>`)
    .join('');
  return `<div class="tl-lanes">${lanes}
      <div class="tl-axis" aria-hidden="true"><span class="tl-name"></span><div class="tl-ticks">${ticks}</div><span class="tl-n">${L('วิ', 's')}</span></div>
    </div>
    <ol class="tl-seq" aria-label="${L('ลำดับที่ทำงานก่อนหลัง', 'Firing order')}">${seq}</ol>`;
}
