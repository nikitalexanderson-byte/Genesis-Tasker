import type { CustomMetricDefinition } from './custom-metric-domain';
import type { ReferenceCatalog } from './reference-catalog-domain';
import type { CalendarMode } from '../calendar-data';
import type { CalendarContext } from '../calendar-context';

export type PhysisKind = 'exercise' | 'program' | 'assignment' | 'session' | 'food' | 'recipe' | 'meal' | 'nutrition-profile' | 'diet-template' | 'drug' | 'regimen' | 'intake' | 'measurement' | 'settings';
export type PhysisRecord<T = unknown> = {
  id: string; kind: PhysisKind; schemaVersion: 1; createdAt: string; updatedAt: string;
  source: 'manual' | 'import'; data: T;
};
export type SaveState = 'saved' | 'saving' | 'offline' | 'error' | 'conflict';
export type PhysisStore = {
  records: PhysisRecord[]; status: SaveState; error: string;
  save: (record: PhysisRecord) => Promise<void>;
  saveMany: (records: PhysisRecord[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => Promise<void>;
};
export type PhysisSettings = {
  calendarMode: CalendarMode; inputCalendarMode: CalendarMode; timeZone: string;
  weightUnit: 'kg' | 'lb'; distanceUnit: 'km' | 'mi'; energyUnit: 'kcal' | 'kJ'; glucoseUnit: 'mmol/L' | 'mg/dL';
  restSeconds: number; reminders: boolean; foodRules: string[]; enabledMetrics: string[];
  overviewBlocks: string[];
  monitoringHints?: boolean;
  customMetrics?: CustomMetricDefinition[];
};
export type PhysisFeatureProps = {
  referenceCatalog?: ReferenceCatalog;
  store: PhysisStore; settings: PhysisSettings; context: CalendarContext; language: string; weekStart?: 'sunday' | 'monday';
};
export function physisRecords<T>(store: Pick<PhysisStore, 'records'>, kind: PhysisKind): PhysisRecord<T>[] {
  return store.records.filter(record => record.kind === kind) as PhysisRecord<T>[];
}
export function newPhysisRecord<T>(kind: PhysisKind, data: T): PhysisRecord<T> {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), kind, schemaVersion: 1, createdAt: now, updatedAt: now, source: 'manual', data };
}
export function editPhysisRecord<T>(record: PhysisRecord<T>, data: T): PhysisRecord<T> {
  return { ...record, data, updatedAt: new Date().toISOString() };
}
/** Inputs accept decimal comma; blank and malformed values never become zero. */
export function physisNumber(value: string, min = 0, max = 1e7): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const result = Number(text);
  return Number.isFinite(result) && result >= min && result <= max ? result : null;
}
