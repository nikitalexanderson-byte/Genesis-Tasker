import type { PhysisKind, PhysisRecord, PhysisStore } from './types.ts';
import { validatePhysisRecord } from './validation.ts';
import type { Drug } from './care-domain.ts';
import { MAX_PHYSIS_PLAINTEXT_BYTES, validateVault, type PhysisVault } from './crypto.ts';
import type { WireRecord } from './store.ts';

// Covers the 32 MiB live-envelope quota plus CSV escaping and record metadata.
export const PHYSIS_IMPORT_BYTES = 128 * 1024 * 1024;
export const PHYSIS_IMPORT_RECORDS = 10000;
export const PHYSIS_BACKUP_ROWS = 50000; // Same upper bound as the paginated export reader; includes tombstones.
export function checkPhysisImportBytes(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > PHYSIS_IMPORT_BYTES) throw new Error('Файл превышает 128 МиБ.');
}
export type PhysisBackup = { format: 'physis-encrypted'; version: 1; owner: string; vault: PhysisVault; records: WireRecord[] };
export function parsePhysisBackup(value: unknown): PhysisBackup {
  const backup = value as PhysisBackup;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!backup || backup.format !== 'physis-encrypted' || backup.version !== 1 || !uuid.test(backup.owner) ||
      !Array.isArray(backup.records) || backup.records.length > PHYSIS_BACKUP_ROWS ||
      backup.records.filter(record => record && record.deletedAt === null).length > PHYSIS_IMPORT_RECORDS)
    throw new Error('Некорректная резервная копия или превышен предел записей.');
  validateVault(backup.vault);
  const ids = new Set<string>();
  for (const record of backup.records) {
    if (!record || !uuid.test(record.id) || ids.has(record.id) || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
        !Number.isSafeInteger(record.sequence) || record.sequence < 1 || typeof record.updatedAt !== 'string' ||
        (record.deletedAt !== null && (typeof record.deletedAt !== 'string' || record.envelope !== null)))
      throw new Error('Некорректная резервная копия или превышен предел записей.');
    ids.add(record.id);
    if (record.deletedAt === null) {
      const envelope = record.envelope;
      if (!envelope || envelope.version !== 1 || envelope.schemaVersion !== 1 || envelope.keyVersion !== backup.vault.keyVersion ||
          typeof envelope.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) ||
          typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 4 * Math.ceil(256 * 1024 / 3) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) throw new Error('PHYSIS_INVALID_ENVELOPE');
    }
  }
  return backup;
}
export function parsePhysisCsv(text: string): string[][] {
  checkPhysisImportBytes(new TextEncoder().encode(text).length);
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') { quoted = false; afterQuote = true; } else if (c === undefined) throw new Error('Незакрытая кавычка CSV.'); else field += c; }
    else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(field); field = ''; afterQuote = false;
      if (c !== ',') { if (row.some(v => v !== '')) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !field && !afterQuote) quoted = true;
    else if (afterQuote) throw new Error('Некорректная строка CSV после кавычки.');
    else field += c;
    if (rows.length > PHYSIS_IMPORT_RECORDS + 1 || row.length > 100 || field.length > 350000) throw new Error('Слишком большой импорт.');
  }
  return rows;
}
/** Spreadsheet cells cannot execute formula-prefixed user notes. No formula is evaluated on import. */
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportPhysisCsv(records: PhysisRecord[]) {
  return '\uFEFF' + [['id', 'kind', 'date', 'name', 'value', 'unit', 'status', 'schemaVersion', 'recordJSON'].map(csvCell).join(','), ...records.map(r => {
    const d = r.data as Record<string, unknown>;
    return [r.id, r.kind, d.day ?? d.date ?? '', d.name ?? d.label ?? '', d.value ?? d.quantity ?? '', d.unit ?? '', d.status ?? '', r.schemaVersion, JSON.stringify(r)].map(csvCell).join(',');
  })].join('\r\n');
}
export function parsePhysisRecords(text: string, format: 'json' | 'csv'): unknown[] {
  checkPhysisImportBytes(new TextEncoder().encode(text).length);
  if (format === 'json') {
    const input = JSON.parse(text);
    if (input?.format !== 'physis-plain' || input.version !== 1 || !Array.isArray(input.records) || input.records.length > PHYSIS_IMPORT_RECORDS) throw new Error('Ожидается экспорт Фюзиса версии 1.');
    return input.records;
  }
  const rows = parsePhysisCsv(text); const index = rows[0]?.indexOf('recordJSON');
  if (index === undefined || index < 0) throw new Error('Для общего CSV нужен столбец recordJSON. Для справочника препаратов выберите сопоставление колонок.');
  return rows.slice(1).map(row => { try { return JSON.parse(row[index]); } catch { return null; } });
}
export type ImportPreview = { records: PhysisRecord[]; errors: string[]; duplicates: number };
export function previewPhysisImport(values: unknown[], existing: PhysisRecord[], kind?: PhysisKind): ImportPreview {
  const result: ImportPreview = { records: [], errors: [], duplicates: 0 };
  const ids = new Set(existing.flatMap(r => [r.id, ...((r.data as { importIdentity?: { recordId?: string } }).importIdentity?.recordId ? [(r.data as { importIdentity: { recordId: string } }).importIdentity.recordId] : [])]));
  const names = new Set(existing.filter(r => ['food', 'drug', 'exercise'].includes(r.kind)).map(r => `${r.kind}:${String((r.data as { name?: string }).name ?? '').trim().toLocaleLowerCase()}`));
  const events = new Set(existing.filter(r => r.kind === 'intake').map(r => (r.data as { eventId: string }).eventId));
  values.forEach((value, index) => {
    if (!validatePhysisRecord(value) || kind && value.kind !== kind) { result.errors.push(`Строка ${index + 1}: неподдерживаемая схема, версия, единица или значение.`); return; }
    const name = `${value.kind}:${String((value.data as { name?: string }).name ?? '').trim().toLocaleLowerCase()}`;
    const eventId = value.kind === 'intake' ? (value.data as { eventId: string }).eventId : '';
    if (ids.has(value.id) || names.has(name) || eventId && events.has(eventId)) { result.duplicates++; return; }
    ids.add(value.id); if (['food', 'drug', 'exercise'].includes(value.kind)) names.add(name); if (eventId) events.add(eventId);
    result.records.push(structuredClone(value));
  });
  return result;
}
export function reidentifyImportedRecords(records: PhysisRecord[]) {
  const ids = new Map(records.map(r => [r.id, crypto.randomUUID()]));
  const referenceKeys = new Set(['id', 'foodId', 'drugId', 'exerciseId', 'programId', 'assignmentId', 'regimenId', 'copiedFrom']);
  const walk = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (key === 'eventId') {
        const separator = value.indexOf(':');
        if (separator > 0 && ids.has(value.slice(0, separator))) return `${ids.get(value.slice(0, separator))}${value.slice(separator)}`;
      }
      return referenceKeys.has(key) ? ids.get(value) ?? value : value;
    }
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, name === 'importIdentity' ? structuredClone(item) : walk(item, name)]));
    return value;
  };
  return records.map(record => {
    const mapped = walk(record) as PhysisRecord<Record<string, unknown>>;
    return { ...mapped, source: 'import' as const, data: { ...mapped.data, importIdentity: (record.data as { importIdentity?: { recordId: string } }).importIdentity ?? { recordId: record.id } } };
  });
}
export type PreparedPhysisImport = { records: PhysisRecord[]; confirmed: number };
export function preparePhysisImport(records: PhysisRecord[]): PreparedPhysisImport { return { records: reidentifyImportedRecords(records), confirmed: 0 }; }
/** Keep this plan in memory after failure: the next attempt uses the same IDs and resumes confirmed batches. */
export async function resumePhysisImport(plan: PreparedPhysisImport, store: Pick<PhysisStore, 'records' | 'status' | 'saveMany'>, onProgress: (confirmed: number, total: number) => void = () => {}) {
  const current = new Map(store.records.map(record => [record.id, record]));
  while (plan.confirmed < plan.records.length) {
    const batch: PhysisRecord[] = [];
    let requestBytes = 1024; // Request wrapper plus headroom; each change also reserves 1 KiB for metadata.
    for (const original of plan.records.slice(plan.confirmed, plan.confirmed + 20)) {
      // An interrupted import can already be visible and edited, even while offline.
      const record = current.get(original.id) ?? original;
      const plainBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
      if (plainBytes > MAX_PHYSIS_PLAINTEXT_BYTES) throw new Error('Запись слишком велика. Разделите данные на несколько записей.');
      const encryptedBytes = 4 * Math.ceil((plainBytes + 16) / 3) + 1024;
      if (requestBytes + encryptedBytes > 2 * 1024 * 1024) break;
      batch.push(record); requestBytes += encryptedBytes;
    }
    if (!(store.status === 'saved' && batch.every(record => current.has(record.id)))) await store.saveMany(batch);
    plan.confirmed += batch.length;
    onProgress(plan.confirmed, plan.records.length);
  }
}
export const DRUG_COLUMNS = ['name', 'brand', 'category', 'form', 'route', 'activeIngredients', 'amountPerUnit', 'activeUnit', 'concentration', 'concentrationUnit', 'packageSize', 'source', 'notes'] as const;
export function drugsFromCsv(rows: string[][], mapping: Record<string, string>): unknown[] {
  const headers = rows[0] ?? [];
  return rows.slice(1).map(row => {
    const get = (key: string) => row[headers.indexOf(mapping[key])] ?? '';
    const numeric = (key: string) => { const value = get(key); if (!value.trim()) return null; const number = Number(value.replace(',', '.')); return Number.isFinite(number) ? number : NaN; };
    const now = new Date().toISOString();
    const data: Drug = { name: get('name'), brand: get('brand'), category: (get('category') || 'supplement') as Drug['category'], form: get('form') || 'Другая', route: (get('route') || 'other') as Drug['route'],
      activeIngredients: get('activeIngredients'), amountPerUnit: numeric('amountPerUnit'), activeUnit: (get('activeUnit') || 'mg') as Drug['activeUnit'],
      concentration: numeric('concentration'), concentrationUnit: (get('concentrationUnit') || 'mg/ml') as Drug['concentrationUnit'], packageSize: get('packageSize'), source: get('source'), notes: get('notes'),
      favorite: false, archived: false, nutrients: [] };
    // Missing units with a numeric amount are errors, never silently assumed mg.
    if (data.amountPerUnit !== null && !get('activeUnit') || data.concentration !== null && !get('concentrationUnit')) return null;
    return { id: crypto.randomUUID(), kind: 'drug', schemaVersion: 1, createdAt: now, updatedAt: now, source: 'import', data };
  });
}
