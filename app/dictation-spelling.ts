/** Optional, free spelling checks for newly dictated phrases only. No account
 * credentials, request logs, persistent cache, or paid-service fallback. */
const SPELLING_ENDPOINT = "https://speller.yandex.net/services/spellservice.json/checkText";
const MAX_INPUT = 4_000;
const MAX_REPLY_BYTES = 65_536;
const TIMEOUT_MS = 2_200;
const LETTERS = /^\p{L}+$/u;
const LATIN = /^\p{Script=Latin}+$/u;
const CYRILLIC = /^\p{Script=Cyrillic}+$/u;

type SpellingLanguage = "ru" | "en" | "uk";
type SpellingResult = {text: string; available: boolean};
type Correction = {start: number; end: number; replacement: string};

function spellingLanguage(language: string): SpellingLanguage | null {
  const locale = language.trim().toLowerCase();
  if (!/^[a-z]{2}(?:[-_][a-z]{2})?$/.test(locale)) return null;
  const base = locale.slice(0, 2);
  return base === "ru" || base === "en" || base === "uk" ? base : null;
}

export function supportedSpellingLanguage(language: string): boolean {
  return spellingLanguage(language) !== null;
}

/** Adjacent transpositions count as one typo; other large word changes are
 * intentionally left to the author rather than treated as spelling fixes. */
function plausibleSuggestion(word: string, suggestion: string, language: SpellingLanguage): boolean {
  if (!LETTERS.test(word) || !LETTERS.test(suggestion) || word.length > 80 || suggestion.length > 80) return false;
  if (!(LATIN.test(word) && LATIN.test(suggestion)) && !(CYRILLIC.test(word) && CYRILLIC.test(suggestion))) return false;
  const source = Array.from(word.toLocaleLowerCase(language));
  const target = Array.from(suggestion.toLocaleLowerCase(language));
  const limit = Math.min(2, Math.max(1, Math.floor(Math.max(source.length, target.length) / 4)));
  if (Math.abs(source.length - target.length) > limit) return false;
  const distance = Array.from({length: source.length + 1}, () => new Array<number>(target.length + 1).fill(0));
  for (let i = 0; i <= source.length; i++) distance[i][0] = i;
  for (let j = 0; j <= target.length; j++) distance[0][j] = j;
  for (let i = 1; i <= source.length; i++) for (let j = 1; j <= target.length; j++) {
    distance[i][j] = Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1,
      distance[i - 1][j - 1] + (source[i - 1] === target[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && source[i - 1] === target[j - 2] && source[i - 2] === target[j - 1]) {
      distance[i][j] = Math.min(distance[i][j], distance[i - 2][j - 2] + 1);
    }
  }
  return distance[source.length][target.length] <= limit;
}

function applySpellingReply(text: string, reply: unknown, language: SpellingLanguage): string {
  if (!Array.isArray(reply) || reply.length > 512) throw new Error("INVALID_SPELLING_REPLY");
  const corrections: Correction[] = [];
  const ranges: {start: number; end: number}[] = [];
  for (const value of reply) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SPELLING_REPLY");
    const row = value as Record<string, unknown>;
    const {code, pos, len, word, s: suggestions} = row;
    if (!Number.isInteger(code) || ![1, 2, 3].includes(code as number)
      || !Number.isInteger(pos) || !Number.isInteger(len) || (pos as number) < 0 || (len as number) <= 0
      || typeof word !== "string" || word.length !== len || (pos as number) + (len as number) > text.length
      || text.slice(pos as number, (pos as number) + (len as number)) !== word
      || !Array.isArray(suggestions) || suggestions.length > 32 || suggestions.some(suggestion => typeof suggestion !== "string")) {
      throw new Error("INVALID_SPELLING_REPLY");
    }
    const start = pos as number, end = start + (len as number);
    if (LETTERS.test(Array.from(text.slice(0, start)).at(-1) ?? "") || LETTERS.test(Array.from(text.slice(end))[0] ?? "")) {
      throw new Error("INVALID_SPELLING_REPLY");
    }
    ranges.push({start, end});
    // Repeat-word removal and multiword/ambiguous rewrites are outside this helper.
    if (code === 2) continue;
    const candidates = [...new Set((suggestions as string[]).filter(suggestion => plausibleSuggestion(word, suggestion, language)))];
    if (candidates.length === 1 && candidates[0] !== word) corrections.push({start, end, replacement: candidates[0]});
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) throw new Error("INVALID_SPELLING_REPLY");
  // Offsets refer to the original phrase, so apply replacements from the end.
  corrections.sort((a, b) => b.start - a.start);
  let corrected = text;
  for (const correction of corrections) corrected = corrected.slice(0, correction.start) + correction.replacement + corrected.slice(correction.end);
  return corrected;
}

async function spellingReply(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) throw new Error("SPELLING_UNAVAILABLE");
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_REPLY_BYTES) throw new Error("SPELLING_REPLY_LIMIT");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("INVALID_SPELLING_REPLY");
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancelReader, {once: true});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) throw new Error("SPELLING_ABORTED");
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REPLY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("SPELLING_REPLY_LIMIT");
      }
      chunks.push(next.value);
    }
  } finally { signal.removeEventListener("abort", cancelReader); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}

/** Call only after the person enables the disclosed external spelling option.
 * Abort or any transport/validation failure always returns the original phrase. */
export async function correctDictationSpelling(text: string, language: string, signal?: AbortSignal): Promise<SpellingResult> {
  const fallback: SpellingResult = {text, available: false};
  const lang = spellingLanguage(language);
  if (lang === null || text.length > MAX_INPUT || signal?.aborted) return fallback;
  if (text.trim() === "") return {text, available: true};
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = setTimeout(cancel, TIMEOUT_MS);
  signal?.addEventListener("abort", cancel, {once: true});
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("SPELLING_ABORTED"));
    controller.signal.addEventListener("abort", rejectAbort, {once: true});
  });
  if (signal?.aborted) cancel();
  try {
    const operation = (async () => {
      const response = await fetch(SPELLING_ENDPOINT, {
        method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
        headers: {"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
        body: new URLSearchParams({text, lang, options: "6", format: "plain"}), signal: controller.signal,
      });
      const reply = await spellingReply(response, controller.signal);
      if (controller.signal.aborted || signal?.aborted) return fallback;
      return {text: applySpellingReply(text, reply, lang), available: true};
    })();
    return await Promise.race([operation, cancelled]);
  } catch {
    controller.abort();
    return fallback;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}
