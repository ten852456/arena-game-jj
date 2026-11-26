// Shared HTML helpers. One escape for every page (it was copied into 14 files, in 4 slightly different versions,
// some without > or ' : every text that goes into innerHTML passes through this one).
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
