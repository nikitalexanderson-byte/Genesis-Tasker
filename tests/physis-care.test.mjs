import assert from 'node:assert/strict';
import test from 'node:test';
import {
  regimenEvents, reviseRegimen, validPeriod, validateCareRecord, validDrug,
  activeAmount, convertMass, convertGlucose, oralNutrientsForDay, intakeRecordId,
  cancelIntake, measurementUnits, careMomentParts, editCareMoment, pendingIntakeEvents, postponeIntakeReminder, confirmIntakeState,
  DRUG_SUBCATEGORIES, drugCatalogGroups, drugInCatalogGroup,
} from '../app/physis/care-domain.ts';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { newPhysisRecord } from '../app/physis/types.ts';

const drug = () => ({ name: 'Test supplement', brand: '', category: 'supplement', form: 'Капсула', route: 'oral', activeIngredients: 'magnesium', amountPerUnit: 100, activeUnit: 'mg', concentration: null, concentrationUnit: 'mg/ml', packageSize: '', source: 'Synthetic test fixture', notes: '', favorite: false, archived: false, nutrients: [{ nutrient: 'magnesium', value: 100, unit: 'mg', elemental: true }] });
const period = (patch = {}) => ({ id: crypto.randomUUID(), start: '2026-03-07', end: '', timeZone: 'America/New_York', mode: 'daily', times: ['09:00'], weekdays: [1, 2, 3, 4, 5], everyDays: 1, everyHours: 24, anchorAt: '2026-03-07T14:00:00Z', dose: 1, unit: 'шт', route: 'oral', food: '', notes: '', ...patch });
const regimen = (periods = [period()]) => newPhysisRecord('regimen', { name: 'Test course', drugId: crypto.randomUUID(), drugSnapshot: drug(), version: 1, periods, archived: false, previousVersions: [] });
const intake = (patch = {}) => ({ eventId: crypto.randomUUID(), regimenId: null, regimenVersion: null, plannedAt: null, takenAt: '2026-10-24T12:00:00Z', timeZone: 'Europe/Moscow', day: '2026-10-24', quantity: 2, unit: 'шт', route: 'oral', status: 'taken', postponedUntil: null, drugSnapshot: drug(), source: 'manual', note: '', editedAt: null, ...patch });
const measurement = (patch = {}) => ({ type: 'pressure', label: 'Blood pressure', value: 120, secondValue: 80, pulse: 64, unit: 'mmHg', timestamp: '2026-10-24T12:00:00Z', timeZone: 'Europe/Moscow', day: '2026-10-24', source: 'Manual', device: '', context: 'Seated', intervalMinutes: null, arm: 'Left', position: 'Seated', note: '', scale: 'numeric', target: null, editedAt: null, ...patch });

test('renamed ingredients keep exact legacy lookup and all shared plus personal categories', () => {
  const {mergeCatalog,catalogDrug,referenceForDrug,personalDrugCategories,catalogCategories}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),entry=entries.find(value=>value.nameRu==='BPC-157');
  assert.ok(entry);assert.ok(entry.aliases.some(name=>/Би/i.test(name)));
  const old={...catalogDrug(entry,'ru'),name:entry.aliases.find(name=>/Би/i.test(name)),activeIngredients:'',catalogPath:['Моя категория']};
  const before=structuredClone(old);
  assert.equal(referenceForDrug(old,entries)?.id,entry.id);
  assert.deepEqual(personalDrugCategories(old,entries),[...new Set([...catalogCategories(entry),'Моя категория'])]);
  assert.deepEqual(old,before);
  const english=catalogDrug(entries.find(value=>value.nameEn.includes(';')),'en');
  assert.ok(referenceForDrug(english,entries));
});

