/** Format only newly dictated text; existing diary contents are never rewritten. */
export function formatDictation(text: string, language: string, final = true): string {
  let value = text.replace(/[\t \u00a0]+/gu, ' ').replace(/ +([,.;:!?…，。！？；：])/gu, '$1').trim();
  if (!value) return '';
  if (!/^(?:https?:\/\/|www\.|[^\s@]+@)/iu.test(value)) {
    value = value.replace(/^([\p{Ps}\p{Pi}"']*)(\p{Ll})/u, (_, lead: string, letter: string) => lead + letter.toLocaleUpperCase(language));
  }
  if (final && !/[.!?…,:;。！？；：][\p{Pe}\p{Pf}"']*$/u.test(value)) {
    value = value.replace(/[\p{Pe}\p{Pf}"']*$/u, (closing: string) => (/^(?:zh|ja)(?:-|$)/u.test(language) ? '。' : '.') + closing);
  }
  return value;
}

export function appendDictation(body: string, phrase: string, language: string): string {
  if (!phrase) return body;
  if (!body || /\s$/u.test(body)) return body + phrase;
  const joinedScript = /^(?:zh|ja)(?:-|$)/u.test(language) && !/[A-Za-z0-9]$/u.test(body);
  return body + (joinedScript ? '' : ' ') + phrase;
}

export function dictationLocale(language: string): string {
  const regions: Record<string, string> = {ru:'RU',en:'US',el:'GR',de:'DE',fr:'FR',es:'ES',it:'IT',pt:'PT',pl:'PL',sr:'RS',uk:'UA',zh:'CN',tr:'TR',ja:'JP'};
  return regions[language] ? `${language}-${regions[language]}` : language;
}
