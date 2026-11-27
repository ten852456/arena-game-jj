/**
 * Two languages: Thai (default) and English. Shared by the sim and the client.
 * `L(th, en)` picks the text for the current language. Only the browser changes the language
 * (client/lang.ts); the server and the scripts always stay Thai.
 */
export type Lang = 'th' | 'en';

let lang: Lang = 'th';

export const getLang = (): Lang => lang;
export const setLangValue = (l: Lang) => {
  lang = l;
};
export const L = (th: string, en: string) => (lang === 'en' ? en : th);