test('ingredient lookup rejects partial names, mixtures and ambiguous aliases', () => {
  const {mergeCatalog,catalogDrug,referenceForDrug}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entry=mergeCatalog([]).find(value=>value.nameRu==='BPC-157');
  const personal=catalogDrug(entry,'ru');
  assert.equal(referenceForDrug({...personal,name:'BPC',activeIngredients:''},[entry]),undefined);
  assert.equal(referenceForDrug({...personal,name:'Смесь',activeIngredients:'BPC-157 + другой пептид'},[entry]),undefined);
  assert.equal(referenceForDrug(personal,[entry,{...entry,id:'distinct-form'}]),undefined);
  assert.equal(referenceForDrug({...personal,category:'supplement'},[entry]),undefined);
  assert.equal(referenceForDrug({...personal,name:'Личный бренд'},[entry])?.id,entry.id);
});

test('catalog addition reuses active cards and restores archived identities without overwriting personal fields', () => {
  const {mergeCatalog,catalogDrug,preparePersonalDrug}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),entry=entries.find(value=>value.nameRu==='BPC-157');
  const archived=newPhysisRecord('drug',{...catalogDrug(entry,'ru'),archived:true,brand:'Личный бренд',notes:'Моя заметка',favorite:true,amountPerUnit:3});
  const before=structuredClone(archived),restored=preparePersonalDrug(entry,'en',[archived],entries);
  assert.equal(restored.action,'restore');assert.equal(restored.record.id,archived.id);
  assert.equal(restored.record.createdAt,archived.createdAt);
  assert.deepEqual(restored.record.data,{...before.data,archived:false});assert.deepEqual(archived,before);
  const active=restored.record;
  const existing=preparePersonalDrug(entry,'ru',[archived,active],entries);
  assert.equal(existing.action,'existing');assert.equal(existing.record,active);
  const created=preparePersonalDrug(entry,'ru',[],entries);
  assert.equal(created.action,'create');assert.ok(validDrug(created.record.data));
  assert.equal(created.record.data.route,'other');assert.equal(created.record.data.amountPerUnit,null);
  assert.equal(created.record.data.concentration,null);assert.deepEqual(created.record.data.nutrients,[]);
  assert.ok(created.record.data.notes.includes(entry.risks));
  assert.equal(preparePersonalDrug(entry,'ru',[],entries,created.record).record.id,created.record.id);
  assert.throws(()=>preparePersonalDrug({...entry,hidden:true},'ru',[],entries));
  assert.throws(()=>preparePersonalDrug({...entry,kind:'food'},'ru',[],entries));
});

test('30 minute snooze preserves planned dose/time and confirmation cancels its reminder across midnight', async () => {
  const r=regimen([period({start:'2026-11-01',timeZone:'Europe/Moscow',times:['23:30']})]);
  const before=structuredClone(r);
  const event=pendingIntakeEvents([r],[],'2026-11-01')[0];
  const postponed=postponeIntakeReminder(event,undefined,30,new Date('2026-11-01T20:50:00Z'));
  assert.equal(postponed.plannedAt,event.plannedAt);assert.equal(postponed.quantity,event.dose);
  assert.equal(postponed.day,'2026-11-01');assert.equal(postponed.postponedUntil,'2026-11-01T21:20:00.000Z');
  const record=newPhysisRecord('intake',postponed);record.id=await intakeRecordId('synthetic-owner',event.eventId);
  assert.equal(pendingIntakeEvents([r],[record],'2026-11-02')[0].eventId,event.eventId);
  const confirmed=confirmIntakeState({...postponed,status:'taken',day:'2026-11-02',takenAt:'2026-11-01T21:15:00Z'});
  assert.equal(confirmed.postponedUntil,null);assert.equal(confirmed.plannedAt,event.plannedAt);
  assert.equal(pendingIntakeEvents([r],[{...record,data:confirmed}],'2026-11-02').some(e=>e.eventId===event.eventId),false);
  assert.deepEqual(r,before);
  assert.equal(await intakeRecordId('synthetic-owner',event.eventId),record.id);
  assert.throws(()=>postponeIntakeReminder(event,confirmed));
});

