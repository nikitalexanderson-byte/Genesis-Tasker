import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { calendarModule } from './helpers/calendar-modules.mjs';
const feedback = calendarModule('app/habit-feedback.ts');

test('old settings keep sound off; three schemes round trip and unknown values fall back', () => {
  assert.equal(feedback.normalizeHabitFeedbackSettings().sound, false);
  assert.equal(feedback.normalizeHabitFeedbackSettings().soundScheme, 'calm');
  for (const soundScheme of feedback.HABIT_SOUND_SCHEMES) {
    assert.equal(feedback.normalizeHabitFeedbackSettings({ soundScheme, sound: true }).soundScheme, soundScheme);
  }
  assert.equal(feedback.normalizeHabitFeedbackSettings({soundScheme:'invalid'}).soundScheme, 'calm');
});

test('sound and haptics are independent; unsupported effects cannot break completion', () => {
  const played = [], vibrated = [];
  const oldWindow = globalThis.window, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { Audio: class {
    constructor(url) { this.url = url; }
    pause() {}
    play() { played.push(this.url); return Promise.resolve(); }
  } };
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ vibrate(pattern) { vibrated.push(pattern); } } });
  try {
    feedback.deliverHabitFeedback('completion', feedback.normalizeHabitFeedbackSettings());
    assert.deepEqual(played, []); assert.deepEqual(vibrated, []);
    feedback.deliverHabitFeedback('quest', feedback.normalizeHabitFeedbackSettings({ sound: true, soundScheme:'futuristic' }));
    assert.deepEqual(played, ['/feedback-audio/futuristic-quest.wav']); assert.deepEqual(vibrated, []);
    feedback.deliverHabitFeedback('rank-up', feedback.normalizeHabitFeedbackSettings({haptics:true}));
    assert.equal(played.length, 1); assert.equal(vibrated.length, 1);
    navigator.vibrate = () => { throw new Error('unsupported'); };
    assert.doesNotThrow(() => feedback.deliverHabitFeedback('achievement', feedback.normalizeHabitFeedbackSettings({haptics:true,sound:true,soundScheme:'epic'})));
    assert.equal(played.at(-1), '/feedback-audio/epic-achievement.wav');
    window.Audio = class { constructor() { throw new Error('no audio output'); } };
    assert.doesNotThrow(() => feedback.deliverHabitFeedback('completion', {...feedback.DEFAULT_HABIT_FEEDBACK_SETTINGS,sound:true}));
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator;
  }
});

test('all 18 authored sounds are distinct, short stereo PCM files with soft tails and ample headroom', () => {
  const root = new URL('../public/feedback-audio/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json',root)));
  assert.equal(manifest.files.length,18);
  const hashes = new Set();
  for(const scheme of feedback.HABIT_SOUND_SCHEMES) for(const kind of feedback.HABIT_FEEDBACK_KINDS) {
    const filename = `${scheme}-${kind}.wav`, entry = manifest.files.find(file=>file.file===filename);
    assert.ok(entry); assert.ok(entry.seconds>.3 && entry.seconds<1);
    const wav = readFileSync(new URL(filename,root));
    assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.toString('ascii',8,12),'WAVE');
    assert.equal(wav.readUInt16LE(20),1); assert.equal(wav.readUInt16LE(22),2);
    assert.equal(wav.readUInt32LE(24),24000); assert.equal(wav.readUInt16LE(34),16);
    const hash=createHash('sha256').update(wav).digest('hex'); hashes.add(hash); assert.equal(hash,entry.sha256);
    const frames=(wav.length-44)/4; assert.ok(Math.abs(frames/24000-entry.seconds)<.002);
    let peak=0, energy=0;
    for(let offset=44; offset<wav.length; offset+=2){const value=wav.readInt16LE(offset)/32768;peak=Math.max(peak,Math.abs(value));energy+=value*value;}
    assert.ok(peak>.05 && peak<.4); assert.ok(Math.sqrt(energy/((wav.length-44)/2))>.01);
    for(let offset=wav.length-2400;offset<wav.length;offset+=2)assert.ok(Math.abs(wav.readInt16LE(offset))<150,'quiet final 25ms');
  }
  assert.equal(hashes.size,18);
});

test('feedback labels cover every scheme and event in all fourteen languages', () => {
  const copy=JSON.parse(readFileSync(new URL('../app/habit-feedback-copy.json',import.meta.url)));
  assert.equal(Object.keys(copy).length,14);
  for(const [language,text] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(text).sort(),Object.keys(copy.en).sort(),language);
    for(const value of Object.values(text))assert.ok(typeof value==='string'&&value.trim(),language);
    for(const scheme of feedback.HABIT_SOUND_SCHEMES)assert.ok(text[scheme]&&text[`${scheme}Hint`]);
    for(const kind of feedback.HABIT_FEEDBACK_KINDS)assert.ok(text[kind]);
  }
});

test('all three schemes survive a validated portable habit backup', async () => {
  const h=calendarModule('app/habits.ts'), backup=calendarModule('app/habit-backup.ts');
  for(const soundScheme of feedback.HABIT_SOUND_SCHEMES) {
    const workspace={...structuredClone(h.EMPTY_HABIT_WORKSPACE),habitSettings:{...h.EMPTY_HABIT_WORKSPACE.habitSettings,
      feedback:{...feedback.DEFAULT_HABIT_FEEDBACK_SETTINGS,sound:true,soundScheme}}};
    const original=JSON.stringify(workspace);
    const exported=await backup.createHabitBackup(workspace,'2026-10-29T12:00:00.000Z');
    const parsed=await backup.parseHabitBackup(JSON.stringify(exported));
    assert.equal(parsed.checksum,exported.checksum);
    assert.equal(parsed.data.habitSettings.feedback.soundScheme,soundScheme);
    assert.equal(parsed.data.habitSettings.feedback.sound,true);
    assert.equal(JSON.stringify(workspace),original);
  }
});

test('trials keep their progress when disabled and do not depend on decorative game widgets', () => {
  const h=calendarModule('app/habits.ts');
  const day='2026-10-29', habit={...h.defaultHabit(day,'profane'),id:'trial-habit',title:'Read'};
  const initial=h.normalizeHabitWorkspace({...structuredClone(h.EMPTY_HABIT_WORKSPACE),habits:[habit]},'profane',day);
  const completed=h.normalizeHabitWorkspace(h.updateHabitCompletion(initial,habit,day,{completed:true},day),'profane',day);
  assert.ok(completed.quests.length>0);
  const paused=h.normalizeHabitWorkspace({...completed,habitSettings:{...completed.habitSettings,feedback:{...completed.habitSettings.feedback,questsEnabled:false,gamificationWidgets:false}}},'profane',day);
  assert.deepEqual(paused.quests,completed.quests);
  const resumed=h.normalizeHabitWorkspace({...paused,habitSettings:{...paused.habitSettings,feedback:{...paused.habitSettings.feedback,questsEnabled:true}}},'profane',day);
  assert.deepEqual(resumed.quests.map(q=>[q.id,q.progress,q.completedAt]),completed.quests.map(q=>[q.id,q.progress,q.completedAt]));
});
