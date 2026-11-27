/**
 * HTML for the fight summary extras, the end-of-run results page, profile, leaderboard and the scouting chip.
 * Pure string builders; ui.ts owns state, events and rendering.
 */
import { L } from '../../../shared/i18n';
import { IMAGES } from '../../art/assets';
import { icon } from '../../ui/icons';
import { titleFor, type Fresh, type Recap, type RevealPlan } from './records';
import { displayName } from '../../i18n/lang';
import type { Explanation, Lock } from '../../../sim/explain';
import { HEROES_BY_ID } from '../../../sim/heroes';
import { LINE_NAME, lineLabel } from '../../../sim/skills';
import { LINES } from '../../../sim/types';
import { noteText, runBestText, type FinishRunResult, type FightNote, type Leaderboard, type Period, type Profile, type RunSummary, type Scout } from './meta';
import { esc } from '../../ui/html';

export { esc } from '../../ui/html';

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

export interface QuickHero {
  id: string;
  name: string;
  art: string;
  /** again = the hero of this run, new = never finished a run with it */
  tag: 'again' | 'new' | '';
}
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
  /** longest win streak of the run */
  streak: number;
  buildHTML: string;
  historyHTML: string;
  best: FightNote | null;
  /** undefined = still asking the server, null = no reward available */
  reward: FinishRunResult | null | undefined;
  /** stardust in total after this run (server, or this browser's runs), null = unknown */
  total: number | null;
  recap: Recap;
  fresh: Fresh[];
  goal: string;
  /** the fight that ended a lost run */
  ended: { day: number; why?: string; tip?: string; close: boolean } | null;
  /** heroes offered for the next run: one tap starts it */
  quick: QuickHero[];
  plan: RevealPlan;
  /** reveal clock: ms elapsed, staged animation on, when the reward shows */
  el: number;
  on: boolean;
  rewardAt: number;
}

const ms = (n: number) => `${Math.max(0, Math.round(n))}ms`;
/** a piece of the staged reveal: pops in `n` ms after the screen opened */
const at = (n: number) => `style="--at:${ms(n)}"`;

function overTitle(d: OverData) {
  if (d.won) return d.losses === 0 ? L('มงกุฎไร้พ่าย!', 'Flawless crown!') : L('มงกุฎดวงจันทร์!', 'Moon crown!');
  return d.conceded ? L('พักรอบนี้ไว้ก่อน', 'Run set aside') : L('จบรอบแล้ว', 'Run over');
}

/** Win: pride. Loss: how close it was, said kindly (never more than the truth). */
function overSub(d: OverData) {
  const toGo = d.winTarget - d.wins;
  if (d.won) return L(`ชนะครบ ${d.winTarget} · โมจิของคุณสวมมงกุฎดวงจันทร์คืนนี้`, `${d.winTarget} wins · your mochi wears the moon crown tonight`);
  if (d.wins === 0)
    return d.conceded ? L('รอบใหม่เริ่มสดใสได้ทุกเมื่อ', 'A fresh run is always one tap away') : L('ทุกรอบสอนอะไรใหม่ ลองอีกครั้งนะ', 'Every run teaches something: have another go');
  if (toGo <= 3) return L(`อีกแค่ ${toGo} ชนะก็ได้มงกุฎแล้ว!`, `Only ${toGo} ${toGo === 1 ? 'win' : 'wins'} from the moon crown!`);
  return L(`ชนะ ${d.wins} ครั้ง · อีก ${toGo} ชนะถึงมงกุฎ`, `${d.wins} wins · ${toGo} more for the crown`);
}

function statCell(v: number, label: string, t: number, from = 0, dur = 450) {
  return `<div><b data-count="${v}" data-from="${from}" data-at="${Math.round(t)}" data-dur="${dur}">${v}</b><span>${label}</span></div>`;
}

const CONFETTI = Array.from({ length: 18 }, (_, i) => `<i class="c${i % 5}" style="--x:${(i * 37) % 100}%;--d:${(i * 173) % 900}ms;--r:${(i * 61) % 360}deg"></i>`).join('');

