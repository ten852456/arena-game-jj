/**
 * HTML for the fight summary extras, the end-of-run results page, profile, leaderboard and the scouting chip.
 * Pure string builders; ui.ts owns state, events and rendering.
 */
import { L } from '../../i18n';
import { IMAGES } from '../assets';
import { displayName } from '../lang';
import type { Explanation, Lock } from '../../sim/explain';
import { HEROES_BY_ID } from '../../sim/heroes';
import { ARCH_NAME } from '../../sim/skills';
import { noteText, runBestText, type FinishRunResult, type FightNote, type Leaderboard, type Period, type Profile, type RunSummary, type Scout } from './meta';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const heroName = (id: string) => HEROES_BY_ID[id]?.name ?? id;
const replayHref = (id: string) => `?replay=${encodeURIComponent(id)}`;

/** Tiny decorative stars + moon for page headers (pure CSS shapes, aria-hidden). */
const sky = () => `<div class="mm-sky" aria-hidden="true"><i class="mm-moon"></i><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i><i class="s5"></i></div>`;

// ---------- fight result extras ----------

/** "close!" banner, tiebreak rule, lock callouts and big-moment cards for one fight. */
export function fightHighlights(x: Explanation, opts: { replayHref?: string; replayAction?: string } = {}) {
  const parts: string[] = [];
  if (x.close) {
    const watch = opts.replayHref
      ? `<a class="mm-btn ghost" href="${esc(opts.replayHref)}">${L('▶ ดู replay อีกครั้ง', '▶ Watch the replay again')}</a>`
      : opts.replayAction
        ? `<button class="mm-btn ghost" data-a="${opts.replayAction}">${L('▶ ดูอีกครั้ง', '▶ Watch again')}</button>`
        : '';
    parts.push(`<div class="mm-close" role="status"><b>${L('สูสี!', 'Close fight!')}</b><span>${L('ผู้ชนะเหลือเลือดไม่ถึง 10% · ดู replay เพื่อหาจังหวะที่ตัดสินเกม', 'The winner ended below 10% HP · watch the replay to find the moment that decided it')}</span>${watch}</div>`);
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
  const title = d.won ? L(`ชนะครบ ${d.winTarget}!`, `${d.winTarget} wins!`) : d.conceded ? L('จบรอบ (ยอมแพ้)', 'Run over (gave up)') : L('จบรอบแล้ว', 'Run over');
  const sub = d.won
    ? L('โมจิของคุณได้รับมงกุฎดวงจันทร์คืนนี้', 'Your mochi wears the moon crown tonight')
    : d.wins >= d.winTarget / 2
      ? L('เกือบแล้ว! พักให้นุ่มแล้วกลับมาใหม่', 'So close! Rest up, stay soft and come back')
      : L('ดวงจันทร์ยังรออยู่ ลองแนว build ใหม่ดูนะ', 'The moon is still waiting: try a new kind of build');
  const reward =
    d.reward === undefined
      ? `<div class="mm-reward pending"><img class="mm-dust-img" src="${IMAGES.stardust}" alt="" aria-hidden="true"><span>${L('กำลังนับผงดาว…', 'Counting stardust…')}</span></div>`
      : d.reward
        ? `<div class="mm-reward"><img class="mm-dust-img" src="${IMAGES.stardust}" alt="" aria-hidden="true"><div><div class="mm-reward-n">+${d.reward.stardust} <small>${L('ผงดาว', 'stardust')}</small></div>${
            d.reward.total !== undefined ? `<div class="mm-reward-t">${L(`รวมทั้งหมด ${d.reward.total} ผงดาว`, `${d.reward.total} stardust in total`)}</div>` : ''
          }</div></div>`
        : '';
  const best = d.best
    ? `<div class="mm-best"><div class="mm-best-h">🌟 ${L('ช่วงเวลาที่ดีที่สุด · วันที่', 'Best moment · day')} ${d.best.day}</div><p>${esc(noteText(d.best))}</p>${
        d.best.fightId ? `<a class="mm-btn" href="${replayHref(d.best.fightId)}">${L('▶ ดู replay ไฟต์นี้', '▶ Watch this fight')}</a>` : ''
      }</div>`
    : '';
  const pips = Array.from({ length: d.winTarget }, (_, i) => `<i class="${i < d.wins ? 'on' : ''}"></i>`).join('');
  return `<div class="over-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="over-box">
  <section class="mm-over ${d.won ? 'won' : 'lost'}">
    ${sky()}
    <div class="mm-banner" style="background-image:url('${d.won ? IMAGES.bannerVictory : IMAGES.bannerDefeat}')"><h2 class="mm-over-title">${title}</h2></div>
    <div class="mm-over-hero">${d.heroArt}</div>
    <p class="mm-over-sub">${sub}</p>
    <div class="mm-pips" aria-label="${L(`ชนะ ${d.wins} จาก ${d.winTarget}`, `${d.wins} of ${d.winTarget} wins`)}">${pips}</div>
    <div class="mm-statgrid">
      <div><b>${d.wins}</b><span>${L('ชนะ', 'Wins')}</span></div>
      <div><b>${d.losses}</b><span>${L('แพ้', 'Losses')}</span></div>
      <div><b>${d.days}</b><span>${L('วัน', 'Days')}</span></div>
      <div><b>${d.rating}</b><span>${L('คะแนน build', 'Build rating')}</span></div>
    </div>
    ${reward}
    <div class="actions mm-actions">
      <button class="primary" data-a="home">${L('เล่นอีกรอบ', 'Play again')}</button>
      <button data-a="profile">${L('โปรไฟล์ของฉัน', 'My profile')}</button>
      <button class="ghost" data-a="town">${L('กลับเมือง', 'Back to town')}</button>
    </div>
  </section>
  <div class="over-detail">
  ${best}
  <h3>${L('build สุดท้าย', 'Final build')} · ${esc(heroName(d.hero))}</h3>
  ${d.buildHTML}
  <h3>${L('ทุกไฟต์ในรอบนี้', 'Every fight of this run')}</h3>
  ${d.historyHTML}
  </div>
  </div></div>`;
}

/** Fights of a run as tappable rows (replay links), phone friendly. */
export function historyList(log: { day: number; won: boolean; opp: string; ai: boolean; fightId?: string }[], notes: FightNote[]) {
  if (!log.length) return `<p class="muted">${L('ยังไม่มีไฟต์', 'No fights yet')}</p>`;
  return `<ol class="mm-hist">${log
    .map((l) => {
      const n = notes.find((x) => x.day === l.day);
      const tag = n?.close ? `<span class="mm-tag close">${L('สูสี', 'Close')}</span>` : '';
      const body = `<span class="mm-hd">${L('วัน', 'Day')} ${l.day}</span><span class="mm-hr ${l.won ? 'win' : 'lose'}">${l.won ? L('ชนะ', 'Won') : L('แพ้', 'Lost')}</span>
        <span class="mm-ho">${esc(displayName(l.opp))}${l.ai && !/^AI /.test(l.opp) ? ' <small class="muted">AI</small>' : ''} ${tag}</span>`;
      return l.fightId
        ? `<li><a href="${replayHref(l.fightId)}" aria-label="${L('ดู replay วันที่', 'Watch the replay of day')} ${l.day}">${body}<span class="mm-go" aria-hidden="true">▶</span></a></li>`
        : `<li><div>${body}</div></li>`;
    })
    .join('')}</ol>`;
}

// ---------- profile ----------

export function profilePage(p: Profile | null, name: string, loading: boolean) {
  const head = `<div class="actions page-nav"><button class="ghost" data-a="town">${L('← กลับเมือง', '← Back to town')}</button><button class="ghost" data-a="leaderboard">${L('🏆 กระดานผู้นำ', '🏆 Leaderboard')}</button></div>`;
  if (!p) return `<div class="page page-profile"><div class="page-side">${head}<section class="mm-card">${sky()}<h2>${L('โปรไฟล์', 'Profile')}</h2><p class="muted">${loading ? L('กำลังโหลด…', 'Loading…') : L('ยังไม่มีข้อมูล', 'No data yet')}</p></section></div></div>`;
  const runRow = (r: RunSummary) => `<li>
      <div class="mm-run-main"><b>${esc(heroName(r.hero))}</b> <span class="${r.wins >= 8 ? 'win' : ''}">${L('ชนะ', 'Wins')} ${r.wins}</span> <span class="muted">${L('แพ้', 'losses')} ${r.losses} · ${r.days} ${L('วัน', 'days')}${r.conceded ? L(' · ยอมแพ้', ' · gave up') : ''}</span>
        ${r.stardust !== undefined ? `<span class="mm-chipdust">✦ ${r.stardust}</span>` : ''}</div>
      ${runBestText(r) ? `<div class="muted small">${esc(runBestText(r)!)}</div>` : ''}
      ${r.bestFightId ? `<a class="mm-btn ghost small" href="${replayHref(r.bestFightId)}">${L('▶ replay ไฟต์เด่น', '▶ Best fight replay')}</a>` : ''}
    </li>`;
  return `<div class="page page-profile"><div class="page-side">${head}
  <section class="mm-card mm-profile">
    ${sky()}
    <h2>${esc(displayName(p.name ?? name))}</h2>
    ${p.local ? `<p class="muted small">${L('ข้อมูลจากเครื่องนี้ (เซิร์ฟเวอร์ยังไม่มีโปรไฟล์)', 'From this device (the server has no profile yet)')}</p>` : ''}
    <div class="mm-statgrid">
      <div><b>${p.runs}</b><span>${L('รอบที่เล่น', 'Runs')}</span></div>
      <div><b>${p.wins}</b><span>${L('ชนะรวม', 'Total wins')}</span></div>
      <div><b>${p.bestWins}</b><span>${L('ชนะสูงสุดใน 1 รอบ', 'Best run (wins)')}</span></div>
      <div><b>✦ ${p.stardust}</b><span>${L('ผงดาว', 'Stardust')}</span></div>
    </div>
  </section>
  ${p.best ? `<h3>${L('รอบที่ดีที่สุด', 'Best run')}</h3><ul class="mm-runs best">${runRow(p.best)}</ul>` : ''}
  </div>
  <section class="page-main glass">
  <h3>${L('รอบล่าสุด', 'Recent runs')}</h3>
  ${p.last.length ? `<ul class="mm-runs">${p.last.slice(0, 10).map(runRow).join('')}</ul>` : `<p class="muted">${L('ยังไม่มีรอบที่จบ ลองเข้าสนามประลองดูสิ', 'No finished runs yet: try the Arena!')}</p>`}
  </section></div>`;
}

// ---------- leaderboard ----------

export function leaderboardPage(period: Period, lb: Leaderboard | null, loading: boolean, local: RunSummary[]) {
  const tabs = (['season', 'day'] as Period[])
    .map((p) => `<button class="mm-tab ${p === period ? 'on' : ''}" data-a="lbPeriod" data-i="${p}" aria-pressed="${p === period}">${p === 'season' ? L('ทั้งซีซั่น', 'Season') : L('วันนี้', 'Today')}</button>`)
    .join('');
  let body: string;
  if (lb && lb.entries.length) {
    body = `<ol class="mm-lb">${lb.entries
      .slice(0, 50)
      .map((e) => `<li class="${e.me ? 'me' : ''} r${e.rank <= 3 ? e.rank : ''}"><span class="mm-rank">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
        <span class="mm-lbn">${esc(displayName(e.name))}${e.hero ? ` <small class="muted">${esc(heroName(e.hero))}</small>` : ''}</span>
        <span class="mm-lbs">${e.score} ${L('ชนะ', 'wins')}</span></li>`)
      .join('')}</ol>${lb.me && !lb.entries.some((e) => e.me) ? `<p class="mm-lbme">${L('อันดับของคุณ', 'Your rank')}: <b>${lb.me.rank}</b> · ${lb.me.score}</p>` : ''}`;
  } else if (loading) body = `<p class="muted">${L('กำลังโหลด…', 'Loading…')}</p>`;
  else {
    const mine = [...local].sort((a, b) => b.wins - a.wins).slice(0, 5);
    body = `<p class="muted">${L('กระดานผู้นำยังไม่เปิด', 'The leaderboard is not open yet')}${lb ? L(' (ยังไม่มีใครติดอันดับ)', ' (nobody is ranked yet)') : ''}</p>${
      mine.length
        ? `<h4>${L('สถิติของคุณในเครื่องนี้', 'Your runs on this device')}</h4><ol class="mm-lb">${mine
            .map((r, i) => `<li><span class="mm-rank">${i + 1}</span><span class="mm-lbn">${esc(heroName(r.hero))}</span><span class="mm-lbs">${L('ชนะ', 'wins')} ${r.wins}</span></li>`)
            .join('')}</ol>`
        : ''
    }`;
  }
  return `<div class="page page-lb"><div class="page-side">
  <div class="actions page-nav"><button class="ghost" data-a="town">${L('← กลับเมือง', '← Back to town')}</button><button class="ghost" data-a="profile">${L('โปรไฟล์ของฉัน', 'My profile')}</button></div>
  <img class="mm-lbhead" src="${IMAGES.headerLeaderboard}" alt="" aria-hidden="true">
  <section class="mm-card">${sky()}<h2>${L('🏆 กระดานผู้นำ', '🏆 Leaderboard')}</h2>
    <p class="muted small">${lb?.scoreLabel ? esc(lb.scoreLabel) : L('จัดอันดับนักสู้โมจิบนดวงจันทร์', 'Ranking the mochi fighters of the moon')}</p>
    <div class="mm-tabs" role="group" aria-label="${L('ช่วงเวลา', 'Period')}">${tabs}</div>
  </section>
  </div>
  <section class="page-main glass">${body}</section></div>`;
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
    <summary><span class="mm-scout-ic" aria-hidden="true">🔭</span><span class="mm-scout-t">${L(`สนามวันที่ ${day}: ส่วนมากเป็น`, `Day ${day} arena: mostly `)}<b>${top ? ARCH_NAME[top] : '?'}</b></span><span class="mm-scout-bar" aria-hidden="true">${bar}</span></summary>
    <ul>${rows}</ul>
    <p class="muted small">${L('สัดส่วนแนว build ของคู่ต่อสู้ที่อาจเจอวันนี้', 'Build styles of the opponents you may meet today')}${s.total ? L(` (จาก ${s.total} build)`, ` (from ${s.total} builds)`) : ''}${s.ai !== undefined ? ` · AI ${Math.round(s.ai * 100)}%` : ''}</p>
  </details>`;
}
