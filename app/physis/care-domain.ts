import { validCustomMetrics } from './custom-metric-domain.ts';
import { addCivilDays, calendarTimeZone, civilDayNumber, isCivilDate, momentCivilDate, resolveCalendarWallTime } from '../calendar-context.ts';
import type { PhysisRecord, PhysisSettings, PhysisStore } from './types.ts';
import { NUTRIENT_KEYS } from './nutrition-domain.ts';

export const DOSE_UNITS = ['шт', 'mg', 'mcg', 'g', 'ml', 'капля', 'IU'] as const;
export type DoseUnit = typeof DOSE_UNITS[number];
export const DRUG_FORMS = ['Таблетка', 'Капсула', 'Порошок', 'Капли', 'Жидкость', 'Раствор для инъекций', 'Гель/крем', 'Пластырь', 'Ингалятор', 'Другая'] as const;
export const ROUTES = ['oral', 'intramuscular', 'subcutaneous', 'intravenous', 'topical', 'inhalation', 'other'] as const;
export type Drug = {
  catalogPath?: string[];
  name: string; brand: string; category: 'supplement' | 'medicine'; form: string; route: typeof ROUTES[number];
  activeIngredients: string; amountPerUnit: number | null; activeUnit: 'mg' | 'mcg' | 'g' | 'IU';
  concentration: number | null; concentrationUnit: 'mg/ml' | 'mcg/ml' | 'g/ml' | 'IU/ml';
  packageSize: string; source: string; notes: string; favorite: boolean; archived: boolean;
  nutrients: { nutrient: string; value: number; unit: 'mg' | 'mcg' | 'g'; elemental: boolean }[];
};
export const DRUG_SUBCATEGORIES = ['Иммунитет', 'ЖКТ', 'Общеукрепляющие', 'Адаптогены', 'Здоровый сон', 'Разгон мозга', 'Витамины', 'Минералы'];
export type DrugCatalogGroup = { name: string; path: string[]; children: DrugCatalogGroup[] };
export function drugInCatalogGroup(drug: Drug, path: string[]) {
  return path.length ? path.every((name, index) => drug.catalogPath?.[index] === name) : !drug.catalogPath?.length;
}
export function drugCatalogGroups(drugs: Drug[]): DrugCatalogGroup[] {
  const roots: DrugCatalogGroup[] = DRUG_SUBCATEGORIES.map(name => ({ name, path: [name], children: [] }));
  for (const drug of drugs) {
    let nodes = roots;
    for (const [index, name] of (drug.catalogPath ?? []).entries()) {
      let node = nodes.find(group => group.name === name);
      if (!node) { node = { name, path: drug.catalogPath!.slice(0, index + 1), children: [] }; nodes.push(node); }
      nodes = node.children;
    }
  }
  return roots;
}
export type RegimenPeriod = {
  id: string; start: string; end: string; timeZone: string;
  mode: 'daily' | 'weekdays' | 'every-days' | 'hours' | 'prn'; times: string[];
  weekdays: number[]; everyDays: number; everyHours: number; anchorAt: string;
  dose: number; unit: DoseUnit; route: Drug['route']; food: string; notes: string;
  scheduleStart?: string; regimenVersion?: number; drugSnapshot?: Drug;
};
export type Regimen = {
  name: string; drugId: string; drugSnapshot: Drug; version: number; periods: RegimenPeriod[];
  archived: boolean; previousVersions: { version: number; periods: RegimenPeriod[]; changedAt: string; drugSnapshot?: Drug }[];
};
export type IntakeEvent = { eventId: string; regimenId: string; regimenVersion: number; periodId: string;
  plannedAt: string; day: string; timeZone: string; dose: number; unit: DoseUnit; route: Drug['route']; drugSnapshot: Drug };