test('catalog hierarchy keeps eight starter branches, nested descendants and unassigned legacy cards', () => {
  const legacy = drug(), nested = { ...drug(), catalogPath: ['Витамины', 'Группа', 'Подгруппа'] };
  const before = structuredClone(nested);
  const tree = drugCatalogGroups([legacy, nested]);
  assert.deepEqual(tree.map(node => node.name), DRUG_SUBCATEGORIES);
  assert.deepEqual(tree.find(node => node.name === 'Витамины').children[0].children[0].path, nested.catalogPath);
  assert.equal(drugInCatalogGroup(nested, ['Витамины']), true);
  assert.equal(drugInCatalogGroup(nested, ['Минералы']), false);
  assert.equal(drugInCatalogGroup(legacy, []), true);
  assert.equal(drugInCatalogGroup(nested, []), false);
  assert.equal(validDrug(legacy), true); assert.equal(validDrug(nested), true);
  assert.equal(validDrug({ ...nested, catalogPath: [''] }), false);
  assert.equal(validDrug({ ...nested, catalogPath: Array(6).fill('Too deep') }), false);
  assert.deepEqual(nested, before);
});

test('postponed reminders cross midnight without changing the original event, version or journal day', () => {
  const course = regimen([period({ start: '2026-10-24', timeZone: 'Europe/Moscow', times: ['23:30'] })]);
  const original = regimenEvents(course, '2026-10-24', '2026-10-24')[0];
  const fact = newPhysisRecord('intake', intake({ eventId: original.eventId, regimenId: course.id, regimenVersion: 1,
    plannedAt: original.plannedAt, day: '2026-10-24', status: 'postponed', postponedUntil: '2026-10-24T22:30:00Z' })); // 01:30 Moscow on Oct 25.
  const before = structuredClone(fact);
  const edited = structuredClone(course.data); edited.drugSnapshot.name = 'New version product';
  course.data = reviseRegimen(course.data, edited, '2026-10-25');
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-24').length, 0);
  const pending = pendingIntakeEvents([course], [fact], '2026-10-25');
  assert.equal(pending.length, 2);
  assert.equal(pending[0].eventId, original.eventId);
  assert.equal(pending[0].plannedAt, original.plannedAt);
  assert.equal(pending[0].day, '2026-10-24');
  assert.equal(pending[0].regimenVersion, 1);
  assert.equal(pending[0].drugSnapshot.name, 'Test supplement');
  assert.equal(pending[0].dueAt, fact.data.postponedUntil);
  assert.equal(pending.filter(event => Date.parse(event.dueAt) <= Date.parse('2026-10-24T22:29:00Z')).length, 0);
  assert.equal(pending.filter(event => Date.parse(event.dueAt) <= Date.parse('2026-10-24T22:30:00Z')).length, 1);
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-26', true).filter(event => event.postponed).length, 1);
  assert.deepEqual(fact, before);
  fact.data.status = 'taken';
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-25').length, 1);
});

test('same-day postponement is not duplicated and explicit PRN reminders survive course archive', () => {
  const course = regimen([period({ start: '2026-10-24', timeZone: 'UTC' })]);
  const event = regimenEvents(course, '2026-10-24', '2026-10-24')[0];
  const fact = newPhysisRecord('intake', intake({ eventId: event.eventId, regimenId: course.id, regimenVersion: 1,
    plannedAt: event.plannedAt, timeZone: 'UTC', status: 'postponed', postponedUntil: '2026-10-24T16:00:00Z' }));
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-24').length, 1);
  fact.data.status = 'cancelled';
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-24')[0].dueAt, event.plannedAt);
  fact.data.status = 'skipped';
  assert.equal(pendingIntakeEvents([course], [fact], '2026-10-24').length, 0);
  course.data.archived = true;
  const manual = newPhysisRecord('intake', intake({ status: 'postponed', postponedUntil: '2026-10-25T09:00:00Z' }));
  const pending = pendingIntakeEvents([course], [manual], '2026-10-25');
  assert.equal(pending.length, 1); assert.equal(pending[0].regimenId, null); assert.equal(pending[0].plannedAt, null);
});

