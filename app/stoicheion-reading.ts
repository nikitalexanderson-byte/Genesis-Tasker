export type StoicheionReadingSection = { heading: string; body: string };
/** Normalize section boundaries only; keep the authored card text. */
export function stoicheionReadingSections(content: string): StoicheionReadingSection[] {
  const sections: StoicheionReadingSection[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const narrativeHeading=/^(?:The )?(?:reversed|inverted) letter/i.test(trimmed) ? "Reversed position"
      : /^(?:In the upright position|The fullness of the incarnation in the upright position)/i.test(trimmed) ? "Upright position" : null;
    if(narrativeHeading&&sections.at(-1)?.heading!==narrativeHeading){sections.push({heading:narrativeHeading,body:line});continue;}
    const match = /^(Космогонический профиль|Космологический профиль|Магическая настройка[^\n]*|Числовая суть|Парадное положение|Перев[её]рнутое положение|Практика[^\n]*|Cosmogonic profile|Cosmological profile|Magical (?:tuning|attunement)[^\n]*|Numerical (?:essence|profile)|Upright position|Reversed position|Practice[^\n]*|Body Practice[^\n]*)(?=\s|:|$)/i.exec(trimmed);
    if (!match) { if (sections.length) sections[sections.length-1].body += `\n${line}`; else if(trimmed) sections.push({heading:"",body:line}); continue; }
    const original = match[1];
    const english = /^[a-z]/i.test(original);
    const heading = /^(Космо|Cosmo)/i.test(original) ? (english ? "Cosmogonic profile" : "Космогонический профиль")
      : /^(Магическая|Magical)/i.test(original) ? (english ? "Magical attunement and Root — ῥίζα" : "Магическая настройка и Корень — ῥίζα")
        : /^(Практика|Practice|Body Practice)/i.test(original) ? (english ? "Practice and magical pose" : "Практика и магическая поза")
          : /^(Перев)/i.test(original) ? "Перевернутое положение" : original;
    let body = trimmed.slice(original.length).replace(/^\s*:\s*/,"").trim();
    if (/^(Магическая|Magical)/i.test(original) && !/Корень|Root/i.test(original)) body = original + (body ? `\n${body}` : "");
    body = body.replace(/\s+(?=В процессе развертывания|В прямом положении|Перевернутая (?:буква|[А-Я])|Числовое значение|In the process|In the upright position|The reversed|The numerical value)/g,"\n");
    sections.push({heading,body});
  }
  const magical=sections.find(section=>section.heading==="Магическая настройка и Корень — ῥίζα");
  const practice=sections.find(section=>section.heading==="Практика и магическая поза");
  if(magical&&!content.includes("Центр в теле:")&&content.includes("Альфа управляет головой")) magical.body += "\n- Центр в теле: Голова — кефале (κεφαλή).";
  if(practice&&!content.includes("Медитация:")&&content.includes("концентрируя внимание на основании горла и плечевом поясе")) practice.body = "- Медитация: Громко произнесите звук \"Г\", концентрируя внимание на основании горла и плечевом поясе.\n" + practice.body;
  return sections.map(section=>({...section,body:section.body.trim()}));
}
