import { useEffect, useState } from "react";
import type { Language } from "./i18n";
import type { TheokyklosSegmentId } from "./theokyklos-data";
import { greekIsopsephy, restorationRoot, restorationTrace } from "./stoicheion-restoration-math";
import metadata from "./olympian-knowledge.json";
import russian from "./olympian-knowledge-copy/ru.json";
import english from "./olympian-knowledge-copy/en.json";

export type KnowledgeCopy = Readonly<Record<string, string>>;
export type KnowledgeWord = Readonly<{
  greek: string; meaning: string; note: string;
  relation: "exact" | "caseMatch" | "rootMatch" | "meaning" | "sound";
  reference?: string;
}>;
export type DeityKnowledge = Readonly<{
  sectorId: TheokyklosSegmentId; relatedIds: string[]; sourceIds: string[];
  ancient: string; sacred: string; formula: string; meaning: string; bridge: string; limits: string;
  variants: { greek: string; label: string }[];
  words: KnowledgeWord[]; situations: { title: string; body: string }[];
}>;
export const OLYMPIAN_KNOWLEDGE = metadata as {
  version: number; deities: Record<string, DeityKnowledge>;
  sources: { id: string; url: string; author: string; work: string; passage: string }[];
  sectors: { id: TheokyklosSegmentId; title: string; patrons: string; names: string[] }[];
  numbers: { value: number; body: string; sourceIds: string[] }[];
};

// Only the selected reading language is fetched. Russian and English also give
// an immediate first render; other locales never display an English substitute.
const copies = new Map<Language, KnowledgeCopy>([["ru", russian], ["en", english]]);
const pending = new Map<Language, Promise<KnowledgeCopy>>();
const loaders = {
  el: () => import("./olympian-knowledge-copy/el.json"),
  de: () => import("./olympian-knowledge-copy/de.json"),
  fr: () => import("./olympian-knowledge-copy/fr.json"),
  es: () => import("./olympian-knowledge-copy/es.json"),
  it: () => import("./olympian-knowledge-copy/it.json"),
  pt: () => import("./olympian-knowledge-copy/pt.json"),
  pl: () => import("./olympian-knowledge-copy/pl.json"),
  sr: () => import("./olympian-knowledge-copy/sr.json"),
  uk: () => import("./olympian-knowledge-copy/uk.json"),
  zh: () => import("./olympian-knowledge-copy/zh.json"),
  tr: () => import("./olympian-knowledge-copy/tr.json"),
  ja: () => import("./olympian-knowledge-copy/ja.json"),
};
export function loadOlympianCopy(language: Language): Promise<KnowledgeCopy> {
  const cached = copies.get(language);
  if (cached) return Promise.resolve(cached);
  let request = pending.get(language);
  if (!request) {
    request = loaders[language as keyof typeof loaders]().then(module => {
      copies.set(language, module.default);
      pending.delete(language);
      return module.default;
    }).catch(error => { pending.delete(language); throw error; });
    pending.set(language, request);
  }
  return request;
}
export function useOlympianCopy(language: Language) {
  const [result, setResult] = useState<{ language: Language; copy?: KnowledgeCopy; error?: boolean }>(() => ({ language, copy: copies.get(language) }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (copies.has(language)) return;
    let active = true;
    void loadOlympianCopy(language).then(copy => {
      if (active) setResult({ language, copy });
    }).catch(() => { if (active) setResult({ language, error: true }); });
    return () => { active = false; };
  }, [language, attempt]);
  return {
    copy: copies.get(language) ?? (result.language === language ? result.copy : undefined),
    error: result.language === language && Boolean(result.error),
    retry: () => { setResult({ language }); setAttempt(value => value + 1); },
  };
}

export function normalizeOlympianSearch(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/ς/g, "σ").trim();
}
export function olympianCalculation(greek: string) {
  const letters = [...greek.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()];
  const summands = letters.map(greekIsopsephy);
  const number = greekIsopsephy(greek);
  return { letters, summands, number, root: restorationRoot(number), trace: restorationTrace(number) };
}
export function olympianFactorization(number: number): string {
  const parts: string[] = [];
  for (let divisor = 2; divisor * divisor <= number; divisor++) {
    let power = 0;
    while (number % divisor === 0) { number /= divisor; power++; }
    if (power) parts.push(power > 1 ? `${divisor}^${power}` : `${divisor}`);
  }
  if (number > 1) parts.push(String(number));
  return parts.join(" × ");
}
