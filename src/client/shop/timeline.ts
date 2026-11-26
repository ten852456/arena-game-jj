/**
 * Firing-order preview for the shop: when each skill in the list fires during the first seconds of a fight.
 * Computed with the real sim (simulate) against a training dummy that has no skills and huge HP, so cooldowns,
 * connect bonuses (haste, ⚡ trigger), marks and hero passives are exactly what the fight uses.
 * The only thing it can't know is the enemy: their freezes / slows push your skills later in a real fight.
 */
import { L } from '../../i18n';
import { TPS, simulate } from '../../sim/combat';
import { SKILLS, nodeOf } from '../../sim/skills';
import type { Build, SkillInstance } from '../../sim/types';
import { skillIcon } from '../assets';
import { esc } from '../html';

export const TIMELINE_SECS = 12;
/** a hero id with no passive, and a late day so the dummy's HP lasts well past the preview */
const DUMMY: Build = { hero: '__dummy', skills: [] };
const DUMMY_DAY = 40;
const SEED = 1;

export interface Fire {
  /** tick (10 per second) */
  t: number;
  /** index in the list */
  idx: number;
  /** set off by the ⚡ trigger bonus of this list index */
  from?: number;
  echo?: boolean;
}

export function firesOf(b: Build, secs = TIMELINE_SECS): Fire[] {
  if (!b.skills.length) return [];
  const res = simulate({ hero: b.hero, skills: b.skills }, DUMMY, SEED, DUMMY_DAY);
  const out: Fire[] = [];
  for (const e of res.events) {
    if (e.t > secs * TPS) break;
    if (e.type === 'cast' && e.side === 0) out.push({ t: e.t, idx: e.idx, from: e.from, echo: e.echo });
  }
  return out;
}

const sec = (t: number) => (t / TPS).toFixed(1);

/** Lanes (one per skill, list order) with a dot per fire, an axis, then the first fires in order. */
export function timelineHTML(skills: SkillInstance[], hero: string): string {
  const fires = firesOf({ hero, skills });
  const max = TIMELINE_SECS * TPS;
  const pos = (t: number) => `${((t / max) * 100).toFixed(2)}%`;
  const name = (i: number) => nodeOf(skills[i]).name;
  if (!skills.length) return `<div class="tl-empty">${L('ซื้อ skill แล้วดูตรงนี้ว่าแต่ละตัวทำงานวินาทีไหน', 'Buy a skill, then see here at which second each one fires')}</div>`;
  const lanes = skills
    .map((k, i) => {
      const mine = fires.filter((f) => f.idx === i);
      const dots = mine
        .map((f) => {
          const kind = f.from !== undefined ? 'trig' : f.echo ? 'echo' : 'own';
          const why = f.from !== undefined ? L(`⚡ ถูก ${esc(name(f.from))} สั่งให้ทำงานตาม`, `⚡ fired by ${esc(name(f.from))}`) : f.echo ? L('ตีซ้ำ (ตรา)', 'Echo (mark)') : L('ครบคูลดาวน์', 'Cooldown ready');
          const tip = `<div class="tt-h"><b>${esc(name(i))}</b> · ${sec(f.t)}${L(' วิ', 's')}</div><div class="muted small">${why}</div>`;
          return `<i class="tl-dot ${kind}" style="left:${pos(f.t)}" data-ttxt="${esc(tip)}">${kind === 'trig' ? '⚡' : ''}</i>`;
        })
        .join('');
      const n = mine.filter((f) => !f.echo).length;
      const trig = mine.filter((f) => f.from !== undefined).length;
      return `<div class="tl-lane line-${SKILLS[k.id].line}">
        <span class="tl-name"><span class="tl-no">${i + 1}</span><img class="tl-ico" src="${skillIcon(k.id)}" alt="">${esc(name(i))}</span>
        <div class="tl-track">${dots}</div>
        <span class="tl-n" title="${L(`ทำงานกี่ครั้งใน ${TIMELINE_SECS} วิแรก`, `Fires in the first ${TIMELINE_SECS}s`)}">×${n}${trig ? `<small>⚡${trig}</small>` : ''}</span>
      </div>`;
    })
    .join('');
  const ticks = [0, 3, 6, 9, 12].map((s) => `<span style="left:${pos(s * TPS)}">${s}</span>`).join('');
  // the first fires in the exact order the sim runs them (ties fire top to bottom, triggers right after)
  const seq = fires
    .filter((f) => !f.echo)
    .slice(0, 8)
    .map(
      (f) =>
        `<li class="${f.from !== undefined ? 'trig' : ''}"><b>${sec(f.t)}</b> ${f.from !== undefined ? '⚡' : ''}${esc(name(f.idx))}</li>`,
    )
    .join('');
  return `<div class="tl-lanes">${lanes}
      <div class="tl-axis" aria-hidden="true"><span class="tl-name"></span><div class="tl-ticks">${ticks}</div><span class="tl-n">${L('วิ', 's')}</span></div>
    </div>
    <ol class="tl-seq" aria-label="${L('ลำดับที่ทำงานก่อนหลัง', 'Firing order')}">${seq}</ol>`;
}