function rewardBlock(d: OverData) {
  if (d.reward === undefined)
    return `<div class="re-dust pending"><img class="mm-dust-img" src="${IMAGES.stardust}" alt="" aria-hidden="true"><span>${L('กำลังนับผงดาว…', 'Counting stardust…')}</span></div>`;
  const got = d.reward?.stardust ?? 0;
  if (!d.reward && d.total === null) return '';
  const t = d.rewardAt;
  const total = d.total ?? got;
  const before = titleFor(total - got);
  const now = titleFor(total);
  const from = before.index === now.index ? before.frac : 0;
  const next = now.next
    ? L(`อีก ${now.next.at - total} ผงดาว ได้ฉายา «${now.next.name}»`, `${now.next.at - total} more stardust to «${now.next.name}»`)
    : L('ได้ฉายาสูงสุดแล้ว!', 'Top title reached!');
  return `<div class="re-dust re-in" ${at(t)}>
    <img class="mm-dust-img" src="${IMAGES.stardust}" alt="" aria-hidden="true">
    <div class="re-dust-main">
      ${d.reward ? `<div class="mm-reward-n">+<b data-count="${got}" data-at="${t}" data-dur="700">${got}</b> <small>${L('ผงดาว', 'stardust')}</small></div>` : ''}
      <div class="re-title-row"><span class="re-title">${esc(now.name)}</span><span class="re-total">${L('รวม', 'total')} <b data-count="${total}" data-from="${total - got}" data-at="${t + 250}" data-dur="800">${total}</b></span></div>
      <div class="re-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(now.frac * 100)}" aria-label="${esc(next)}"><i style="--from:${(from * 100).toFixed(1)}%;--to:${(now.frac * 100).toFixed(1)}%;--at:${ms(t + 250)}"></i></div>
      <div class="re-next">${next}</div>
    </div>
  </div>`;
}

