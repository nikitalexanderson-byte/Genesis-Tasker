import { resolvedFeatureAccess } from './billing-trial';
import { dataTransferAllowed } from './data-transfer-access';
import type { FeatureAccess } from './feature-access';
import type { DiaryRecord } from './diary-storage';
import type { Language } from './i18n';
import { diaryCopy } from './diary-copy';
import dreamsCopy from './dream-journal-copy.json';
import copy from './dream-export-copy.json';

/** Elite and Elite+ receive the server's lifetime Business entitlement. */
export function dreamExportAllowed(access: FeatureAccess | undefined, now = Date.now()): boolean {
  const current = resolvedFeatureAccess(access);
  return Boolean(current && ['premium', 'business', 'premium4life'].includes(current.effectivePlan)
    && dataTransferAllowed(access, now));
}

/** Preserve saved versions and each writer's draft, without exporting ordinary diary notes. */
export function dreamExportRecords(records: readonly DiaryRecord[]): DiaryRecord[] {
  const versions = new Map<string, DiaryRecord>();
  for (const row of records) {
    if (!row.note.dream || !row.note.body.trim()) continue;
    const key = JSON.stringify([row.note.id, row.draftKey ?? null]);
    const previous = versions.get(key);
    if (!previous || row.note.updatedAt > previous.note.updatedAt) versions.set(key, row);
  }
  return [...versions.values()].sort((a, b) => b.note.dream!.day.localeCompare(a.note.dream!.day)
    || b.note.updatedAt.localeCompare(a.note.updatedAt));
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** A standalone, script-free document opens offline and can be printed or saved as PDF. */
export function buildDreamHistoryHtml(records: readonly DiaryRecord[], language: Language, savedAt: string): string {
  const text = copy[language], dreams = dreamsCopy[language], common = diaryCopy(language);
  const timestamp = (value: string) => `<time datetime="${escapeHtml(value)}">${escapeHtml(
    new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))
  )} UTC</time>`;
  const entries = dreamExportRecords(records);
  const articles = entries.map(({ note, draftKey, localOnly }) => {
    const flags = [draftKey ? common.draft : '', localOnly ? text.localOnly : '', note.archived ? common.archive : '',
      note.reaction === 'favorite' ? dreams.favorites : '', note.dream!.lucid ? dreams.lucid : ''].filter(Boolean);
    return `<article>
<p class="date">${escapeHtml(dreams.date)}: <time datetime="${escapeHtml(note.dream!.day)}">${escapeHtml(note.dream!.day)}</time></p>
<h2>${escapeHtml(note.title || dreams.record)}</h2>
${flags.length ? `<p class="flags">${flags.map(escapeHtml).join(' · ')}</p>` : ''}
<p class="dream-text">${escapeHtml(note.body)}</p>
<dl><div><dt>${escapeHtml(text.timeZone)}</dt><dd>${escapeHtml(note.dream!.timeZone)}</dd></div>
<div><dt>${escapeHtml(text.createdAt)}</dt><dd>${timestamp(note.createdAt)}</dd></div>
<div><dt>${escapeHtml(text.updatedAt)}</dt><dd>${timestamp(note.updatedAt)}</dd></div></dl>
</article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GENESIS · ${escapeHtml(dreams.history)}</title>
<style>
body{max-width:760px;margin:40px auto;padding:0 20px;font:17px/1.65 system-ui,sans-serif;color:#152b30;background:#fff}
h1{font-size:30px;line-height:1.25}h2{font-size:22px;line-height:1.35;margin:8px 0 12px}
article{padding:24px 0;border-top:1px solid #becbd0}.date,.flags,dl,.export-date{font-size:14px;color:#364e55}
.date{margin:0}.flags{font-weight:600}.dream-text{white-space:pre-wrap;overflow-wrap:anywhere}
dl{margin-top:24px}dl>div{display:flex;flex-wrap:wrap;gap:4px 12px}dt{font-weight:600}dd{margin:0}
@media print{body{max-width:none;margin:0}h2,.date,.flags{break-after:avoid}p{orphans:3;widows:3}}
</style></head><body><main><h1>GENESIS · ${escapeHtml(dreams.history)}</h1>
<p class="export-date">${escapeHtml(text.savedAt)}: ${timestamp(savedAt)}</p>
<p>${escapeHtml(dreams.total)}: ${new Set(entries.map(row => row.note.id)).size}</p>
${articles}</main></body></html>\n`;
}
