/**
 * HTML for the fight summary extras, the end-of-run results page, profile, leaderboard and the scouting chip.
 * Pure string builders; ui.ts owns state, events and rendering.
 */
import type { Explanation, Lock } from '../../sim/explain';
import { HEROES_BY_ID } from '../../sim/heroes';
import { ARCH_NAME } from '../../sim/skills';
import type { FinishRunResult, FightNote, Leaderboard, Period, Profile, RunSummary, Scout } from './meta';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const heroName = (id: string) => HEROES_BY_ID[id]?.name ?? id;
const replayHref = (id: string) => `?replay=${encodeURIComponent(id)}`;

/** Tiny decorative stars + moon for page headers (pure CSS shapes, aria-hidden). */
const sky = () => `<div class="mm-sky" aria-hidden="true"><i class="mm-moon"></i><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i><i class="s5"></i></div>`;

// ---------- fight result extras ----------

/** "สูสี!" banner, tiebreak rule, lock callouts and big-moment cards for one fight. */
export function fightHighlights(x: Explanation, opts: { replayHref?: string; replayAction?: string } = {}) {
  const parts: string[] = [];
  if (x.close) {
    const watch = opts.replayHref
      ? `<a class="mm-btn ghost" href="${esc(opts.replayHref)}">▶ ดู replay อีกครั้ง</a>`
      : opts.replayAction
        ? `<button class="mm-btn ghost" data-a="${opts.replayAction}">▶ ดูอีกครั้ง</button>`
        : '';
    parts.push(`<div class="mm-close" role="status"><b>สูสี!</b><span>ผู้ชนะเหลือเลือดไม่ถึง 10% · ดู replay เพื่อหาจังหวะที่ตัดสินเกม</span>${watch}</div>`);
  }
  if (x.tiebreak) parts.push(`<div class="mm-rule"><span aria-hidden="true">⚖</span><span>${esc(x.tiebreak)}</span></div>`);
  for (const l of x.locks) parts.push(lockCallout(l));
  if (x.moments.length)
    parts.push(`<div class="mm-moments">${x.moments
      .map((m) => `<div class="mm-moment k-${m.kind} side-${m.side}"><span class="mm-mi" aria-hidden="true">${m.icon}</span><div><b>${esc(m.title)}</b><span>${esc(m.text)}</span></div></div>`)
      .join('')}</div>`);
  return parts.join('');
}

function lockCallout(l: Lock) {
  return `<div class="mm-lock side-${l.side}"><span aria-hidden="true">❄</span><span>${esc(l.text)}</span></div>`;
}

// ---------- end of run ----------

export interface OverData {
  won: boolean;
  conceded: boolean;
  hero: string;
  heroArt: string;
  wins: number;
  losses: number;
  winTarget: number;
  days: number;
  rating: number;
  buildHTML: string;
  historyHTML: string;
  best: FightNote | null;
  /** undefined = still asking the server, null = no reward available */
  reward: FinishRunResult | null | undefined;
}

export function runOverPage(d: OverData) {
  const title = d.won ? `ชนะครบ ${d.winTarget}!` : d.conceded ? 'จบรอบ (ยอมแพ้)' : 'จบรอบแล้ว';
  const sub = d.won
    ? 'โมจิของคุณได้รับมงกุฎดวงจันทร์คืนนี้'
    : d.wins >= d.winTarget / 2
      ? 'เกือบแล้ว! พักให้นุ่มแล้วกลับมาใหม่'
      : 'ดวงจันทร์ยังรออยู่ ลองแนว build ใหม่ดูนะ';
  const reward =
    d.reward === undefined
      ? `<div class="mm-reward pending"><span class="mm-dust" aria-hidden="true">✦</span><span>กำลังนับผงดาว…</span></div>`
      : d.reward
        ? `<div class="mm-reward"><span class="mm-dust" aria-hidden="true">✦</span><div><div class="mm-reward-n">+${d.reward.stardust} <small>ผงดาว</small></div>${
            d.reward.total !== undefined ? `<div class="mm-reward-t">รวมทั้งหมด ${d.reward.total} ผงดาว</div>` : ''
          }</div></div>`
        : '';
  const best = d.best
    ? `<div class="mm-best"><div class="mm-best-h">🌟 ช่วงเวลาที่ดีที่สุด · วันที่ ${d.best.day}</div><p>${esc(d.best.text)}</p>${
        d.best.fightId ? `<a class="mm-btn" href="${replayHref(d.best.fightId)}">▶ ดู replay ไฟต์นี้</a>` : ''
      }</div>`
    : '';
  const pips = Array.from({ length: d.winTarget }, (_, i) => `<i class="${i < d.wins ? 'on' : ''}"></i>`).join('');
  return `<section class="mm-over ${d.won ? 'won' : 'lost'}">
    ${sky()}
    <div class="mm-over-hero">${d.heroArt}</div>
    <h2 class="mm-over-title">${title}</h2>
    <p class="mm-over-sub">${sub}</p>
    <div class="mm-pips" aria-label="ชนะ ${d.wins} จาก ${d.winTarget}">${pips}</div>
    <div class="mm-statgrid">
      <div><b>${d.wins}</b><span>ชนะ</span></div>
      <div><b>${d.losses}</b><span>แพ้</span></div>
      <div><b>${d.days}</b><span>วัน</span></div>
      <div><b>${d.rating}</b><span>คะแนน build</span></div>
    </div>
    ${reward}
  </section>
  ${best}
  <h3>build สุดท้าย · ${esc(heroName(d.hero))}</h3>
  ${d.buildHTML}
  <h3>ทุกไฟต์ในรอบนี้</h3>
  ${d.historyHTML}
  <div class="actions mm-actions">
    <button class="primary" data-a="home">เล่นอีกรอบ</button>
    <button data-a="profile">โปรไฟล์ของฉัน</button>
    <button class="ghost" data-a="town">กลับเมือง</button>
  </div>`;
}

