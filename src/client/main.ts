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
    mute.textContent = off ? '🔇' : '🔊';
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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER }, // #stage always has the game's aspect (layout.ts)
    scene: [TownScene, CombatScene], // both start; the UI keeps one awake and sleeps the other
  });
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
  initGuide();
  mountLangSwitch();
  mountMute();
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
factory.text = function (this: unknown, ...a: unknown[]) {
  return addText.apply(this, a).setResolution(ZOOM);
};

void boot();
