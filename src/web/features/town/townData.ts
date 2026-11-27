// Landmarks in the town. pos = the plot on the top-down ground map (fractions of its width and height).
// open = has a working screen in this POC; the rest describe what the vision doc plans.
export interface BuildingInfo {
  id: string;
  name: string;
  /** top-down town: the plot centre on the ground map, as fractions of its width and height */
  pos: [number, number];
  open: boolean;
  desc: string;
  future?: string;
}



export const BUILDINGS: BuildingInfo[] = [
  {
    id: 'mine', name: 'เหมือง', pos: [0.24, 0.2], open: true,
    desc: 'ส่งฮีโร่ว่างมาขุดแร่ ผลิตต่อแม้ปิดเกม · แร่ใช้ทำตั๋ว อัปเกรดเมือง และเติมอนุสาวรีย์',
  },
  {
    id: 'shrine', name: 'ศาลเจ้า', pos: [0.5, 0.2], open: true,
    desc: 'ฮีโร่ว่างมาภาวนาจนได้คริสตัลจันทร์ (ทุก 12 ชม.) · คริสตัลใช้ปลดล็อกฮีโร่และอัปเกรดขั้นสูง',
  },
  {
    id: 'lumber', name: 'ลานตัดไม้', pos: [0.76, 0.2], open: true,
    desc: 'ส่งฮีโร่ว่างมาตัดไม้ ผลิตต่อแม้ปิดเกม · ไม้ใช้ทำตั๋ว อัปเกรดเมือง และเติมอนุสาวรีย์',
  },
  {
    id: 'tower', name: 'หอเวท', pos: [0.19, 0.81], open: false,
    desc: 'นักเวทของเมืองวิจัยสิ่งใหม่จากทรัพยากรที่หามาได้',
    future: 'วิจัยปลดล็อกสิ่งก่อสร้างและความสะดวก ไม่เพิ่มพลังในการสู้',
  },
  {
    id: 'hall', name: 'หอฮีโร่', pos: [0.21, 0.48], open: true,
    desc: 'ที่พักของฮีโร่ทุกตัวในคลัง ฮีโร่ตัวเดียวกันแรงเท่ากันทุกคน · ดูโปรไฟล์ ผงดาว และประวัติรอบที่เล่นของคุณได้ที่นี่',
  },
  {
    id: 'board', name: 'ป้ายประกาศ', pos: [0.79, 0.48], open: true,
    desc: 'กระดานผู้นำของนักสู้โมจิ ทั้งซีซั่นและวันนี้ · เร็วๆ นี้: คำสั่งประจำวันจากผู้ปกครอง arena',
    future: 'กฎประจำวันที่หมุนเวียน 20–30 แบบ เปลี่ยนว่าฮีโร่และแนว build ไหนเด่นในวันนั้น',
  },
  {
    id: 'market', name: 'ตลาด', pos: [0.81, 0.81], open: false,
    desc: 'ซื้อขายตั๋วและของกับผู้เล่นอื่น',
    future: 'ตั้งขายผ่านตลาดที่หักค่าธรรมเนียมและเก็บประวัติ ไม่มีการโอนตรงระหว่างบัญชี',
  },
  {
    id: 'arena', name: 'สนามประลอง', pos: [0.5, 0.48], open: true,
    desc: 'ทางเดียวที่จะได้ของจากผู้ปกครอง ชนะ 10 ครั้งก่อนเลือดหมด',
  },
];

export const BUILDING_BY_ID: Record<string, BuildingInfo> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