/** Fights of a run as tappable rows (replay links), phone friendly. */
export function historyList(log: { day: number; won: boolean; opp: string; ai: boolean; fightId?: string }[], notes: FightNote[]) {
  if (!log.length) return '<p class="muted">ยังไม่มีไฟต์</p>';
  return `<ol class="mm-hist">${log
    .map((l) => {
      const n = notes.find((x) => x.day === l.day);
      const tag = n?.close ? '<span class="mm-tag close">สูสี</span>' : '';
      const body = `<span class="mm-hd">วัน ${l.day}</span><span class="mm-hr ${l.won ? 'win' : 'lose'}">${l.won ? 'ชนะ' : 'แพ้'}</span>
        <span class="mm-ho">${esc(l.opp)}${l.ai && !/^AI /.test(l.opp) ? ' <small class="muted">AI</small>' : ''} ${tag}</span>`;
      return l.fightId
        ? `<li><a href="${replayHref(l.fightId)}" aria-label="ดู replay วันที่ ${l.day}">${body}<span class="mm-go" aria-hidden="true">▶</span></a></li>`
        : `<li><div>${body}</div></li>`;
    })
    .join('')}</ol>`;
}

// ---------- profile ----------

export function profilePage(p: Profile | null, name: string, loading: boolean) {
  const head = `<div class="actions"><button class="ghost" data-a="town">← กลับเมือง</button><button class="ghost" data-a="leaderboard">🏆 กระดานผู้นำ</button></div>`;
  if (!p) return `${head}<section class="mm-card">${sky()}<h2>โปรไฟล์</h2><p class="muted">${loading ? 'กำลังโหลด…' : 'ยังไม่มีข้อมูล'}</p></section>`;
  const runRow = (r: RunSummary) => `<li>
      <div class="mm-run-main"><b>${esc(heroName(r.hero))}</b> <span class="${r.wins >= 8 ? 'win' : ''}">ชนะ ${r.wins}</span> <span class="muted">แพ้ ${r.losses} · ${r.days} วัน${r.conceded ? ' · ยอมแพ้' : ''}</span>
        ${r.stardust !== undefined ? `<span class="mm-chipdust">✦ ${r.stardust}</span>` : ''}</div>
      ${r.bestText ? `<div class="muted small">${esc(r.bestText)}</div>` : ''}
      ${r.bestFightId ? `<a class="mm-btn ghost small" href="${replayHref(r.bestFightId)}">▶ replay ไฟต์เด่น</a>` : ''}
    </li>`;
  return `${head}
  <section class="mm-card mm-profile">
    ${sky()}
    <h2>${esc(p.name ?? name)}</h2>
    ${p.local ? '<p class="muted small">ข้อมูลจากเครื่องนี้ (เซิร์ฟเวอร์ยังไม่มีโปรไฟล์)</p>' : ''}
    <div class="mm-statgrid">
      <div><b>${p.runs}</b><span>รอบที่เล่น</span></div>
      <div><b>${p.wins}</b><span>ชนะรวม</span></div>
      <div><b>${p.bestWins}</b><span>ชนะสูงสุดใน 1 รอบ</span></div>
      <div><b>✦ ${p.stardust}</b><span>ผงดาว</span></div>
    </div>
  </section>
  ${p.best ? `<h3>รอบที่ดีที่สุด</h3><ul class="mm-runs best">${runRow(p.best)}</ul>` : ''}
  <h3>รอบล่าสุด</h3>
  ${p.last.length ? `<ul class="mm-runs">${p.last.slice(0, 10).map(runRow).join('')}</ul>` : '<p class="muted">ยังไม่มีรอบที่จบ ลองเข้าสนามประลองดูสิ</p>'}`;
}