export type Intake = {
  eventId: string; regimenId: string | null; regimenVersion: number | null; plannedAt: string | null;
  takenAt: string; timeZone: string; day: string; quantity: number; unit: DoseUnit; route: Drug['route'];
  status: 'taken' | 'partial' | 'skipped' | 'postponed' | 'cancelled'; postponedUntil: string | null;
  drugSnapshot: Drug; source: 'manual' | 'import'; note: string; editedAt: string | null;
};
export const METRICS = [
  ['pressure', 'Контроль давления', 'mmHg'], ['glucose', 'Контроль сахара', 'mmol/L'],
  ['weight', 'Масса тела', 'kg'], ['waist', 'Обхват талии', 'cm'], ['resting-pulse', 'Пульс в покое', 'bpm'],
  ['sleep', 'Сон', 'h'], ['wellbeing', 'Самочувствие', '1–10'], ['soreness', 'Мышечная болезненность', '0–10'],
  ['steps', 'Шаги / активность', 'шаг'], ['water', 'Вода', 'ml'], ['hrv', 'HRV', 'ms'], ['spo2', 'SpO₂', '%'],
  ['temperature', 'Температура', '°C'], ['custom', 'Свой показатель', ''],
] as const;
export type Measurement = {
  customMetricId?: string;
  type: typeof METRICS[number][0]; label: string; value: number; secondValue: number | null; pulse: number | null;
  unit: string; timestamp: string; timeZone: string; day: string; source: string; device: string;
  context: string; intervalMinutes: number | null; arm: string; position: string; note: string;
  scale: 'numeric' | 'subjective'; target: { min: number; max: number; source: string } | null; editedAt: string | null;
};
export function measurementUnits(type: Measurement['type']): string[] {
  if (type === 'custom') return [];
  if (type === 'glucose') return ['mmol/L', 'mg/dL'];
  if (type === 'weight') return ['kg', 'lb'];
  return [METRICS.find(([id]) => id === type)![2]];
}
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const number = (value: unknown, min = 0, max = 1e9): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const nullableNumber = (value: unknown) => value === null || number(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isCivilDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
function zone(value: unknown): value is string { try { return typeof value === 'string' && !!calendarTimeZone(value); } catch { return false; } }
/** Custom date/clock controls present the recorded zone, never the browser's current zone. */
export function careMomentParts(timestamp: string | null, timeZone: string, fallbackDay: string) {
  calendarTimeZone(timeZone);
  if (!isCivilDate(fallbackDay)) throw new Error('Проверьте дату и время.');
  if (timestamp === null) return { day: fallbackDay, time: '09:00' };
  if (!instant(timestamp)) throw new Error('Проверьте дату и время.');
  const value = new Date(timestamp);
  return { day: momentCivilDate(value, timeZone), time: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value) };
}
export function editCareMoment(timestamp: string | null, timeZone: string, day: string, time: string) {
  const previous = careMomentParts(timestamp, timeZone, day);
  // In a DST overlap, selecting the already shown minute must not shift the historical instant.
  if (timestamp !== null && previous.day === day && previous.time === time) return { timestamp, day, adjustment: 'exact' as const };
  const resolved = resolveCalendarWallTime(day, time, timeZone);
  return { timestamp: resolved.instant.toISOString(), day: momentCivilDate(resolved.instant, timeZone), adjustment: resolved.adjustment };
}
export function validDrug(value: unknown): value is Drug {
  if (value && typeof value === 'object' && 'catalogPath' in value && value.catalogPath !== undefined && (!Array.isArray(value.catalogPath) || value.catalogPath.length > 5 || !value.catalogPath.every(name => typeof name === 'string' && !!name.trim() && name.length <= 80))) return false;
  if (!value || typeof value !== 'object') return false;
  const d = value as Drug;
  return text(d.name, 200) && d.name.trim().length > 0 && text(d.brand, 200) && ['supplement', 'medicine'].includes(d.category) &&
    text(d.form, 100) && ROUTES.includes(d.route) && text(d.activeIngredients) && nullableNumber(d.amountPerUnit) &&
    ['mg', 'mcg', 'g', 'IU'].includes(d.activeUnit) && nullableNumber(d.concentration) && ['mg/ml', 'mcg/ml', 'g/ml', 'IU/ml'].includes(d.concentrationUnit) &&
    text(d.packageSize, 200) && text(d.source) && text(d.notes, 10000) && typeof d.favorite === 'boolean' && typeof d.archived === 'boolean' &&
    Array.isArray(d.nutrients) && d.nutrients.length <= NUTRIENT_KEYS.length && d.nutrients.every(n => !!n && NUTRIENT_KEYS.some(key => key !== 'energy' && key === n.nutrient) && number(n.value) && ['mg', 'mcg', 'g'].includes(n.unit) && typeof n.elemental === 'boolean') && new Set(d.nutrients.map(n => n.nutrient)).size === d.nutrients.length;
}
export function validPeriod(p: RegimenPeriod) {
  return text(p.id, 100) && isCivilDate(p.start) && (!p.end || isCivilDate(p.end) && p.end >= p.start) && zone(p.timeZone) &&
    ['daily', 'weekdays', 'every-days', 'hours', 'prn'].includes(p.mode) && Array.isArray(p.times) && p.times.length <= 24 &&
    p.times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && new Set(p.times).size === p.times.length &&
    (p.mode === 'hours' || p.mode === 'prn' || p.times.length > 0) && Array.isArray(p.weekdays) && p.weekdays.every(n => Number.isInteger(n) && n >= 0 && n <= 6) &&
    Number.isInteger(p.everyDays) && number(p.everyDays, 1, 366) && number(p.everyHours, 0.25, 8760) && instant(p.anchorAt) && number(p.dose, 0.000001) &&
    DOSE_UNITS.includes(p.unit) && ROUTES.includes(p.route) && text(p.food, 200) && text(p.notes, 10000) &&
    (p.scheduleStart === undefined || isCivilDate(p.scheduleStart)) && (p.regimenVersion === undefined || Number.isSafeInteger(p.regimenVersion) && p.regimenVersion > 0) && (p.drugSnapshot === undefined || validDrug(p.drugSnapshot));
}
export function regimenEvents(record: PhysisRecord<Regimen>, from: string, to: string): IntakeEvent[] {
  if (!isCivilDate(from) || !isCivilDate(to) || to < from || civilDayNumber(to) - civilDayNumber(from) > 366) throw new Error('Выберите период до 366 дней.');
  if (record.data.archived) return [];
  const events: IntakeEvent[] = [];
  const push = (p: RegimenPeriod, timestamp: string, version: number) => {
    const day = momentCivilDate(new Date(timestamp), p.timeZone);
    if (day < from || day > to || day < p.start || p.end && day > p.end) return;
    events.push({ eventId: `${record.id}:${p.id}:${timestamp}`, regimenId: record.id, regimenVersion: version,
      periodId: p.id, plannedAt: timestamp, day, timeZone: p.timeZone, dose: p.dose, unit: p.unit, route: p.route, drugSnapshot: structuredClone(p.drugSnapshot ?? record.data.drugSnapshot) });
  };
  for (const p of record.data.periods) {
    if (!validPeriod(p)) throw new Error('Некорректная схема приема.');
    if (p.mode === 'prn') continue;
    if (p.mode === 'hours') {
      const anchor = Date.parse(p.anchorAt), interval = p.everyHours * 3_600_000;
      const begin = resolveCalendarWallTime(from > p.start ? from : p.start, '00:00', p.timeZone).instant.getTime();
      const end = resolveCalendarWallTime(addCivilDays(to, 1), '00:00', p.timeZone).instant.getTime();
      for (let t = anchor + Math.max(0, Math.ceil((begin - anchor) / interval)) * interval; t < end; t += interval) push(p, new Date(t).toISOString(), p.regimenVersion ?? record.data.version);
      continue;
    }
    for (let day = from > p.start ? from : p.start; day <= to && (!p.end || day <= p.end); day = addCivilDays(day, 1)) {
      if (p.mode === 'weekdays' && !p.weekdays.includes(new Date(`${day}T12:00Z`).getUTCDay())) continue;
      if (p.mode === 'every-days' && (civilDayNumber(day) - civilDayNumber(p.scheduleStart ?? p.start)) % p.everyDays !== 0) continue;
      for (const time of p.times) push(p, resolveCalendarWallTime(day, time, p.timeZone).instant.toISOString(), p.regimenVersion ?? record.data.version);
    }
  }
  return events.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
}
export type IntakeReminder = Omit<IntakeEvent, 'regimenId' | 'regimenVersion' | 'periodId' | 'plannedAt'> & {
  regimenId: string | null; regimenVersion: number | null; periodId: string | null; plannedAt: string | null;
  dueAt: string; postponed: boolean;
};
export function postponeIntakeReminder(event: IntakeReminder, previous: Intake | undefined, minutes = 30, now = new Date()): Intake {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('Укажите интервал напоминания от 1 до 1440 минут.');
  if (previous && !['postponed', 'cancelled'].includes(previous.status)) throw new Error('Приём уже отмечен. Исправьте существующую запись.');
  return { eventId: event.eventId, regimenId: event.regimenId, regimenVersion: event.regimenVersion,
    plannedAt: event.plannedAt, takenAt: previous?.takenAt ?? now.toISOString(), timeZone: event.timeZone,
    day: previous?.day ?? event.day, quantity: event.dose, unit: event.unit, route: event.route,
    status: 'postponed', postponedUntil: new Date(now.getTime() + minutes * 60000).toISOString(),
    drugSnapshot: structuredClone(event.drugSnapshot), source: previous?.source ?? 'manual', note: previous?.note ?? '', editedAt: previous ? now.toISOString() : null };
}
export function confirmIntakeState(intake: Intake): Intake {
  return { ...intake, postponedUntil: intake.status === 'postponed' ? intake.postponedUntil : null };
}
/** Postponement changes the reminder date, never the original event/version or journal day. */
export function pendingIntakeEvents(regimens: PhysisRecord<Regimen>[], intakes: PhysisRecord<Intake>[], day: string, includeOverduePostponed = false): IntakeReminder[] {
  const facts = new Map(intakes.map(record => [record.data.eventId, record.data]));
  const pending = new Map<string, IntakeReminder>();
  for (const record of regimens) for (const event of regimenEvents(record, day, day)) {
    const fact = facts.get(event.eventId);
    if (!fact || fact.status === 'cancelled') pending.set(event.eventId, { ...event, dueAt: event.plannedAt, postponed: false });
  }
  // Explicit postponed facts survive course edits/archival and include manual PRN entries.
  for (const fact of facts.values()) {
    if (fact.status !== 'postponed' || !fact.postponedUntil) continue;
    const dueDay = momentCivilDate(new Date(fact.postponedUntil), fact.timeZone);
    if (dueDay !== day && !(includeOverduePostponed && dueDay < day)) continue;
    pending.set(fact.eventId, { eventId: fact.eventId, regimenId: fact.regimenId, regimenVersion: fact.regimenVersion,
      periodId: null, plannedAt: fact.plannedAt, day: fact.plannedAt ? momentCivilDate(new Date(fact.plannedAt), fact.timeZone) : fact.day,
      timeZone: fact.timeZone, dose: fact.quantity, unit: fact.unit, route: fact.route, drugSnapshot: structuredClone(fact.drugSnapshot),
      dueAt: fact.postponedUntil, postponed: true });
  }
  return [...pending.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
/** A revision changes only future periods; the previous version remains part of the encrypted history. */
export function reviseRegimen(old: Regimen, next: Regimen, effectiveDay: string, now = new Date().toISOString()): Regimen {
  if (!isCivilDate(effectiveDay)) throw new Error('Укажите дату изменения.');
  const past = old.periods.filter(p => p.start < effectiveDay).map(p => ({ ...structuredClone(p), end: p.end && p.end < effectiveDay ? p.end : addCivilDays(effectiveDay, -1), drugSnapshot: structuredClone(p.drugSnapshot ?? old.drugSnapshot), regimenVersion: p.regimenVersion ?? old.version }));
  const future = next.periods.filter(p => !p.end || p.end >= effectiveDay).map(p => ({ ...structuredClone(p), id: crypto.randomUUID(), start: p.start < effectiveDay ? effectiveDay : p.start, scheduleStart: p.scheduleStart ?? p.start, drugSnapshot: structuredClone(next.drugSnapshot), regimenVersion: old.version + 1 }));
  if (!future.length) throw new Error('После даты изменения нет действующих периодов. Для остановки курса используйте паузу.');
  return { ...next, version: old.version + 1, periods: [...past, ...future], previousVersions: [...old.previousVersions, { version: old.version, periods: structuredClone(old.periods), changedAt: now, drugSnapshot: structuredClone(old.drugSnapshot) }] };
}
/** Cancellation preserves the stable event record so it can be marked again without resurrecting a tombstone. */
export function cancelIntake(intake: Intake, now = new Date().toISOString()): Intake {
  return { ...intake, status: 'cancelled', postponedUntil: null, editedAt: now };
}
export async function intakeRecordId(owner: string, eventId: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`physis-intake:${owner}:${eventId}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function activeAmount(drug: Drug, quantity: number, unit: DoseUnit): { value: number; unit: Drug['activeUnit'] } | null {
  if (!number(quantity)) return null;
  if (unit === 'шт' && drug.amountPerUnit !== null) return { value: quantity * drug.amountPerUnit, unit: drug.activeUnit };
  if (unit === 'ml' && drug.concentration !== null) return { value: quantity * drug.concentration, unit: drug.concentrationUnit.split('/')[0] as Drug['activeUnit'] };
  if (['mg', 'mcg', 'g', 'IU'].includes(unit)) return { value: quantity, unit: unit as Drug['activeUnit'] };
  return null;
}
export function convertMass(value: number, from: string, to: string): number | null {
  const factor: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001 };
  if (!number(value) || !Object.hasOwn(factor, from) || !Object.hasOwn(factor, to)) return null;
  return value * factor[from] / factor[to];
}
export function convertGlucose(value: number, from: string, to: string) {
  if (!number(value) || !['mmol/L', 'mg/dL'].includes(from) || !['mmol/L', 'mg/dL'].includes(to)) throw new Error('Несовместимые единицы глюкозы.');
  return from === to ? value : from === 'mmol/L' ? value * 18.0182 : value / 18.0182;
}
export function oralNutrientsForDay(store: Pick<PhysisStore, 'records'>, day: string) {
  const sources: { intakeId: string; category: Drug['category']; nutrient: string; value: number; unit: string }[] = [];
  for (const record of store.records.filter(r => r.kind === 'intake') as PhysisRecord<Intake>[]) {
    const i = record.data;
    if (i.day !== day || i.route !== 'oral' || !['taken', 'partial'].includes(i.status) || i.unit !== 'шт') continue;
    for (const n of i.drugSnapshot.nutrients) if (n.elemental) sources.push({ intakeId: record.id, category: i.drugSnapshot.category, nutrient: n.nutrient, value: n.value * i.quantity, unit: n.unit });
  }
  return sources;
}
export function validateCareRecord(record: PhysisRecord): boolean {
  const data = record.data;
  if (record.kind === 'drug') return validDrug(data);
  if (record.kind === 'regimen') {
    const r = data as Regimen;
    return text(r.name, 200) && text(r.drugId, 100) && validDrug(r.drugSnapshot) && Number.isSafeInteger(r.version) && r.version >= 1 &&
      Array.isArray(r.periods) && r.periods.length <= 100 && r.periods.every(validPeriod) && typeof r.archived === 'boolean' &&
      Array.isArray(r.previousVersions) && r.previousVersions.length <= 100 && r.previousVersions.every(v => Number.isInteger(v.version) && instant(v.changedAt) && Array.isArray(v.periods) && v.periods.every(validPeriod) && (v.drugSnapshot === undefined || validDrug(v.drugSnapshot)));
  }
  if (record.kind === 'intake') {
    const i = data as Intake;
    return text(i.eventId, 300) && (i.regimenId === null || text(i.regimenId, 100)) && (i.regimenVersion === null || Number.isInteger(i.regimenVersion)) &&
      (i.plannedAt === null || instant(i.plannedAt)) && instant(i.takenAt) && zone(i.timeZone) && isCivilDate(i.day) && number(i.quantity) && DOSE_UNITS.includes(i.unit) && ROUTES.includes(i.route) &&
      ['taken', 'partial', 'skipped', 'postponed', 'cancelled'].includes(i.status) && (i.postponedUntil === null || instant(i.postponedUntil)) && (i.status !== 'postponed' || i.postponedUntil !== null) && validDrug(i.drugSnapshot) &&
      ['manual', 'import'].includes(i.source) && text(i.note, 10000) && (i.editedAt === null || instant(i.editedAt));
  }
  if (record.kind === 'measurement') {
    const m = data as Measurement;
    if (m.customMetricId !== undefined && (m.type !== 'custom' || !text(m.customMetricId, 240) || !m.customMetricId.trim())) return false;
    return METRICS.some(([id]) => id === m.type) && text(m.label, 200) && !!m.label.trim() && number(m.value, m.type === 'temperature' || m.type === 'custom' ? -1e6 : 0, 1e9) && nullableNumber(m.secondValue) && nullableNumber(m.pulse) &&
      (m.type !== 'pressure' || number(m.value, 1, 400) && number(m.secondValue, 1, 400) && m.unit === 'mmHg') &&
      (m.type !== 'glucose' || number(m.value, 0.001, 2000) && ['mmol/L', 'mg/dL'].includes(m.unit)) &&
      (m.type !== 'wellbeing' || number(m.value, 1, 10)) && (m.type !== 'soreness' || number(m.value, 0, 10)) &&
      text(m.unit, 60) && !!m.unit.trim() && (m.type === 'custom' || measurementUnits(m.type).includes(m.unit)) && instant(m.timestamp) && zone(m.timeZone) && isCivilDate(m.day) && text(m.source, 200) && text(m.device, 200) &&
      text(m.context, 200) && nullableNumber(m.intervalMinutes) && text(m.arm, 100) && text(m.position, 100) && text(m.note, 10000) &&
      ['numeric', 'subjective'].includes(m.scale) && (m.target === null || number(m.target.min, -1e6) && number(m.target.max, m.target.min) && text(m.target.source, 200)) &&
      (m.editedAt === null || instant(m.editedAt));
  }
  if (record.kind === 'settings') {
    const s = data as PhysisSettings;
    if (s.customMetrics !== undefined && !validCustomMetrics(s.customMetrics)) return false;
    if (s.monitoringHints !== undefined && typeof s.monitoringHints !== 'boolean') return false;
    return ['sacred', 'lunar', 'profane'].includes(s.calendarMode) && ['sacred', 'lunar', 'profane'].includes(s.inputCalendarMode) && zone(s.timeZone) &&
      ['kg', 'lb'].includes(s.weightUnit) && ['km', 'mi'].includes(s.distanceUnit) && ['kcal', 'kJ'].includes(s.energyUnit) && ['mmol/L', 'mg/dL'].includes(s.glucoseUnit) &&
      number(s.restSeconds, 0, 3600) && typeof s.reminders === 'boolean' && Array.isArray(s.foodRules) && s.foodRules.every(v => text(v, 100)) &&
      Array.isArray(s.enabledMetrics) && s.enabledMetrics.every(v => METRICS.some(([id]) => id === v)) && Array.isArray(s.overviewBlocks) && s.overviewBlocks.every(v => text(v, 100));
  }
  return false;
}
