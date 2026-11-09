import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { calendarModule } from '../../tests/helpers/calendar-modules.mjs';
import { historyFixture, taskFixture } from './fixtures.mjs';

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
const { projectHabitHistory, habitEconomyHistory } = calendarModule('app/habit-history.ts');
const { orderPersonalTasks } = calendarModule('app/task-list-order.ts');
const repetitions = 7, warmups = 3;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = [];
function measure(name, records, operation) {
  const first = performance.now();
  const result = operation();
  const firstCallMs = performance.now() - first;
  for (let i = 0; i < warmups; i++) operation();
  const samplesMs = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    const repeated = operation();
    samplesMs.push(performance.now() - started);
    if (digest(repeated) !== digest(result)) throw new Error(`Non-deterministic result: ${name}`);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  rows.push({ name, records, firstCallMs, medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0], maxMs: sorted.at(-1), samplesMs, resultSha256: digest(result) });
  console.log(`${name}: ${rows.at(-1).medianMs.toFixed(3)} ms`);
}
for (const [label, count, days] of [['small', 8, 30], ['large', 40, 180]]) {
  const f = historyFixture(count, days);
  const records = { habits: count, days, events: f.events.length, completions: f.completions.length, measurements: f.measurements.length };
  measure(`history-project-${label}`, records, () => projectHabitHistory(f.habits, f.events, f.completions, f.measurements));
  const workspace = { habitHistory: f.events, habitCompletions: f.completions, habitMeasurements: f.measurements };
  measure(`history-economy-${label}`, records, () => habitEconomyHistory(workspace));
}
for (const size of [100, 10_000]) {
  const tasks = taskFixture(size);
  for (const order of ['createdAt', 'updatedAt', 'dueDate', 'title']) {
    measure(`tasks-${order}-${size}`, { tasks: size }, () => orderPersonalTasks(tasks, order));
  }
}
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
catch { /* Source archives can be measured without a Git checkout. */ }
const sourceSha256 = createHash('sha256');
for (const file of ['app/habit-history.ts', 'app/task-list-order.ts', 'scripts/performance/fixtures.mjs', 'scripts/performance/measure.mjs'])
  sourceSha256.update(file).update(readFileSync(file));
const report = { schemaVersion: 1, commit, sourceSha256: sourceSha256.digest('hex'),
  measuredAt: new Date().toISOString(), node: process.version, platform: platform(), osRelease: release(),
  cpu: cpus()[0]?.model, warmups, repetitions,
  scope: 'Pure domain operations after module loading; first call and warm samples are separate. Not a browser, network, database, or Android startup benchmark.', rows };
if (output) {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`);
}