test('daily local 09:00 and every 24h differ across spring DST', () => {
  const daily = regimen();
  const fixed = regimen([period({ mode: 'hours' })]);
  const local = regimenEvents(daily, '2026-03-07', '2026-03-09');
  const absolute = regimenEvents(fixed, '2026-03-07', '2026-03-09');
  assert.equal(local.length, 3);
  assert.equal(absolute.length, 3);
  assert.equal(Date.parse(local[1].plannedAt) - Date.parse(local[0].plannedAt), 23 * 3600000);
  assert.equal(Date.parse(absolute[1].plannedAt) - Date.parse(absolute[0].plannedAt), 24 * 3600000);
  assert.equal(local[1].plannedAt, '2026-03-08T13:00:00.000Z');
  assert.equal(absolute[1].plannedAt, '2026-03-08T14:00:00.000Z');
});

test('PRN has no automatic missed events; weekdays and end dates constrain schedules', () => {
  assert.deepEqual(regimenEvents(regimen([period({ mode: 'prn', times: [] })]), '2026-03-07', '2026-03-10'), []);
  const selected = regimenEvents(regimen([period({ mode: 'weekdays', weekdays: [1], end: '2026-03-09' })]), '2026-03-07', '2026-03-15');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].day, '2026-03-09');
  assert.equal(validPeriod(period({ mode: 'daily', times: [] })), false);
  assert.equal(validPeriod(period({ times: ['09:00', '09:00'] })), false);
});

test('regimen revision excludes expired periods, freezes old drug snapshots and retains N-day cadence', () => {
  const expired = period({ start: '2026-10-01', end: '2026-10-10', timeZone: 'UTC' });
  const live = period({ start: '2026-10-20', timeZone: 'UTC', mode: 'every-days', everyDays: 3 });
  const original = regimen([expired, live]);
  const edited = structuredClone(original.data); edited.drugSnapshot.name = 'Changed'; edited.drugSnapshot.amountPerUnit = 200;
  const revised = reviseRegimen(original.data, edited, '2026-10-25', '2026-10-24T00:00:00Z');
  assert.equal(revised.periods.length, 3);
  assert.ok(revised.periods.every(validPeriod));
  assert.equal(revised.previousVersions.length, 1);
  assert.equal(revised.previousVersions[0].drugSnapshot.name, 'Test supplement');
  assert.equal(original.data.periods[1].end, '');
  const events = regimenEvents({ ...original, data: revised }, '2026-10-23', '2026-10-29');
  assert.deepEqual(events.map(event => event.day), ['2026-10-23', '2026-10-26', '2026-10-29']);
  assert.equal(events[0].drugSnapshot.name, 'Test supplement');
  assert.equal(events[0].regimenVersion, 1);
  assert.equal(events[1].drugSnapshot.name, 'Changed');
  assert.equal(events[1].regimenVersion, 2);
  const secondRevision = reviseRegimen(revised, structuredClone(revised), '2026-10-28');
  assert.ok(secondRevision.periods.every(validPeriod));
  assert.equal(secondRevision.previousVersions.length, 2);
  assert.equal(regimenEvents({ ...original, data: secondRevision }, '2026-10-29', '2026-10-29').length, 1);
});

test('solution amounts require concentration; IU never turns into mass', () => {
  const product = drug();
  assert.deepEqual(activeAmount(product, 2, 'шт'), { value: 200, unit: 'mg' });
  assert.equal(activeAmount(product, 2, 'ml'), null);
  product.concentration = 5; product.concentrationUnit = 'mg/ml';
  assert.deepEqual(activeAmount(product, 2, 'ml'), { value: 10, unit: 'mg' });
  assert.equal(activeAmount(product, 20, 'капля'), null);
  assert.deepEqual(activeAmount(product, 400, 'IU'), { value: 400, unit: 'IU' });
  assert.equal(convertMass(400, 'IU', 'mg'), null);
  assert.equal(convertMass(1, 'g', 'mg'), 1000);
  assert.equal(convertMass(1000, 'mcg', 'mg'), 1);
  assert.equal(convertMass(5, 'toString', 'mg'), null);
});

