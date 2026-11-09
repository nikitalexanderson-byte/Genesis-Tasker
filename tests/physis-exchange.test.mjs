import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePhysisCsv, csvCell, exportPhysisCsv, parsePhysisRecords, previewPhysisImport,
  reidentifyImportedRecords, preparePhysisImport, resumePhysisImport, drugsFromCsv,
  PHYSIS_IMPORT_BYTES, PHYSIS_IMPORT_RECORDS, PHYSIS_BACKUP_ROWS, checkPhysisImportBytes, parsePhysisBackup,
} from '../app/physis/exchange-domain.ts';
import { blankFood, nutrient } from '../app/physis/nutrition-domain.ts';
import { regimenEvents } from '../app/physis/care-domain.ts';
import { newPhysisRecord } from '../app/physis/types.ts';
import { addExercise, assignProgram, newProgram, startSession, STARTER_EXERCISES } from '../app/physis/training-domain.ts';

function food(name = 'Food') { return newPhysisRecord('food', { ...blankFood(), name, nutrients: { energy: nutrient(100, 'energy', '100g', 'Test fixture') } }); }
const drugData = () => ({ name: 'Test drug', brand: '', category: 'medicine', form: 'Таблетка', route: 'oral', activeIngredients: '', amountPerUnit: 5, activeUnit: 'mg', concentration: null, concentrationUnit: 'mg/ml', packageSize: '', source: 'Test fixture', notes: '', favorite: false, archived: false, nutrients: [] });

test('own JSON/CSV exports larger than 5 MiB restore within the bounded full-vault import limit', () => {
  const records = Array.from({ length: 600 }, (_, index) => newPhysisRecord('drug', { ...drugData(), name: `Drug ${index}`, notes: 'n'.repeat(10000) }));
  for (const format of ['json', 'csv']) {
    const text = format === 'json' ? JSON.stringify({ format: 'physis-plain', version: 1, records }) : exportPhysisCsv(records);
    assert.ok(Buffer.byteLength(text) > 5 * 1024 * 1024);
    assert.deepEqual(parsePhysisRecords(text, format), records);
  }
  assert.doesNotThrow(() => checkPhysisImportBytes(PHYSIS_IMPORT_BYTES));
  assert.throws(() => checkPhysisImportBytes(PHYSIS_IMPORT_BYTES + 1), /128/);
});

test('record limits include the CSV header separately and count live encrypted records before decryption', () => {
  const rows = 'recordJSON\n' + Array(PHYSIS_IMPORT_RECORDS).fill('null').join('\n');
  assert.equal(parsePhysisRecords(rows, 'csv').length, PHYSIS_IMPORT_RECORDS);
  assert.throws(() => parsePhysisRecords(rows + '\nnull', 'csv'));
  assert.throws(() => parsePhysisRecords(JSON.stringify({ format: 'physis-plain', version: 1, records: Array(PHYSIS_IMPORT_RECORDS + 1).fill(null) }), 'json'));
  const vault = { version: 1, keyVersion: 1, password: { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 600000, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(64) }, recovery: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(64) } };
  const backup = { format: 'physis-encrypted', version: 1, owner: crypto.randomUUID(), vault, records: [] };
  const row = () => ({ id: crypto.randomUUID(), revision: 1, sequence: 1, updatedAt: '2026-10-24T00:00:00Z', deletedAt: null, envelope: { version: 1, schemaVersion: 1, keyVersion: 1, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'A'.repeat(64) } });
  backup.records = Array.from({ length: PHYSIS_IMPORT_RECORDS }, row);
  assert.equal(parsePhysisBackup(backup).records.length, PHYSIS_IMPORT_RECORDS);
  assert.throws(() => parsePhysisBackup({ ...backup, records: [...backup.records, row()] }), /предел/);
  assert.doesNotThrow(() => parsePhysisBackup({ ...backup, records: [...backup.records, { ...row(), deletedAt: '2026-10-24T00:00:00Z', envelope: null }] }));
  assert.throws(() => parsePhysisBackup({ ...backup, records: Array(PHYSIS_BACKUP_ROWS + 1).fill(null) }), /предел/);
  assert.throws(() => parsePhysisBackup({ ...backup, records: [{ ...row(), envelope: { ...row().envelope, ciphertext: 'A'.repeat(350000) } }] }), /ENVELOPE/);
});

