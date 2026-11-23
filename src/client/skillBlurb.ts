/**
 * One line per skill: what makes it different from every other skill (playtest 2026-11-23: "skills read alike, I can't
 * tell which is good"). Shown at the top of the skill popover. [Thai, English]
 */
import { L } from '../i18n';

const B: Record<string, [string, string]> = {
  // ⚔ hit
  strike: ['ตีธรรมดาที่ไว้ใจได้ ใช้บ่อย เข้ากับทุกอย่างที่เพิ่มดาเมจต่อครั้ง', 'A plain, reliable hit used often; loves anything that adds damage per hit'],
  charge: ['ไม่ตีเอง แต่ทำให้การตีแรงครั้งถัดไป (ตัวไหนก็ได้) แรงขึ้นเป็นเท่าตัว', 'Doesn’t hit: your next big hit (any skill) multiplies'],
  heavy: ['ตีช้าแต่หนัก ทะลุโล่ครึ่งหนึ่ง: ไว้แก้ทางสายโล่', 'Slow and heavy, half-pierces shields: the answer to shield builds'],
  execute: ['ยิ่งศัตรูเลือดน้อยยิ่งแรง: ตัวปิดเกม', 'Stronger the lower the enemy’s HP: the finisher'],
  // 💨 dodge
  jab: ['แทงเบาๆ แต่ได้แต้มหลบทุกครั้ง: การตีถัดไปของศัตรูแค่เฉียด', 'A light stab that gives a dodge charge every time'],
  riposte: ['ยิ่งเก็บแต้มหลบไว้มาก ยิ่งสวนแรง', 'Hits harder for every dodge charge you hold'],
  sidestep: ['หลบ + สะบัดไฟ/พิษทิ้ง: ไว้แก้สายไฟและพิษ', 'Dodge + shake off burn/poison: answers burn and poison'],
  flurry: ['ฟันรัวหลายครั้ง แต่ละครั้งได้พลังเพิ่มเต็มๆ', 'Many quick slashes, each one gets your full power bonus'],
  // 🛡 shield
  shield: ['โล่ก้อนใหญ่ราคาถูก: พื้นฐานของสายโล่', 'A big, cheap shield: the base of the shield line'],
  stoneskin: ['ได้โล่แล้วกระแทกด้วยโล่ที่มี ยิ่งโล่หนายิ่งเจ็บ', 'Gains shield, then bashes with it: thicker shield, bigger hit'],
  cleanse: ['ลบไฟ พิษ ช้า แช่แข็ง และทำงานทันทีเมื่อคุณโดนคุม', 'Removes burn, poison, slow and freeze; fires at once when you get controlled'],
  bulwark: ['กระแทกด้วยโล่: ยิ่งโล่หนายิ่งแรง', 'Shield slam: the thicker your shield, the bigger the hit'],
  // ❤ heal
  feast: ['ฟื้น + พลังถาวร + ล้างไฟ/พิษ: กินไปโตไป', 'Heal + permanent power + clear burn/poison: eat and grow'],
  train: ['ทุกครั้งที่ใช้ การตีทุกตัวแรงขึ้นถาวร ยิ่งสู้นานยิ่งคุ้ม', 'Every use makes all your hits stronger for good'],
  mend: ['ฟื้นก้อนใหญ่ + ใจเหล็ก: ทนการคุม', 'A big heal + iron will: shrugs off control'],
  rampage: ['ตีรัว + ดูดเลือดทุกครั้ง', 'Rapid hits that drain HP every time'],
  // 🔥 burn
  ignite: ['จุดไฟที่ไม่สนโล่ ซ้อนกันได้หลายกอง', 'Lights a burn that ignores shields; burns stack'],
  blaze: ['ลูกไฟที่แรงขึ้นตามจำนวนกองไฟบนศัตรู', 'A fireball that grows with every burn on the enemy'],
  scorch: ['ไฟหลายกอง + ศัตรูฟื้นน้อยลง: ไว้แก้สายฮีล', 'Many small burns + cuts healing: answers heal builds'],
  inferno: ['ระเบิดไฟที่ยังค้างบนศัตรูออกมาทันที', 'Detonates the burn still on the enemy, right now'],
  // ☠ poison
  venom: ['ตีแล้วทิ้งพิษนานๆ ที่หลบไม่ได้', 'A hit that leaves long poison that can’t be dodged'],
  plague: ['ระเบิดพิษที่สะสมไว้ ทะลุโล่ทั้งหมด', 'Bursts the stacked poison and fully pierces shields'],
  thorns: ['หนาม: ใครตีเราเจ็บกลับ และฟื้นได้แค่ครึ่งเดียว', 'Thorns: whoever hits you gets hurt back and heals only half'],
  spikewall: ['ยิ่งมีหนามมากยิ่งตีแรง แล้วใส่พิษ', 'Hits harder the more thorns you have, then poisons'],
  // ❄ ice
  frost: ['ลูกน้ำแข็ง: แช่แข็งให้ skill ศัตรูหยุดนับคูลดาวน์', 'An ice ball that stops the enemy’s cooldowns'],
  icelance: ['ทวนที่แรงขึ้นมากใส่ศัตรูที่แข็งอยู่', 'A lance that hits much harder on a frozen enemy'],
  glacier: ['แช่แข็งก่อน แล้วตีทะลุโล่: ไว้แก้สายโล่', 'Freezes first, then pierces shields: answers shield builds'],
  shatter: ['ทุบศัตรูที่แข็งอยู่แรงเกือบสองเท่า', 'Smashes a frozen enemy for almost double'],
  // 🌪 wind
  chill: ['ตี + ทำให้คูลดาวน์ทุกตัวของศัตรูเดินช้า', 'A hit that slows every enemy cooldown'],
  tailwind: ['เร่งคูลดาวน์ตัวเองทุกตัว + ล้างไฟ/พิษ', 'Speeds up all your cooldowns + clears burn/poison'],
  dispel: ['ลบบัฟศัตรู (พลัง หนาม โล่) + ลดการฟื้น', 'Strips enemy buffs (power, thorns, shield) + cuts healing'],
  timewarp: ['ตีแล้วดึงคูลดาวน์ศัตรูถอยหลัง', 'A hit that pushes the enemy’s cooldowns back'],
  // 💰 gold
  coin: ['ยิ่งลงทองกับ skill (อัปเกรด) มาก ยิ่งปาแรง', 'The more gold you put into skills, the harder it hits'],
  bribe: ['โล่ทองตามมูลค่า build + ถ่วงคูลดาวน์ศัตรู', 'A gold shield worth your build + delays the enemy'],
  jackpot: ['ช้ามาก แต่ตีก้อนเดียวเท่ามูลค่า build และหลบไม่ได้', 'Very slow, but one sure hit worth your whole build'],
  goldrain: ['ฝนเหรียญ 3 เม็ด แต่ละเม็ดแรงตามมูลค่า build', '3 coin hits, each one grows with your build worth'],
  // ⏳ time
  tick: ['ยิ่งไฟต์ยาว ยิ่งตีแรงขึ้นทุกวินาที', 'Hits harder every second the fight goes on'],
  patience: ['โล่ที่หนาขึ้นตามเวลา + ทนการคุม: ไว้ซื้อเวลา', 'A shield that grows with time + resists control'],
  pendulum: ['ยิ่งใช้ยิ่งเร็ว: คูลดาวน์สั้นลงทุกครั้งที่ทำงาน', 'Speeds up: its cooldown shrinks every time it works'],
  ageless: ['ตีแรงขึ้นทุกวินาที เร็วกว่า skill เวลาตัวไหน', 'Grows every second, faster than any other time skill'],
  // ⚙ general
  ironwill: ['ไม่มีดาเมจ แต่การคุมที่โดนอ่อนลงมากทั้งไฟต์', 'No damage, but control on you is much weaker all fight'],
  gear: ['ไม่ทำอะไรเอง: สั่ง skill ข้างบน/ล่างให้ทำงานถี่ๆ', 'Does nothing itself: makes the skills above/below fire often'],
  overclock: ['สั่ง skill ข้างบนและล่างทำงานพร้อมกันทันที', 'Fires both neighbours at once, right now'],
};

export const skillBlurb = (id: string) => {
  const b = B[id];
  return b ? L(b[0], b[1]) : '';
};
export const hasBlurb = (id: string) => !!B[id];