test('food totals count only actual oral elemental unit doses and separate supplement/medicine', () => {
  const medicine = { ...drug(), category: 'medicine', nutrients: [{ nutrient: 'magnesium', value: .05, unit: 'g', elemental: true }] };
  const records = [
    newPhysisRecord('intake', intake()),
    newPhysisRecord('intake', intake({ quantity: .5, status: 'partial', drugSnapshot: medicine })),
    newPhysisRecord('intake', intake({ route: 'intramuscular' })),
    newPhysisRecord('intake', intake({ status: 'skipped' })),
    newPhysisRecord('intake', intake({ status: 'cancelled' })),
    newPhysisRecord('intake', intake({ unit: 'ml' })),
    newPhysisRecord('intake', intake({ day: '2026-10-23' })),
    newPhysisRecord('intake', intake({ drugSnapshot: { ...drug(), nutrients: [{ nutrient: 'magnesium', value: 500, unit: 'mg', elemental: false }] } })),
  ];
  const totals = oralNutrientsForDay({ records }, '2026-10-24');
  assert.equal(totals.length, 2);
  assert.equal(totals[0].value, 200);
  assert.equal(totals[1].category, 'medicine');
  assert.equal(convertMass(totals[1].value, totals[1].unit, 'mg'), 25);
  const duplicate = drug(); duplicate.nutrients.push({ ...duplicate.nutrients[0] });
  assert.equal(validDrug(duplicate), false);
});

test('cancelling an intake retains stable identity for marking it again', async () => {
  const original = newPhysisRecord('intake', intake());
  const cancelled = cancelIntake(original.data, '2026-10-25T00:00:00Z');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.eventId, original.data.eventId);
  assert.equal(cancelled.quantity, original.data.quantity);
  assert.equal(cancelled.editedAt, '2026-10-25T00:00:00Z');
  assert.ok(validateCareRecord({ ...original, data: cancelled }));
  const first = await intakeRecordId('owner', cancelled.eventId);
  assert.equal(first, await intakeRecordId('owner', original.data.eventId));
  assert.notEqual(first, await intakeRecordId('other-owner', original.data.eventId));
  assert.deepEqual(oralNutrientsForDay({ records: [{ ...original, data: cancelled }] }, '2026-10-24'), []);
});

test('glucose unit conversion round trips without changing original measurement', () => {
  const entry = measurement({ type: 'glucose', label: 'Glucose', value: 5.5, secondValue: null, unit: 'mmol/L' });
  const display = convertGlucose(entry.value, entry.unit, 'mg/dL');
  assert.ok(Math.abs(display - 99.1001) < 1e-8);
  assert.ok(Math.abs(convertGlucose(display, 'mg/dL', 'mmol/L') - 5.5) < 1e-8);
  assert.equal(entry.value, 5.5);
  assert.equal(entry.unit, 'mmol/L');
  assert.throws(() => convertGlucose(4, 'IU', 'mmol/L'));
});

test('pressure requires both values, built-in measurement units are strict and timestamps include a zone', () => {
  assert.ok(validateCareRecord(newPhysisRecord('measurement', measurement())));
  assert.equal(validateCareRecord(newPhysisRecord('measurement', measurement({ secondValue: null }))), false);
  assert.equal(validateCareRecord(newPhysisRecord('measurement', measurement({ unit: 'kg' }))), false);
  assert.equal(validateCareRecord(newPhysisRecord('measurement', measurement({ type: 'weight', value: 70, unit: 'stone' }))), false);
  assert.equal(validateCareRecord(newPhysisRecord('measurement', measurement({ timestamp: '2026-10-24T12:00:00' }))), false);
  assert.equal(validateCareRecord(newPhysisRecord('measurement', measurement({ timestamp: '2026-02-30T12:00:00Z' }))), false);
  assert.deepEqual(measurementUnits('weight'), ['kg', 'lb']);
  assert.deepEqual(measurementUnits('pressure'), ['mmHg']);
  assert.ok(validateCareRecord(newPhysisRecord('measurement', measurement({ type: 'custom', label: 'Forearm', value: 30, secondValue: null, unit: 'cm' }))));
});

