/**
 * On-chain mode overlay (the default; off with ?chain=0): a badge in the top-right corner on every screen (network, wallet, SOL,
 * connection state, last on-chain fight) and a profile window with what the chain holds for this player.
 * Self-contained DOM + CSS: the game's screens are not touched.
 */
import * as C from './chain';
import { HEROES_BY_ID } from '../sim/heroes';
import { L } from '../i18n';

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let badge: HTMLElement;
let connectSince = 0;
// re-render once a second while connecting so the "stuck? reset" hint appears
setInterval(() => { const s = C.chainStatus().state; if (badge && (s === 'connecting' || s === 'approve')) renderBadge(); }, 1000);
/** set by the UI: log in (connect the wallet) and log out (forget this browser's session) */
let handlers: { login: () => void; logout: () => Promise<void>; take: () => void } = { login: () => {}, logout: async () => {}, take: () => {} };
export const setChainHandlers = (h: typeof handlers) => { handlers = h; };
let modal: HTMLElement | null = null;
let solCache: number | null = null;

const CSS = `
#chain-badge{position:fixed;top:40px;right:8px;z-index:9999;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;
  background:rgba(24,18,34,.88);color:#f4ecff;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;
  box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;user-select:none;border:1px solid rgba(255,255,255,.12);max-width:calc(100vw - 16px)}
#chain-badge .dot{width:8px;height:8px;border-radius:50%;background:#888;flex:none}
#chain-badge .dot.ready{background:#4ade80}#chain-badge .dot.sending,#chain-badge .dot.connecting,#chain-badge .dot.approve{background:#facc15}
#chain-badge .dot.error{background:#f87171}
#chain-badge .net{opacity:.75;font-weight:500}
#chain-badge .login{background:#ab9ff2;color:#1c1530;border-radius:999px;padding:3px 10px;font-weight:700}#chain-badge .fight{opacity:.85;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#chain-modal{position:fixed;inset:0;z-index:10000;background:rgba(10,6,16,.6);display:flex;align-items:flex-start;justify-content:center;padding:56px 16px 16px;overflow:auto}
#chain-modal .card{width:min(520px,100%);background:#1f1829;color:#f4ecff;border-radius:16px;padding:16px 18px;border:1px solid rgba(255,255,255,.12);
  font:14px/1.45 system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#chain-modal h3{margin:0 0 4px;font-size:17px}#chain-modal .sub{opacity:.7;font-size:12px;margin-bottom:12px}
#chain-modal .sec{border-top:1px solid rgba(255,255,255,.1);padding:10px 0}
#chain-modal .row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:3px 0;flex-wrap:wrap}
#chain-modal .k{opacity:.7}#chain-modal .v{font-weight:600;text-align:right}
#chain-modal code{font-size:12px;background:rgba(255,255,255,.08);padding:1px 6px;border-radius:6px}
#chain-modal a{color:#f0a6ff}#chain-modal button{font:inherit;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;
  border-radius:10px;padding:6px 12px;cursor:pointer}#chain-modal button.warn{border-color:#f87171;color:#fecaca}
#chain-modal .actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:6px}
#chain-modal .note{font-size:12px;opacity:.7}
`;

function renderBadge() {
  const st = C.chainStatus();
  const info = C.chainInfo();
  const net = info ? (info.mode === 'tee' ? 'Devnet · TEE' : 'Local') : '…';
  const lf = C.chainLastFight();
  const state = {
    off: '', loggedout: '', othertab: '', connecting: L('กำลังเชื่อมต่อ…', 'connecting…'), approve: L('รออนุมัติใน wallet', 'approve in wallet'),
    ready: '', sending: L('ส่งขึ้น chain…', 'sending…'), error: L('ผิดพลาด', 'error'),
  }[st.state];
  const wallet = info ? `${info.phantom ? 'Phantom' : 'burner'} ${short(info.owner)}` : '';
  const fight = lf ? `⚔ ${L('วัน', 'day')} ${lf.day} ${lf.won ? L('ชนะ', 'won') : lf.draw ? L('เสมอ', 'draw') : L('แพ้', 'lost')} · ${lf.ghost ? 'ghost' : 'bot'}` : '';
  if (st.state === 'othertab') {
    badge.innerHTML = `<span class="dot"></span><span>${L('เปิดเล่นอยู่ในแท็บอื่น', 'Playing in another tab')}</span><span class="login">${L('เล่นในแท็บนี้', 'Play here')}</span>`;
    badge.title = L('กระเป๋านี้เล่นอยู่ในอีกแท็บ กดเพื่อย้ายมาเล่นที่แท็บนี้ (แท็บเดิมจะหยุด)', 'This wallet is playing in another tab. Click to move the game here (the other tab stops).');
    return;
  }
  if (st.state === 'loggedout') {
    badge.innerHTML = `<span class="dot"></span><span>◎ <span class="net">${net === '…' ? 'Solana' : net}</span></span><span class="login">${L('เชื่อมต่อ Phantom', 'Connect Phantom')}</span>`;
    badge.title = L('เข้าสู่ระบบด้วย Phantom เพื่อเล่นบน chain', 'Log in with Phantom to play on chain');
    return;
  }
  const stepMsg = (st.state === 'connecting' || st.state === 'approve' || st.state === 'error') && st.msg ? st.msg : '';
  if (st.state === 'connecting' || st.state === 'approve') { if (!connectSince) connectSince = Date.now(); } else connectSince = 0;
  const slow = connectSince && Date.now() - connectSince > 25_000;
  badge.innerHTML = `<span class="dot ${st.state}"></span><span>◎ <span class="net">${net}</span></span>${wallet ? `<span>${esc(wallet)}</span>` : ''}${solCache !== null ? `<span class="net">${solCache.toFixed(3)} SOL</span>` : ''}${stepMsg ? `<span class="net">${esc(stepMsg.length > 70 ? stepMsg.slice(0, 70) + '…' : stepMsg)}</span>` : state ? `<span class="net">${state}</span>` : ''}${fight ? `<span class="fight">${esc(fight)}</span>` : ''}${slow ? `<span class="login">${L('ค้าง? กดเพื่อรีเซ็ต', 'Stuck? Click to reset')}</span>` : ''}`;
  badge.title = st.msg || L('ข้อมูลบน blockchain ของคุณ', 'Your on-chain profile');
}

