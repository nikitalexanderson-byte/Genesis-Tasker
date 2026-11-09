import test from 'node:test';
import assert from 'node:assert/strict';
import {DreamDictation} from '../app/dream-dictation.ts';
import {appendDictation,dictationLocale,formatDictation} from '../app/dictation-text.ts';

function fixture() {
  const engines=[],final=[],confirmed=[],partials=[],states=[],failures=[];
  class Engine {
    constructor(){engines.push(this);}
    start(){} stop(){this.stopped=true;} abort(){this.aborted=true;}
    result(...results){this.onresult?.({results:results.map(([transcript,isFinal])=>({0:{transcript},isFinal}))});}
  }
  const voice=new DreamDictation(Engine,'ru-RU',{text:(value,isConfirmed)=>{final.push(value);confirmed.push(isConfirmed);},partial:value=>partials.push(value),
    listening:value=>states.push(value),failure:()=>failures.push(true)});
  voice.start();
  return {voice,engines,final,confirmed,partials,states,failures};
}

test('a revised live hypothesis appears immediately and the final is committed exactly once',()=>{
  const f=fixture(),engine=f.engines[0];
  assert.equal(engine.interimResults,true);
  engine.result(['я вижу',false]);engine.result(['я вижу лес',false]);
  assert.deepEqual(f.partials,['я вижу','я вижу лес']);assert.deepEqual(f.final,[]);
  engine.result(['я вижу лес',true]);engine.result(['я вижу лес',true]);
  engine.result(['я вижу лес',true],['рядом река',true]);
  assert.deepEqual(f.final,['я вижу лес','рядом река']);assert.deepEqual(f.confirmed,[true,true]);f.voice.cancel();
});

test('Stop accepts a final correction instead of persisting a stale hypothesis',()=>{
  const f=fixture(),engine=f.engines[0];engine.result(['серый кот',false]);f.voice.stop();
  assert.equal(engine.stopped,true);engine.result(['белый кот',true]);engine.onend();
  assert.deepEqual(f.final,['белый кот']);assert.equal(f.states.at(-1),false);
});

test('a bounded stop preserves heard text once and ignores late provider callbacks',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),engine=f.engines[0];engine.result(['тихий берег',false]);
  const lateResult=engine.onresult,lateEnd=engine.onend;f.voice.stop();t.mock.timers.tick(1500);
  assert.deepEqual(f.final,['тихий берег']);assert.deepEqual(f.confirmed,[false]);
  lateResult({results:[{0:{transcript:'чужой поздний текст'},isFinal:true}]});lateEnd();
  assert.deepEqual(f.final,['тихий берег']);assert.equal(f.engines.length,1);
});

test('cancel returns the visible hypothesis for draft saving without dispatching stale text',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),engine=f.engines[0];engine.result(['мой черновик',false]);
  const late=engine.onresult;assert.equal(f.voice.cancel(),'мой черновик');t.mock.timers.tick(3000);
  late({results:[{0:{transcript:'поздно'},isFinal:true}]});assert.deepEqual(f.final,[]);assert.equal(engine.aborted,true);
});

test('natural phrase boundaries restart quickly while silence retries remain bounded',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();f.engines[0].result(['первое предложение',true]);f.engines[0].onend();
  t.mock.timers.tick(150);assert.equal(f.engines.length,2);
  f.engines[1].onerror({error:'no-speech'});t.mock.timers.tick(150);assert.equal(f.engines.length,3);
  f.engines[2].onerror({error:'no-speech'});t.mock.timers.tick(5000);
  assert.equal(f.engines.length,3);assert.equal(f.states.at(-1),false);
  assert.deepEqual(f.final,['первое предложение']);
});

test('formatting keeps dictated sentences together and leaves prior text intact',()=>{
  const previous='Моя запись\nСсылка https://example.org и код AbC-123.\n\n';
  const first=appendDictation(previous,formatDictation('мне приснился лес , рядом река','ru'),'ru');
  const next=appendDictation(first,formatDictation('я проснулся!','ru'),'ru');
  assert.equal(next,previous+'Мне приснился лес, рядом река. Я проснулся!');
  assert.equal(formatDictation('«тихий берег»','ru'),'«Тихий берег.»');
  assert.equal(formatDictation('лес','ru',false),'Лес');
  assert.equal(formatDictation('https://example.org','ru'),'https://example.org.');
  assert.equal(appendDictation('夢です。',formatDictation('私は歩く','ja'),'ja'),'夢です。私は歩く。');
  assert.equal(formatDictation('istanbul güzel','tr'),'İstanbul güzel.');
  assert.equal(dictationLocale('uk'),'uk-UA');
});