test('custom date and clock fields resolve recorded local time and preserve an unchanged midnight instant', () => {
  const original = '2026-10-23T21:05:33.123Z';
  assert.deepEqual(careMomentParts(original, 'Europe/Moscow', '2026-10-24'), { day: '2026-10-24', time: '00:05' });
  const unchanged = editCareMoment(original, 'Europe/Moscow', '2026-10-24', '00:05');
  assert.equal(unchanged.timestamp, original);
  const moved = editCareMoment(original, 'Europe/Moscow', '2026-10-25', '00:05');
  assert.equal(moved.timestamp, '2026-10-24T21:05:00.000Z');
  assert.equal(moved.day, '2026-10-25');
  const postponed = editCareMoment(null, 'Europe/Moscow', '2026-10-25', '18:30');
  assert.equal(postponed.timestamp, '2026-10-25T15:30:00.000Z');
  assert.throws(() => careMomentParts(original, 'Not/AZone', '2026-10-24'));
  assert.throws(() => editCareMoment(original, 'Europe/Moscow', '2026-02-30', '12:00'));
});

test('custom clock changes use Genesis DST policy and retain an unchanged later overlap occurrence', () => {
  const gap = editCareMoment(null, 'America/New_York', '2026-03-08', '02:30');
  assert.equal(gap.adjustment, 'gap-forward');
  assert.deepEqual(careMomentParts(gap.timestamp, 'America/New_York', '2026-03-08'), { day: '2026-03-08', time: '03:30' });
  const laterOverlap = '2026-11-01T06:30:45.000Z';
  assert.equal(editCareMoment(laterOverlap, 'America/New_York', '2026-11-01', '01:30').timestamp, laterOverlap);
  const changedOverlap = editCareMoment(laterOverlap, 'America/New_York', '2026-11-01', '01:45');
  assert.equal(changedOverlap.adjustment, 'overlap-earlier');
  assert.equal(changedOverlap.timestamp, '2026-11-01T05:45:00.000Z');
});


test('evidence library imports descriptive personal cards without inventing a dose or composition', () => {
  const { SUPPLEMENT_REFERENCES, referenceDrug } = calendarModule('app/physis/supplement-reference-data.ts');
  assert.equal(SUPPLEMENT_REFERENCES.length, 46);
  assert.equal(new Set(SUPPLEMENT_REFERENCES.map(entry => entry.id)).size, 46);
  for (const reference of SUPPLEMENT_REFERENCES) {
    for (const key of ['name', 'substance', 'evidence', 'limits', 'cautions']) assert.ok(reference[key].every(text => text.trim().length > 0));
    assert.ok(reference.sources.length && reference.sources.every(url => new URL(url).protocol === 'https:'));
    for (const en of [false, true]) {
      const card = referenceDrug(reference, en);
      assert.ok(validDrug(card));
      assert.equal(card.amountPerUnit, null);
      assert.equal(card.concentration, null);
      assert.deepEqual(card.nutrients, []);
      card.catalogPath.push('My branch');
      assert.equal(reference.path.includes('My branch'), false);
    }
  }
});


test('custom definitions recover legacy histories without rewriting or mixing measurements', () => {
  const { customMetricDefinitions, measurementInCustomMetric } = calendarModule('app/physis/custom-metric-domain.ts');
  const old = [measurement({ type: 'custom', label: 'Left arm', unit: 'cm', value: 35 }), measurement({ type: 'custom', label: 'Right arm', unit: 'cm', value: 36 })];
  const before = structuredClone(old);
  const definitions = customMetricDefinitions({}, old);
  assert.equal(definitions.length, 2);
  const renamed = { ...definitions[0], name: 'Left biceps', unit: 'mm', icon: 'dumbbell' };
  const newer = measurement({ type: 'custom', customMetricId: renamed.id, label: renamed.name, unit: 'mm', value: 355 });
  assert.ok(measurementInCustomMetric(old[0], renamed));
  assert.ok(measurementInCustomMetric(newer, renamed));
  assert.equal(measurementInCustomMetric(old[1], renamed), false);
  assert.equal(customMetricDefinitions({ customMetrics: [renamed, definitions[1]] }, [...old, newer]).length, 2);
  assert.deepEqual(old, before);
});

