// Landmarks in the town. x = center position in the town world (pixels).
// open = has a working screen in this POC; the rest describe what the vision doc plans.
export interface BuildingInfo {
  id: string;
  name: string;
  x: number;
  open: boolean;
  desc: string;
  future?: string;
}

export const WORLD_W = 2400;

/** The giant mochi rabbit statue in the town square (decoration, not a building). */
export const RABBIT_X = 1475;

export const BUILDINGS: BuildingInfo[] = [
  {
    id: 'mine', name: 'เหมือง', x: 230, open: false,
    desc: 'ฮีโร่ที่ไม่ได้ลงแข่งมาขุดแร่และคริสตัลที่หายาก',
    future: 'ส่งฮีโร่ว่างมาขุดทรัพยากร ใช้สร้างเมือง เปิดฮีโร่ และเป็นโควตารอบของ bot',
  },
  {
    id: 'lumber', name: 'ลานตัดไม้', x: 530, open: false,
    desc: 'ไม้สำหรับสร้างและขยายเมือง',
    future: 'ฮีโร่ว่างออกไปตัดไม้ เก็บได้เรื่อยๆ แม้ปิดเกม',
  },
  {
    id: 'tower', name: 'หอเวท', x: 800, open: false,
    desc: 'นักเวทของเมืองวิจัยสิ่งใหม่จากทรัพยากรที่หามาได้',
    future: 'วิจัยปลดล็อกสิ่งก่อสร้างและความสะดวก ไม่เพิ่มพลังในการสู้',
  },
  {
    id: 'hall', name: 'หอฮีโร่', x: 1070, open: true,
    desc: 'ที่พักของฮีโร่ทุกตัวในคลัง ฮีโร่ตัวเดียวกันแรงเท่ากันทุกคน · ดูโปรไฟล์ ผงดาว และประวัติรอบที่เล่นของคุณได้ที่นี่',
  },
  {
    id: 'board', name: 'ป้ายประกาศ', x: 1320, open: true,
    desc: 'กระดานผู้นำของนักสู้โมจิ ทั้งซีซั่นและวันนี้ · เร็วๆ นี้: คำสั่งประจำวันจากผู้ปกครอง arena',
    future: 'กฎประจำวันที่หมุนเวียน 20–30 แบบ เปลี่ยนว่าฮีโร่และแนว build ไหนเด่นในวันนั้น',
  },
  {
    id: 'market', name: 'ตลาด', x: 1700, open: false,
    desc: 'ซื้อขายตั๋วและของกับผู้เล่นอื่น',
    future: 'ตั้งขายผ่านตลาดที่หักค่าธรรมเนียมและเก็บประวัติ ไม่มีการโอนตรงระหว่างบัญชี',
  },
  {
    id: 'arena', name: 'สนามประลอง', x: 2060, open: true,
    desc: 'ทางเดียวที่จะได้ของจากผู้ปกครอง ชนะ 8 ครั้งก่อนเลือดหมด',
  },
];

export const BUILDING_BY_ID: Record<string, BuildingInfo> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