// ---------- leaderboard ----------

export function leaderboardPage(period: Period, lb: Leaderboard | null, loading: boolean, local: RunSummary[]) {
  const tabs = (['season', 'day'] as Period[])
    .map((p) => `<button class="mm-tab ${p === period ? 'on' : ''}" data-a="lbPeriod" data-i="${p}" aria-pressed="${p === period}">${p === 'season' ? 'ทั้งซีซั่น' : 'วันนี้'}</button>`)
    .join('');
  let body: string;
  if (lb && lb.entries.length) {
    body = `<ol class="mm-lb">${lb.entries
      .slice(0, 50)
      .map((e) => `<li class="${e.me ? 'me' : ''} r${e.rank <= 3 ? e.rank : ''}"><span class="mm-rank">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
        <span class="mm-lbn">${esc(e.name)}${e.hero ? ` <small class="muted">${esc(heroName(e.hero))}</small>` : ''}</span>
        <span class="mm-lbs">${e.score}</span></li>`)
      .join('')}</ol>${lb.me && !lb.entries.some((e) => e.me) ? `<p class="mm-lbme">อันดับของคุณ: <b>${lb.me.rank}</b> · ${lb.me.score}</p>` : ''}`;
  } else if (loading) body = '<p class="muted">กำลังโหลด…</p>';
  else {
    const mine = [...local].sort((a, b) => b.wins - a.wins).slice(0, 5);
    body = `<p class="muted">กระดานผู้นำยังไม่เปิด${lb ? ' (ยังไม่มีใครติดอันดับ)' : ''}</p>${
      mine.length
        ? `<h4>สถิติของคุณในเครื่องนี้</h4><ol class="mm-lb">${mine
            .map((r, i) => `<li><span class="mm-rank">${i + 1}</span><span class="mm-lbn">${esc(heroName(r.hero))}</span><span class="mm-lbs">ชนะ ${r.wins}</span></li>`)
            .join('')}</ol>`
        : ''
    }`;
  }
  return `<div class="actions"><button class="ghost" data-a="town">← กลับเมือง</button><button class="ghost" data-a="profile">โปรไฟล์ของฉัน</button></div>
  <section class="mm-card">${sky()}<h2>🏆 กระดานผู้นำ</h2>
    <p class="muted small">${lb?.scoreLabel ? esc(lb.scoreLabel) : 'จัดอันดับนักสู้โมจิบนดวงจันทร์'}</p>
    <div class="mm-tabs" role="group" aria-label="ช่วงเวลา">${tabs}</div>
  </section>
  ${body}`;
}

// ---------- scouting chip (shop, above the fight button) ----------

const ARCH_ORDER = ['tank', 'burst', 'scaling', 'control'] as const;
export function scoutChip(s: Scout | null, day: number) {
  if (!s) return '';
  const list = ARCH_ORDER.filter((a) => s.mix[a] !== undefined).sort((a, b) => (s.mix[b] ?? 0) - (s.mix[a] ?? 0));
  const bar = list.map((a) => `<i class="a-${a}" style="flex:${Math.max(0.02, s.mix[a] ?? 0)}"></i>`).join('');
  const top = list[0];
  const rows = list
    .map((a) => `<li><i class="dot a-${a}" aria-hidden="true"></i>${ARCH_NAME[a]}<b>${Math.round((s.mix[a] ?? 0) * 100)}%</b></li>`)
    .join('');
  return `<details class="mm-scout">
    <summary><span class="mm-scout-ic" aria-hidden="true">🔭</span><span class="mm-scout-t">สนามวันที่ ${day}: ส่วนมากเป็น<b>${top ? ARCH_NAME[top] : '?'}</b></span><span class="mm-scout-bar" aria-hidden="true">${bar}</span></summary>
    <ul>${rows}</ul>
    <p class="muted small">สัดส่วนแนว build ของคู่ต่อสู้ที่อาจเจอวันนี้${s.total ? ` (จาก ${s.total} build)` : ''}${s.ai !== undefined ? ` · AI ${Math.round(s.ai * 100)}%` : ''}</p>
  </details>`;
}