test('same-name custom measurements with distinct stable IDs keep independent histories', () => {
  const { measurementInCustomMetric } = calendarModule('app/physis/custom-metric-domain.ts');
  const first = { id: crypto.randomUUID(), name: 'Circumference', unit: 'cm', scale: 'numeric', icon: 'ruler' };
  const second = { ...first, id: crypto.randomUUID() };
  const entry = measurement({ type: 'custom', customMetricId: first.id, label: 'Circumference', unit: 'cm' });
  assert.ok(measurementInCustomMetric(entry, first));
  assert.equal(measurementInCustomMetric(entry, second), false);
  assert.ok(validateCareRecord(newPhysisRecord('measurement', entry)));
  assert.equal(validateCareRecord(newPhysisRecord('measurement', { ...entry, type: 'weight', unit: 'kg' })), false);
});

test('custom metric settings preserve old settings and reject broken definitions, duplicate IDs and unknown icons', () => {
  const { validCustomMetrics } = calendarModule('app/physis/custom-metric-domain.ts');
  const definition = { id: crypto.randomUUID(), name: 'Recovery', unit: 'score', scale: 'subjective', icon: 'heart' };
  const settings = { calendarMode: 'profane', inputCalendarMode: 'sacred', timeZone: 'UTC', weightUnit: 'kg', distanceUnit: 'km', energyUnit: 'kcal', glucoseUnit: 'mmol/L', restSeconds: 90, reminders: true, foodRules: [], enabledMetrics: ['custom'], overviewBlocks: [] };
  assert.ok(validateCareRecord(newPhysisRecord('settings', settings)));
  assert.ok(validateCareRecord(newPhysisRecord('settings', { ...settings, customMetrics: [definition] })));
  for (const patch of [{ icon: 'untrusted-script' }, { name: '' }, { unit: '' }, { scale: 'arbitrary' }, { hidden: 'yes' }, { deleted: 1 }]) assert.equal(validCustomMetrics([{ ...definition, ...patch }]), false);
  assert.ok(validCustomMetrics([{ ...definition, hidden: true, deleted: false }]));
  assert.equal(validCustomMetrics([definition, { ...definition }]), false);
  assert.equal(validateCareRecord(newPhysisRecord('settings', { ...settings, customMetrics: 'bad' })), false);
});

test('mineral references preserve all fifteen IDs and cover adult age boundaries without gaps', () => {
  const { MINERAL_PROFILES, mineralIntake } = calendarModule('app/physis/mineral-reference-data.ts');
  const { SUPPLEMENT_REFERENCES } = calendarModule('app/physis/supplement-reference-data.ts');
  const ids = ['calcium', 'phosphorus', 'magnesium', 'potassium', 'sodium', 'chloride', 'iodine', 'chromium', 'copper', 'fluoride', 'iron', 'manganese', 'molybdenum', 'selenium', 'zinc'];
  assert.deepEqual(MINERAL_PROFILES.map(item => item.id).sort(), ids.sort());
  assert.equal(SUPPLEMENT_REFERENCES.filter(item => item.path[0] === 'Минералы').length, 15);
  for (const profile of MINERAL_PROFILES) {
    assert.ok(['AI', 'RDA'].includes(profile.kind));
    assert.ok(['mg', 'mcg'].includes(profile.unit));
    assert.ok(profile.sources.every(url => new URL(url).protocol === 'https:'));
    for (let age = 19; age <= 120; age++) {
      const rows = profile.intakes.filter(row => age >= row.minAge && (row.maxAge === null || age <= row.maxAge));
      assert.equal(rows.length, 1, `${profile.id}, age ${age}`);
      assert.ok(rows[0].male > 0 && rows[0].female > 0);
      assert.deepEqual(mineralIntake(profile.id, age), rows[0]);
    }
    for (const age of [0, 18, NaN, Infinity, 30.5]) assert.equal(mineralIntake(profile.id, age), null);
  }
  assert.equal(mineralIntake('unknown', 30), null);
  assert.equal(mineralIntake('calcium', 50).female, 1000);
  assert.equal(mineralIntake('calcium', 51).female, 1200);
  assert.equal(mineralIntake('calcium', 70).male, 1000);
  assert.equal(mineralIntake('calcium', 71).male, 1200);
  assert.equal(mineralIntake('magnesium', 30).male, 400);
  assert.equal(mineralIntake('magnesium', 31).male, 420);
  assert.equal(mineralIntake('iron', 50).female, 18);
  assert.equal(mineralIntake('iron', 51).female, 8);
  assert.equal(mineralIntake('chromium', 50).male, 35);
  assert.equal(mineralIntake('chromium', 51).male, 30);
  assert.equal(mineralIntake('chloride', 50).male, 2300);
  assert.equal(mineralIntake('chloride', 51).male, 2000);
  assert.equal(mineralIntake('chloride', 71).male, 1800);
  assert.equal(mineralIntake('copper', 19).male, 900);
  assert.equal(mineralIntake('molybdenum', 19).male, 45);
  assert.equal(mineralIntake('potassium', 19).female, 2600);
});