test('CSV parser handles quoted multiline values and rejects malformed or oversized cells', () => {
  assert.deepEqual(parsePhysisCsv('\uFEFFname,note\r\n"One","Line 1\nLine ""2"""\r\n'), [['name', 'note'], ['One', 'Line 1\nLine "2"']]);
  assert.throws(() => parsePhysisCsv('"Unclosed'));
  assert.throws(() => parsePhysisCsv('"One"oops,field'));
  assert.throws(() => parsePhysisCsv('x'.repeat(350001)));
});

test('CSV export neutralizes formula cells while recordJSON retains exact original values', () => {
  for (const text of ['=HYPERLINK("https://invalid")', '+cmd', '-5+2', '@SUM(A1)', ' \t=1']) assert.equal(parsePhysisCsv(csvCell(text))[0][0], `'${text}`);
  const record = food('=1+1');
  const text = exportPhysisCsv([record]);
  const rows = parsePhysisCsv(text);
  assert.equal(rows[1][3], "'=1+1");
  const restored = parsePhysisRecords(text, 'csv');
  assert.deepEqual(restored, [record]);
  assert.equal(restored[0].data.name, '=1+1');
});

test('drug CSV mapping requires explicit units for quantities and has real preview errors', () => {
  const mapping = { name: 'Product', amountPerUnit: 'Amount', activeUnit: 'Unit', route: 'Route' };
  const rows = [['Product', 'Amount', 'Unit', 'Route'], ['One', '12,5', 'mg', 'oral'], ['Two', '5', '', 'oral'], ['Three', '-2', 'mg', 'oral'], ['Four', '5', 'IU', 'intramuscular']];
  const values = drugsFromCsv(rows, mapping);
  const preview = previewPhysisImport(values, [], 'drug');
  assert.equal(preview.records.length, 2);
  assert.equal(preview.errors.length, 2);
  assert.equal(preview.records[0].data.amountPerUnit, 12.5);
  assert.equal(preview.records[1].data.activeUnit, 'IU');
  assert.equal(preview.records[1].data.route, 'intramuscular');
});

test('JSON schema/version validation and duplicate preview prevent silent overwrites', () => {
  const record = food();
  const parsed = parsePhysisRecords(JSON.stringify({ format: 'physis-plain', version: 1, records: [record] }), 'json');
  assert.deepEqual(parsed, [record]);
  assert.throws(() => parsePhysisRecords(JSON.stringify({ format: 'physis-plain', version: 2, records: [] }), 'json'));
  const invalid = structuredClone(record); invalid.data.nutrients.energy.unit = 'IU';
  const result = previewPhysisImport([record, invalid], [record]);
  assert.equal(result.records.length, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 1);
});

test('import reidentification remaps scheduled event IDs and preserves arbitrary note text', () => {
  const medication = newPhysisRecord('drug', drugData());
  const period = { id: crypto.randomUUID(), start: '2026-10-24', end: '', timeZone: 'UTC', mode: 'daily', times: ['09:00'], weekdays: [], everyDays: 1, everyHours: 24, anchorAt: '2026-10-24T09:00:00Z', dose: 1, unit: 'шт', route: 'oral', food: '', notes: medication.id };
  const regimen = newPhysisRecord('regimen', { name: 'Course', drugId: medication.id, drugSnapshot: medication.data, version: 1, periods: [period], archived: false, previousVersions: [] });
  const event = regimenEvents(regimen, '2026-10-24', '2026-10-24')[0];
  const intake = newPhysisRecord('intake', { eventId: event.eventId, regimenId: regimen.id, regimenVersion: 1, plannedAt: event.plannedAt, takenAt: event.plannedAt, timeZone: 'UTC', day: '2026-10-24', quantity: 1, unit: 'шт', route: 'oral', status: 'taken', postponedUntil: null, drugSnapshot: medication.data, source: 'manual', note: medication.id, editedAt: null });
  const imported = reidentifyImportedRecords([medication, regimen, intake]);
  assert.notEqual(imported[0].id, medication.id);
  assert.equal(imported[1].data.drugId, imported[0].id);
  assert.equal(imported[2].data.regimenId, imported[1].id);
  assert.equal(imported[2].data.eventId, regimenEvents(imported[1], '2026-10-24', '2026-10-24')[0].eventId);
  assert.equal(imported[2].data.note, medication.id);
  assert.equal(imported[1].data.periods[0].notes, medication.id);
  const again = previewPhysisImport([medication, regimen, intake], imported);
  assert.equal(again.duplicates, 3);
  assert.equal(again.records.length, 0);
});

