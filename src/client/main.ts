import Phaser from 'phaser';
import { CombatScene, H, W, sceneReady } from './combatScene';
import { TownScene, townReady } from './townScene';
import { initTutorial } from './tutorial';
import { initGuide, openHelp } from './guide';
import { startUI, type Stage } from './ui';
import { ZOOM } from './view';
import { initLang, mountLangSwitch, onLang } from './lang';
import { getLang, L } from '../i18n';
import { getAudioSettings, initAudio, music, setLang as setVoiceLang, toggleMuted } from './audio';
import './style.css';
import './chain.css';
import './layout.css';
import './shopux.css';
import { initLayout, setGameRefresh } from './layout';
import { mountSoundPanel } from './soundPanel';
import { initInfoMode } from './infoMode';
import { icon, initIcons } from './icons';
import './theme.css'; // the Mochi Moon look: loaded last so it wins
import './reward.css';
import './runend.css'; // end of run: after theme.css so it wins
import './depth.css'; // relics, stars, marks, branch picker, build card, codex
import './pages.css'; // profile name card, leaderboard
import './arenaux.css'; // arena UX pass: decluttered shop and fight in simple mode, detail sheet, coach marks
import './pickux.css'; // card hero select over the arena: radar, platform, Start
import { initCodex } from './codex';
import { mountFeedback } from './feedback';
import { deviceKind, track } from './track';
import { playerId } from './views/meta';
import { initDepthArt } from './depthArt';
import { attachPerf, bootProfile, loopLimit } from './perf';
import './perf.css'; // graphics tiers: after every other sheet so it wins

initIcons();

initLang();
initLayout();
// voice lines follow the game language (English UI → English announcer)
setVoiceLang(getLang());
onLang((l) => setVoiceLang(l));
initAudio({ uiSounds: true }); // sound starts after the first tap/click (autoplay rules)
music('town');

/** Sound on/off button in the header, after the language switch (never on top of it). */
function mountMute() {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.mute-btn')) return;
  const mute = document.createElement('button');
  mute.className = 'mute-btn small ghost';
  mute.type = 'button';
  mute.dataset.sfx = 'none';
  const paint = () => {
    const off = getAudioSettings().muted;
    mute.innerHTML = icon(off ? 'mute' : 'speaker');
    const label = off ? L('เปิดเสียง', 'Sound on') : L('ปิดเสียง', 'Sound off');
    mute.setAttribute('aria-label', label);
    mute.title = label;
    mute.setAttribute('aria-pressed', String(off));
  };
  let panel: { refresh: () => unknown } | undefined;
  mute.addEventListener('click', () => {
    toggleMuted();
    paint();
    panel?.refresh();
  });
  onLang(paint);
  paint();
  header.appendChild(mute);
  panel = mountSoundPanel(paint); // 🎚 volume sliders next to the mute button
}

async function boot() {
  // Make sure the Thai font is ready before Phaser draws canvas text.
  try {
    await Promise.race([document.fonts.load('20px Kanit'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* fall back to system font */
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'stage',
    width: W * ZOOM,
    height: H * ZOOM,
    backgroundColor: '#231c48',
    antialias: true,
    fps: { limit: loopLimit(bootProfile) }, // graphics tier (perf.ts): low caps at 30 fps
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER }, // #stage always has the game's aspect (layout.ts)
    scene: [TownScene, CombatScene], // both start; the UI keeps one awake and sleeps the other
  });
  attachPerf(game); // frame cap follows the tier; auto mode drops a tier if the frame rate stays low
  // re-read #stage's size first: refresh() alone would scale to the stale parent size
  setGameRefresh(() => {
    game.scale.getParentBounds();
    game.scale.refresh();
  });
  const [town, combat] = await Promise.all([townReady, sceneReady]);
  const stage: Stage = {
    town,
    combat,
    show(key) {
      const other = key === 'town' ? 'combat' : 'town';
      if (!game.scene.isSleeping(other)) game.scene.sleep(other);
      if (game.scene.isSleeping(key)) game.scene.wake(key);
    },
  };
  startUI(stage);
  initTutorial({ onHelp: openHelp });
  initCodex(); // 📖 คู่มือ in the header + every [data-codex] link
  initDepthArt(); // painted depth frames (border-image variables)
  initGuide();
  mountLangSwitch();
  initInfoMode(); // simple / detailed skill info: ⓘ in the header, Alt to peek
  mountMute();
  mountFeedback(); // 💬 in the header (wide screens) + the announcement banner
  playerId(); // make sure the anonymous player id exists, so the open is counted per player
  track('game_open', { lang: getLang(), device: deviceKind() });
  paintTagline();
  onLang(() => {
    town.refreshLabels();
    paintTagline();
  });
}

/** The small line next to the logo in the header. */
function paintTagline() {
  const small = document.querySelector('header small');
  if (small) small.textContent = L('ศึกโมจิใต้แสงจันทร์ · prototype', 'Mochi battles under the moon · prototype');
}

// Text is rasterised at ZOOM x so it stays sharp on the zoomed cameras.
type TextFactory = { text: (...a: unknown[]) => Phaser.GameObjects.Text };
const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as TextFactory;
const addText = factory.text;
// Phaser measures text height with "|MÉqs", which cuts off Thai marks above and below the line (the ้ in แพ้):
// measure with tall Thai marks too.
const TEST = '|MÉqsแพ้ชนะปุ่มฎฐิ์ืู';
factory.text = function (this: unknown, ...a: unknown[]) {
  const style = (a[3] ?? {}) as Record<string, unknown>;
  if (!style.testString) a[3] = { ...style, testString: TEST };
  return addText.apply(this, a).setResolution(ZOOM);
};

void boot();
