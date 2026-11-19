import Phaser from 'phaser';
import { initAudio, music } from './audio';
import { CombatScene, H, W, sceneReady } from './combatScene';
import { TownScene, townReady } from './townScene';
import { initTutorial } from './tutorial';
import { startUI, type Stage } from './ui';
import { ZOOM } from './view';
import './style.css';

async function boot() {
  initAudio({ uiSounds: true }); // sound starts after the first tap/click (autoplay rules)
  music('town');
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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene: [TownScene, CombatScene], // both start; the UI keeps one awake and sleeps the other
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
  initTutorial();
}

// Text is rasterised at ZOOM x so it stays sharp on the zoomed cameras.
type TextFactory = { text: (...a: unknown[]) => Phaser.GameObjects.Text };
const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as TextFactory;
const addText = factory.text;
factory.text = function (this: unknown, ...a: unknown[]) {
  return addText.apply(this, a).setResolution(ZOOM);
};

void boot();