async function refreshSol() {
  const p = await C.chainProfile().catch(() => null);
  if (p) solCache = p.ownerSol;
  renderBadge();
}

async function openModal() {
  modal?.remove();
  modal = document.createElement('div');
  modal.id = 'chain-modal';
  modal.innerHTML = `<div class="card"><h3>${L('โปรไฟล์บน blockchain', 'On-chain profile')}</h3><div class="sub">${L('กำลังอ่านจาก chain…', 'reading the chain…')}</div></div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.body.appendChild(modal);
  const p = await C.chainProfile().catch((e) => { console.error('[chain] profile', e); return null; });
  if (!modal) return;
  if (!p) {
    modal.querySelector('.card')!.innerHTML = `<h3>${L('โปรไฟล์บน blockchain', 'On-chain profile')}</h3><div class="sub">${L('ยังไม่ได้เชื่อมต่อ chain', 'Not connected to the chain yet')}</div><div class="actions"><button data-x="close">${L('ปิด', 'Close')}</button></div>`;
    modal.querySelector('[data-x="close"]')!.addEventListener('click', closeModal);
    return;
  }
  solCache = p.ownerSol;
  renderBadge();
  const lf = C.chainLastFight();
  const left = p.sessionExpiresAt ? Math.max(0, p.sessionExpiresAt - Date.now()) : 0;
  const leftTxt = p.sessionExpiresAt ? (left > 86400e3 ? `${Math.floor(left / 86400e3)} ${L('วัน', 'd')} ${Math.floor((left % 86400e3) / 3600e3)} ${L('ชม.', 'h')}` : `${Math.floor(left / 3600e3)} ${L('ชม.', 'h')} ${Math.floor((left % 3600e3) / 60e3)} ${L('นาที', 'min')}`) : '–';
  const link = (addr: string) => `<a href="${C.explorerUrl(addr)}" target="_blank" rel="noopener">${short(addr)}</a> <button data-copy="${addr}" title="copy">⧉</button>`;
  const run = p.run;
  modal.querySelector('.card')!.innerHTML = `
    <h3>${L('โปรไฟล์บน blockchain', 'On-chain profile')}</h3>
    <div class="sub">${esc(p.network)} · ${L('ซีซัน', 'season')} ${p.season}</div>
    <div class="sec">
      <div class="row"><span class="k">${L('Wallet (เจ้าของ)', 'Wallet (owner)')}</span><span class="v">${p.phantom ? 'Phantom ' : ''}${link(p.owner)}</span></div>
      <div class="row"><span class="k">SOL</span><span class="v">${p.ownerSol.toFixed(4)} SOL</span></div>
      <div class="row"><span class="k">${L('บัญชีซีซันของคุณ', 'Your season account')}</span><span class="v">${link(p.player)}</span></div>
      <div class="row"><span class="k">Program</span><span class="v">${link(p.program)}</span></div>
    </div>
    <div class="sec">
      <div class="row"><span class="k">${L('สถานะ', 'Status')}</span><span class="v">${esc(p.status)}</span></div>
      <div class="row"><span class="k">${L('เริ่ม run ไปแล้ว', 'Runs started')}</span><span class="v">${p.runsStarted}</span></div>
      <div class="row"><span class="k">${L('คะแนนดีที่สุด (ชนะ×100+เลือด)', 'Personal best (wins×100+HP)')}</span><span class="v">${p.bestScore}</span></div>
      ${run ? `<div class="row"><span class="k">${L('Run ปัจจุบัน (บน chain)', 'Current run (on chain)')}</span><span class="v">${esc(HEROES_BY_ID[run.hero]?.name ?? run.hero)} · ${L('วัน', 'day')} ${run.day} · ${L('ชนะ', 'W')} ${run.wins} ${L('แพ้', 'L')} ${run.losses} · ❤ ${run.hp} · 🪙 ${run.gold}</span></div>` : ''}
      <div class="note">${L('อันดับของซีซันเป็นความลับใน TEE จนจบซีซัน แล้วคุณ claim รางวัลได้บน Solana', 'The season ranking stays private in the TEE until the season ends; then you claim your reward on Solana')}</div>
    </div>
    <div class="sec">
      <div class="row"><span class="k">${L('Session key (เบราว์เซอร์นี้)', 'Session key (this browser)')}</span><span class="v"><code>${short(p.session)}</code> · ${p.sessionSol.toFixed(4)} SOL</span></div>
      <div class="row"><span class="k">${L('หมดอายุใน', 'Expires in')}</span><span class="v">${p.phantom ? leftTxt : L('— (burner)', '— (burner)')}</span></div>
      <div class="note">${L('Session key เล่นแทนคุณได้อย่างเดียว ย้ายเงินไม่ได้ · ทุกการกระทำส่งไป TEE โดยไม่ต้องกด wallet', 'The session key can only play — it cannot move funds · every action goes to the TEE without a wallet popup')}</div>
    </div>
    ${lf ? `<div class="sec">
      <div class="row"><span class="k">${L('ไฟต์ล่าสุด (บน chain)', 'Last fight (on chain)')}</span><span class="v">${L('วัน', 'day')} ${lf.day} · ${lf.won ? L('ชนะ', 'won') : lf.draw ? L('เสมอ', 'draw') : L('แพ้', 'lost')} · ${lf.ghost ? L('ghost ของผู้เล่น', 'player ghost') : 'bot'}</span></div>
      <div class="row"><span class="k">Seed</span><span class="v"><code>${lf.seed}</code></span></div>
      <div class="row"><span class="k">Tx</span><span class="v"><code>${short(lf.sig)}</code> <button data-copy="${lf.sig}" title="copy">⧉</button></span></div>
      <div class="note">${p.mode === 'tee' ? L('ธุรกรรมบน TEE เป็นส่วนตัว ไม่แสดงใน explorer สาธารณะ', 'TEE transactions are private and do not appear on public explorers') : ''}</div>
    </div>` : ''}
    <div class="actions">
      ${p.phantom ? `<button class="warn" data-x="revoke">${L('ยกเลิก session key', 'Revoke session key')}</button>` : ''}
      <button class="warn" data-x="logout">${L('ออกจากระบบ', 'Log out')}</button>
      <button data-x="refresh">${L('รีเฟรช', 'Refresh')}</button>
      <button data-x="close">${L('ปิด', 'Close')}</button>
    </div>`;
  const card = modal.querySelector('.card')!;
  card.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => { void navigator.clipboard?.writeText(b.dataset.copy!); b.textContent = '✓'; }));
  card.querySelector('[data-x="close"]')!.addEventListener('click', closeModal);
  card.querySelector('[data-x="refresh"]')!.addEventListener('click', () => void openModal());
  card.querySelector('[data-x="logout"]')!.addEventListener('click', async () => {
    closeModal();
    await handlers.logout();
  });
  card.querySelector('[data-x="revoke"]')?.addEventListener('click', async () => {
    try {
      C.setChainStatus('approve', L('อนุมัติการยกเลิกใน wallet', 'approve the revoke in your wallet'));
      await C.chainRevoke();
      C.setChainStatus('ready', L('ยกเลิกแล้ว: โหลดหน้าใหม่เพื่ออนุมัติ session ใหม่', 'revoked: reload to approve a new session'));
      void openModal();
    } catch (e) {
      C.setChainStatus('error', (e as Error).message);
    }
  });
}
function closeModal() {
  modal?.remove();
  modal = null;
}

/** Mount the badge (call once in chain mode). */
export function mountChainUi() {
  if (!C.chainOn() || document.getElementById('chain-badge')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  badge = document.createElement('div');
  badge.id = 'chain-badge';
  badge.addEventListener('click', () => {
    const s = C.chainStatus().state;
    if (s === 'othertab') handlers.take();
    else if (s === 'loggedout' || s === 'error') handlers.login();
    else if ((s === 'connecting' || s === 'approve') && connectSince && Date.now() - connectSince > 25_000) {
      // stuck: forget this browser's chain data and start over (the account on chain is kept)
      C.chainResetBrowser();
      location.reload();
    } else if (s !== 'connecting' && s !== 'approve') void openModal();
  });
  document.body.appendChild(badge);
  renderBadge();
  C.onChain(() => {
    renderBadge();
    if (C.chainStatus().state === 'ready') void refreshSol();
  });
}