test('partial import retry resumes confirmed batches and reuses IDs after an ambiguous network response', async () => {
  const source = Array.from({ length: 45 }, (_, index) => food(`Food ${index}`));
  const plan = preparePhysisImport(source);
  const originalIds = plan.records.map(record => record.id);
  const saved = new Map(); const calls = []; let fail = true;
  const saveMany = async batch => {
    calls.push(batch.map(record => record.id));
    for (const record of batch) saved.set(record.id, structuredClone(record));
    if (fail && calls.length === 2) throw new Error('response lost after commit');
  };
  await assert.rejects(resumePhysisImport(plan, { records: [...saved.values()], status: 'offline', saveMany }), /response lost/);
  assert.equal(plan.confirmed, 20);
  assert.equal(saved.size, 40);
  fail = false;
  await resumePhysisImport(plan, { records: [...saved.values()], status: 'offline', saveMany });
  assert.equal(plan.confirmed, 45);
  assert.equal(saved.size, 45);
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(plan.records.map(record => record.id), originalIds);
  assert.notDeepEqual(originalIds, source.map(record => record.id));
});

test('full training import keeps personal exercise references linked in programs, assignments and sessions', () => {
  const definition = structuredClone(STARTER_EXERCISES[0].data);
  definition.name = 'Personal exercise';
  delete definition.catalogId;
  const exercise = newPhysisRecord('exercise', definition);
  const programData = newProgram('Personal program');
  programData.versions[0].mesocycles[0].microcycles[0].days[0].exercises = [addExercise({ id: exercise.id, data: definition, personal: true })];
  const program = newPhysisRecord('program', programData);
  const assignment = newPhysisRecord('assignment', assignProgram(program.id, program.data.versions[0], '2026-10-24', 'fixed'));
  const session = newPhysisRecord('session', startSession('2026-10-24', 'Europe/Moscow', assignment.data.scheduled[0], assignment));
  session.data.notes = exercise.id;
  session.data.exercises.push(addExercise(STARTER_EXERCISES[1]));
  const original = [exercise, program, assignment, session];
  const preview = previewPhysisImport(original, []);
  assert.equal(preview.errors.length, 0);
  const imported = reidentifyImportedRecords(preview.records);
  const [newExercise, newProgramRecord, newAssignment, newSession] = imported;
  assert.notEqual(newExercise.id, exercise.id);
  assert.equal(newProgramRecord.data.versions[0].mesocycles[0].microcycles[0].days[0].exercises[0].exerciseId, newExercise.id);
  assert.equal(newAssignment.data.snapshot.mesocycles[0].microcycles[0].days[0].exercises[0].exerciseId, newExercise.id);
  assert.equal(newAssignment.data.scheduled[0].snapshot.exercises[0].exerciseId, newExercise.id);
  assert.equal(newSession.data.exercises[0].exerciseId, newExercise.id);
  assert.equal(newAssignment.data.programId, newProgramRecord.id);
  assert.equal(newSession.data.assignmentId, newAssignment.id);
  assert.equal(newSession.data.programId, newProgramRecord.id);
  assert.equal(newSession.data.exercises[1].exerciseId, STARTER_EXERCISES[1].id);
  assert.equal(newSession.data.notes, exercise.id);
  assert.deepEqual(newSession.data.exercises[0].snapshot, session.data.exercises[0].snapshot);
  assert.equal(previewPhysisImport(imported, []).errors.length, 0);
});