function recordChips(d: OverData) {
  const chips = d.fresh.map((f) => `<span class="re-chip re-fresh k-${f.kind}">${icon(f.icon)} ${esc(f.text)}</span>`);
  const p = d.recap.prev;
  if (!d.won && !d.fresh.some((f) => f.kind === 'wins') && p.runs > 0)
    chips.push(`<span class="re-chip">${icon('trophy')} ${L(`สถิติของคุณ: ชนะ ${Math.max(p.bestWins, d.wins)}`, `Your best: ${Math.max(p.bestWins, d.wins)} wins`)}</span>`);
  if (d.won && d.recap.cur.crowns > 1) chips.push(`<span class="re-chip">${icon('crown')} ${L(`มงกุฎใบที่ ${d.recap.cur.crowns}`, `Crown #${d.recap.cur.crowns}`)}</span>`);
  if (d.streak >= 3 && !d.fresh.some((f) => f.kind === 'streak'))
    chips.push(`<span class="re-chip">${icon('fire')} ${L(`ชนะติด ${d.streak}`, `${d.streak} wins in a row`)}</span>`);
  return chips.length ? `<div class="re-chips re-in" ${at(d.plan.records)}>${chips.join('')}</div>` : '';
}

function endedBlock(d: OverData) {
  if (d.won) return '';
  if (d.conceded)
    return `<div class="re-ended re-in" ${at(d.plan.records)}><p>${L(
      `คุณพักรอบนี้ไว้ในวันที่ ${d.days + 1} ไม่เป็นไรเลย รอบหน้าเริ่มใหม่สดใส`,
      `You set this run aside on day ${d.days + 1}. No worries: the next one starts fresh`,
    )}</p></div>`;
  const e = d.ended;
  if (!e || (!e.why && !e.close)) return '';
  return `<div class="re-ended re-in" ${at(d.plan.records)}>
    <h4>${icon('scroll')} ${L(`ไฟต์สุดท้าย · วันที่ ${e.day}`, `The last fight · day ${e.day}`)}</h4>
    ${e.close ? `<p class="re-close">${L('สูสีมาก! ผู้ชนะเหลือเลือดไม่ถึง 10%', 'So close! The winner had under 10% HP left')}</p>` : ''}
    ${e.why ? `<p>${esc(e.why)}</p>` : ''}
    ${e.tip ? `<p class="re-tip">${icon('bulb')} <span><b>${L('ลองดู:', 'Try:')}</b> ${esc(e.tip)}</span></p>` : ''}
  </div>`;
}

function defendBlock(d: OverData) {
  if (!d.won) return '';
  return `<div class="re-defend re-in" ${at(d.plan.records)}>
    <div class="re-defend-t">${icon('shield', 28)}<div><b>${L('build ของคุณเฝ้าดวงจันทร์แล้ว', 'Your build now defends the moon')}</b>
      <span>${L(`ผู้เล่นคนอื่นในวันที่ 1–${d.days} อาจเจอ build ของคุณในสนาม`, `Other players on days 1–${d.days} may meet your builds in the arena`)}</span></div></div>
    <div class="re-share">
      <div class="re-card" data-card><span class="muted small">${L('กำลังวาดการ์ด…', 'Drawing your card…')}</span></div>
      <div class="actions re-share-a"><button class="primary" data-a="shareCard">${L('แชร์การ์ดมงกุฎ', 'Share your crown card')}</button><button class="ghost" data-a="saveCard">${L('บันทึกรูป', 'Save image')}</button></div>
    </div>
  </div>`;
}

export function runOverPage(d: OverData) {
  const title = overTitle(d);
  const p = d.plan;
  const stars = Array.from({ length: d.winTarget }, (_, i) => {
    const on = i < d.wins;
    return `<i class="re-star${on ? ' on' : ''}"><span class="e">${icon('star')}</span>${on ? `<span class="f" ${at(p.star0 + i * p.starGap)}>${icon('star')}</span>` : ''}</i>`;
  }).join('');
  const quick = d.quick.length
    ? `<div class="re-quick" role="group" aria-label="${L('เริ่มรอบใหม่ทันทีด้วยฮีโร่', 'Start a new run right away as')}">
        <span class="re-quick-h">${L('หรือเริ่มทันทีด้วย', 'or jump straight in as')}</span>
        ${d.quick
          .map(
            (h) => `<button class="re-hero" data-a="start" data-i="${h.id}" title="${esc(h.name)}">${h.art}<span class="re-hn">${esc(h.name)}</span>${
              h.tag === 'again' ? `<span class="re-tag again">${L('ตัวเดิม', 'again')}</span>` : h.tag === 'new' ? `<span class="re-tag new">${L('ใหม่', 'new')}</span>` : ''
            }</button>`,
          )
          .join('')}
      </div>`
    : '';
  const best = d.best
    ? `<div class="mm-best"><div class="mm-best-h">🌟 ${L('ช่วงเวลาที่ดีที่สุด · วันที่', 'Best moment · day')} ${d.best.day}</div><p>${esc(noteText(d.best))}</p>${
        d.best.fightId ? `<a class="mm-btn" href="${replayHref(d.best.fightId)}">${L('▶ ดู replay ไฟต์นี้', '▶ Watch this fight')}</a>` : ''
      }</div>`
    : '';
  const banner = d.won ? IMAGES.bannerVictory : IMAGES.bannerDefeat;
  // profile / town: under "play again"; phones held sideways have them at the end of the right panel instead
  const sec = `<button class="ghost" data-a="profile">${L('โปรไฟล์ของฉัน', 'My profile')}</button><button class="ghost" data-a="town">${L('กลับเมือง', 'Back to town')}</button>`;
  return `<div class="over-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="over-box re-wrap${d.on ? ' re-on' : ''}" style="--el:${ms(d.el)}">
  <section class="mm-over ${d.won ? 'won' : 'lost'}">
    ${sky()}
    ${d.won ? `<div class="re-confetti" aria-hidden="true">${CONFETTI}</div>` : ''}
    <div class="mm-banner re-in" style="--at:0ms;background-image:url('${banner}')"><h2 class="mm-over-title">${title}</h2></div>
    <div class="mm-over-hero re-in" ${at(p.hero)}>${d.won ? `<span class="re-spot" aria-hidden="true"></span><span class="re-crown" aria-hidden="true">${icon('crown')}</span>` : ''}${d.heroArt}</div>
    <p class="mm-over-sub re-in" ${at(p.hero + 120)}>${overSub(d)}</p>
    <div class="mm-pips re-stars" role="img" aria-label="${L(`ชนะ ${d.wins} จาก ${d.winTarget}`, `${d.wins} of ${d.winTarget} wins`)}">${stars}</div>
    <div class="mm-statgrid re-in" ${at(p.stats)}>
      ${statCell(d.wins, L('ชนะ', 'Wins'), p.stats)}
      ${statCell(d.losses, L('แพ้', 'Losses'), p.stats)}
      ${statCell(d.streak, L('ชนะติดสูงสุด', 'Best streak'), p.stats)}
      ${statCell(d.rating, L('คะแนน build', 'Build rating'), p.stats, 1000, 600)}
    </div>
    <div class="mm-actions re-actions re-in" ${at(p.actions)}>
      <button class="primary re-again" data-a="home">${L('เล่นอีกรอบ', 'Play again')}<kbd class="re-kbd" aria-hidden="true">Enter</kbd></button>
      ${quick}
      <div class="re-sec">${sec}</div>
    </div>
  </section>
  <div class="over-detail">
  <div class="re-recap">
    ${rewardBlock(d)}
    ${recordChips(d)}
    <p class="re-goal re-in" ${at(p.records + 100)}>${icon('target')} <span>${esc(d.goal)}</span></p>
  </div>
  ${endedBlock(d)}
  ${defendBlock(d)}
  <div class="re-more re-in" ${at(p.actions)}>
  ${best}
  <h3>${L('build สุดท้าย', 'Final build')} · ${esc(heroName(d.hero))}</h3>
  ${d.buildHTML}
  <h3>${L('ทุกไฟต์ในรอบนี้', 'Every fight of this run')}</h3>
  ${d.historyHTML}
  <div class="re-sec re-sec-alt">${sec}</div>
  </div>
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
        ${r.stardust !== undefined ? `<span class="mm-chipdust"><img src="${IMAGES.stardust}" alt="${L('ผงดาว', 'stardust')}" width="18" height="18"> ${r.stardust}</span>` : ''}</div>
      ${runBestText(r) ? `<div class="muted small">${esc(runBestText(r)!)}</div>` : ''}
      ${r.bestFightId ? `<a class="mm-btn ghost small" href="${replayHref(r.bestFightId)}">${L('▶ replay ไฟต์เด่น', '▶ Best fight replay')}</a>` : ''}
    </li>`;
  return `<div class="page page-profile"><div class="page-side">${head}
  <section class="mm-card mm-profile">
    ${sky()}
    <p class="pf-label">${L('ชื่อของคุณ', 'Your name')}</p>
    <h2 class="pf-name">${esc(displayName(p.name ?? name))}</h2>
    <div class="pf-rename">
      <label class="sr-only" for="pname">${L('ตั้งชื่อใหม่', 'New name')}</label>
      <input id="pname" maxlength="24" autocomplete="nickname" value="${esc(displayName(p.name ?? name))}" placeholder="${L('ชื่อใหม่', 'New name')}">
      <button class="primary small" data-a="rename">${L('บันทึกชื่อ', 'Save name')}</button>
    </div>
    <p class="muted small pf-hint">${L('ชื่อนี้แสดงบนกระดานผู้นำและให้คู่ต่อสู้เห็น (ไม่เกิน 24 ตัว)', 'Shown on the leaderboard and to your rivals (up to 24 characters)')}</p>
    ${p.local ? `<p class="muted small">${L('ข้อมูลจากเครื่องนี้ (เซิร์ฟเวอร์ยังไม่มีโปรไฟล์)', 'From this device (the server has no profile yet)')}</p>` : ''}
    <div class="mm-statgrid">
      <div><b>${p.runs}</b><span>${L('รอบที่เล่น', 'Runs')}</span></div>
      <div><b>${p.wins}</b><span>${L('ชนะรวม', 'Total wins')}</span></div>
      <div><b>${p.bestWins}</b><span>${L('ชนะสูงสุดใน 1 รอบ', 'Best run (wins)')}</span></div>
      <div><b class="mm-dustn"><img src="${IMAGES.stardust}" alt="" aria-hidden="true" width="22" height="22"> ${p.stardust}</b><span>${L('ผงดาว', 'Stardust')}</span></div>
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
  const wl = (e: { wins?: number; score: number; losses?: number }) =>
    `<b>${e.wins ?? e.score}</b><span>${L('ชนะ', 'W')}</span>${e.losses !== undefined ? `<em>${e.losses}</em><span>${L('แพ้', 'L')}</span>` : ''}`;
  const you = `<span class="lb-you">${L('คุณ', 'You')}</span>`;
  let body: string;
  let mine = '';
  if (lb && lb.entries.length) {
    const top = lb.entries.slice(0, 3);
    const podium = `<div class="lb-podium">${[top[1], top[0], top[2]]
      .map((e) =>
        e
          ? `<div class="lb-pod p${e.rank}${e.me ? ' me' : ''}"><span class="lb-medal">${e.rank === 1 ? icon('crown') : e.rank}</span>
              <span class="lb-pname">${esc(displayName(e.name))}${e.me ? you : ''}</span>
              <span class="lb-phero">${e.hero ? esc(heroName(e.hero)) : ''}</span>
              <span class="lb-pwins">${wl(e)}</span><i class="lb-step">${e.rank}</i></div>`
          : '<div class="lb-pod empty"></div>',
      )
      .join('')}</div>`;
    const rest = lb.entries.slice(3, 50);
    const table = rest.length
      ? `<div class="lb-table" role="table" aria-label="${L('อันดับ', 'Rankings')}">
          <div class="lb-row lb-headrow" role="row"><span role="columnheader">#</span><span role="columnheader">${L('ผู้เล่น', 'Player')}</span><span role="columnheader">${L('ฮีโร่', 'Hero')}</span><span role="columnheader">${L('รอบที่ดีที่สุด', 'Best run')}</span></div>
          ${rest
            .map(
              (e) => `<div class="lb-row${e.me ? ' me' : ''}" role="row"><span class="lb-rank" role="cell">${e.rank}</span>
                <span class="lb-name" role="cell">${esc(displayName(e.name))}${e.me ? you : ''}</span>
                <span class="lb-hero" role="cell">${e.hero ? esc(heroName(e.hero)) : '–'}</span>
                <span class="lb-wl" role="cell">${wl(e)}</span></div>`,
            )
            .join('')}</div>`
      : '';
    body = podium + table;
    const me = lb.entries.find((e) => e.me) ?? lb.me;
    mine = me
      ? `<div class="lb-mine"><span class="lb-mine-h">${L('อันดับของคุณ', 'Your rank')}</span><b class="lb-mine-r">#${me.rank}</b>
          <span class="lb-mine-s">${L(`ชนะ ${me.wins ?? me.score}`, `${me.wins ?? me.score} wins`)}${me.losses !== undefined ? L(` · แพ้ ${me.losses}`, ` · ${me.losses} losses`) : ''}${me.hero ? ' · ' + esc(heroName(me.hero)) : ''}</span></div>`
      : `<div class="lb-mine none"><span class="lb-mine-h">${L('อันดับของคุณ', 'Your rank')}</span><span class="lb-mine-s">${
          period === 'day' ? L('ยังไม่มีรอบที่จบวันนี้: จบสักรอบเพื่อติดอันดับ', 'No finished run today yet: finish one to get ranked') : L('จบสักรอบเพื่อติดอันดับ', 'Finish a run to get ranked')
        }</span></div>`;
  } else if (loading) body = `<p class="muted">${L('กำลังโหลด…', 'Loading…')}</p>`;
  else {
    const runs = [...local].sort((a, b) => b.wins - a.wins).slice(0, 5);
    body = `<p class="muted">${L('กระดานผู้นำยังไม่เปิด', 'The leaderboard is not open yet')}${lb ? L(' (ยังไม่มีใครติดอันดับ)', ' (nobody is ranked yet)') : ''}</p>${
      runs.length
        ? `<h4>${L('สถิติของคุณในเครื่องนี้', 'Your runs on this device')}</h4><div class="lb-table">${runs
            .map((r, i) => `<div class="lb-row"><span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(heroName(r.hero))}</span><span class="lb-hero"></span><span class="lb-wl">${wl({ wins: r.wins, score: r.wins, losses: r.losses })}</span></div>`)
            .join('')}</div>`
        : ''
    }`;
  }
  const count = lb?.players ? L(`${lb.players} ผู้เล่นติดอันดับ`, `${lb.players} players ranked`) : '';
  return `<div class="page page-lb"><div class="page-side">
  <div class="actions page-nav"><button class="ghost" data-a="town">${L('← กลับเมือง', '← Back to town')}</button><button class="ghost" data-a="profile">${L('โปรไฟล์ / ตั้งชื่อ', 'Profile / name')}</button></div>
  <img class="mm-lbhead" src="${IMAGES.headerLeaderboard}" alt="" aria-hidden="true">
  <section class="mm-card">${sky()}<h2>${icon('trophy')} ${L('กระดานผู้นำ', 'Leaderboard')}</h2>
    <div class="mm-tabs" role="group" aria-label="${L('ช่วงเวลา', 'Period')}">${tabs}</div>
    <p class="muted small lb-rule">${L('จัดอันดับจากรอบที่ดีที่สุดของแต่ละคน: ชนะมากก่อน แพ้น้อยกว่าชนะเสมอ', 'Ranked by each player’s best run: most wins first, then fewest losses')}${count ? ' · ' + count : ''}</p>
    ${mine}
  </section>
  </div>
  <section class="page-main glass lb-main">${body}</section></div>`;
}

// ---------- scouting chip (shop, above the fight button) ----------

const ARCH_ORDER = LINES;
export function scoutChip(s: Scout | null, day: number) {
  if (!s) return '';
  const list = ARCH_ORDER.filter((a) => s.mix[a] !== undefined).sort((a, b) => (s.mix[b] ?? 0) - (s.mix[a] ?? 0));
  const bar = list.map((a) => `<i class="a-${a}" style="flex:${Math.max(0.02, s.mix[a] ?? 0)}"></i>`).join('');
  const top = list[0];
  const rows = list
    .map((a) => `<li><i class="dot a-${a}" aria-hidden="true"></i>${lineLabel(a)}<b>${Math.round((s.mix[a] ?? 0) * 100)}%</b></li>`)
    .join('');
  return `<details class="mm-scout">
    <summary><span class="mm-scout-ic" aria-hidden="true">🔭</span><span class="mm-scout-t">${L(`สนามวันที่ ${day}: ส่วนมากเป็น`, `Day ${day} arena: mostly `)}<b>${top ? LINE_NAME[top] : '?'}</b></span><span class="mm-scout-bar" aria-hidden="true">${bar}</span></summary>
    <ul>${rows}</ul>
    <p class="muted small">${L('สัดส่วนแนว build ของคู่ต่อสู้ที่อาจเจอวันนี้', 'Build styles of the opponents you may meet today')}${s.total ? L(` (จาก ${s.total} build)`, ` (from ${s.total} builds)`) : ''}${s.ai !== undefined ? ` · AI ${Math.round(s.ai * 100)}%` : ''}</p>
  </details>`;
}
