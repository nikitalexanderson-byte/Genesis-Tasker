import type { DailyAdvice } from './daily-advice';

export const DIARY_COLORS = ['sage', 'sand', 'rose', 'sky'] as const;
export type DiaryColor = typeof DIARY_COLORS[number];
export type DiaryNote = {
  version: 1; id: string; title: string; body: string; color: DiaryColor;
  customColor?: string;
  dream?: { day: string; timeZone: string; lucid?: boolean };
  createdAt: string; updatedAt: string; archived: boolean; pinned: boolean;
  reaction: 'favorite' | 'dislike' | null; advice?: DailyAdvice;
};
export type DiaryCategory = 'personal' | 'saved';

/** Existing encrypted provenance is enough; no migration or text guessing. */
export function diaryNoteCategory(note: Pick<DiaryNote, 'advice' | 'dream'>): DiaryCategory | null {
  if (note.dream) return null;
  return note.advice ? 'saved' : 'personal';
}
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
/** Reject unknown schemas rather than rewriting future clients' data. */
export function validateDiaryNote(value: unknown): DiaryNote {
  const note = value as DiaryNote;
  if (!note || note.version !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(note.id)
    || typeof note.title !== 'string' || note.title.length > 200
    || typeof note.body !== 'string' || note.body.length > 30000 || !note.body.trim()
    || !DIARY_COLORS.includes(note.color) || (note.customColor != null && !isDiaryCustomColor(note.customColor))
    || !date(note.createdAt) || !date(note.updatedAt)
    || typeof note.archived !== 'boolean' || typeof note.pinned !== 'boolean'
    || ![null, 'favorite', 'dislike'].includes(note.reaction)
    || (note.reaction === 'dislike' && !note.archived)) throw new Error('DIARY_INVALID_NOTE');
  if (note.dream && (!validDreamDay(note.dream.day) || typeof note.dream.timeZone !== "string" || note.advice
    || note.dream.lucid !== undefined && typeof note.dream.lucid !== 'boolean')) throw new Error("DREAM_INVALID_NOTE");
  if (note.advice && (typeof note.advice.id !== 'string' || !note.advice.id || typeof note.advice.body !== 'string'
    || typeof note.advice.language !== 'string' || !Array.isArray(note.advice.categories) || !Array.isArray(note.advice.sources)
    || note.advice.sources.some(source => typeof source.work !== 'string' || !['quote','inspired'].includes(source.kind)))) throw new Error('DIARY_INVALID_ADVICE');
  return structuredClone(note);
}
export function validDreamDay(day: unknown): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "0001-01-01") return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
}
export function isDiaryCustomColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
}
/** Match Android's readable black/white foreground on arbitrary palette colors. */
export function diaryCustomInk(color: string): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000000' : '#ffffff';
}
export function newDiaryNote(body = '', title = ''): DiaryNote {
  const now = new Date().toISOString();
  return { version: 1, id: crypto.randomUUID(), title, body, color: 'sage', createdAt: now, updatedAt: now, archived: false, pinned: false, reaction: null };
}
export function reactToAdvice(advice: DailyAdvice, id: string, reaction: 'favorite' | 'dislike', previous?: DiaryNote): DiaryNote {
  const note = previous ?? { ...newDiaryNote(advice.body, (advice.title ?? '').slice(0, 200)), id, advice: structuredClone(advice) };
  return validateDiaryNote({ ...note, reaction: previous?.reaction === reaction ? null : reaction,
    archived: reaction === 'dislike' ? previous?.reaction !== 'dislike' : false, updatedAt: new Date().toISOString() });
}
export function restoreDiaryNote(note: DiaryNote): DiaryNote {
  return { ...note, archived: false, reaction: note.reaction === 'dislike' ? null : note.reaction, updatedAt: new Date().toISOString() };
}