test('mineral reference qualifications do not turn disputed chromium AI or electrolyte references into prescriptions', () => {
  const { MINERAL_PROFILES } = calendarModule('app/physis/mineral-reference-data.ts');
  const byId = Object.fromEntries(MINERAL_PROFILES.map(item => [item.id, item]));
  assert.match(byId.chromium.note[1], /2001.*EFSA.*no intake reference/);
  assert.match(byId.sodium.note[1], /2019.*CDRR.*neither a target nor a UL/);
  assert.match(byId.fluoride.supplementation[1], /not automatic/);
  assert.match(byId.chloride.absorption[1], /elemental chlorine is not/);
  assert.match(byId.calcium.interactions[1], /not prohibited/);
  assert.match(byId.magnesium.absorption[1], /does not guarantee/);
});

test('hidden and deleted custom definitions retain identity and do not reappear as new legacy metrics', () => {
  const { customMetricDefinitions, measurementInCustomMetric } = calendarModule('app/physis/custom-metric-domain.ts');
  const old = [measurement({type: 'custom', label: 'My circumference', unit: 'cm'})];
  const definition = customMetricDefinitions({}, old)[0];
  for (const state of [{ hidden: true }, { deleted: true }]) {
    const recovered = customMetricDefinitions({customMetrics: [{ ...definition, ...state }]}, old);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].id, definition.id);
    assert.deepEqual(recovered[0], { ...definition, ...state });
    assert.ok(measurementInCustomMetric(old[0], recovered[0]));
  }
  assert.deepEqual(customMetricDefinitions({}, []), []);
});

test('recovering an imported custom metric ID keeps it reachable when its settings definition is absent', () => {
  const { customMetricDefinitions, measurementInCustomMetric } = calendarModule('app/physis/custom-metric-domain.ts');
  const entry = measurement({ type: 'custom', customMetricId: crypto.randomUUID(), label: 'Balance', unit: 's' });
  const definitions = customMetricDefinitions({}, [entry]);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].id, entry.customMetricId);
  assert.ok(measurementInCustomMetric(entry, definitions[0]));
});

test('user requested historical compounds are normal library cards and K2 keeps its own identity', () => {
  const { SUPPLEMENT_REFERENCES } = calendarModule('app/physis/supplement-reference-data.ts');
  for (const id of ['inositol','paba','carnitine','orotic-acid','pangamic-acid','lipoic-acid','polyphenols','vitamin-u','vitamin-k2']) {
    const entry = SUPPLEMENT_REFERENCES.find(item => item.id === id);
    assert.ok(entry, id);
    assert.equal(entry.path[0], 'Витамины');
    assert.ok(entry.evidence[0] && entry.sources.length);
  }
  assert.equal(SUPPLEMENT_REFERENCES.filter(item => item.id === 'magnesium').length, 1);
  assert.equal(SUPPLEMENT_REFERENCES.filter(item => item.path[0] === 'Минералы').length, 15);
});
