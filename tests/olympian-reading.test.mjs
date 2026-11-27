import { REGION_LANGUAGES } from "../app/region-language.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const data=read('app/olympian-knowledge.json');
const original=read('app/olympian-isopsephy.json');
const {greekIsopsephy,restorationRoot}=calendarModule('app/stoicheion-restoration-math.ts');
const {olympianLetterEquation,expandOlympianEquations,olympianBalance}=calendarModule('app/olympian-reading-math.ts');

test('each deity has exactly nine additional words covering every root without replacing the original words',()=>{
  for(const [id,deity] of Object.entries(data.deities)){
    assert.equal(deity.rootWords.length,9,id);
    assert.equal(new Set(deity.rootWords.map(w=>w.greek)).size,9,id);
    assert.deepEqual(deity.rootWords.map(w=>restorationRoot(greekIsopsephy(w.greek))),[1,2,3,4,5,6,7,8,9],id);
    for(const word of deity.rootWords){
      assert.match(word.greek,/^[Α-Ω]+$/u);
      assert.ok(!deity.words.some(old=>old.greek===word.greek),`${id}/${word.greek}`);
      assert.ok(!deity.variants.some(old=>old.greek===word.greek),`${id}/${word.greek}: already a name variant`);
    }
  }
});

test('all 78 pairs have a sourced myth, a life reading and a contextual Greek word with the combined root',()=>{
  assert.equal(data.interactions.length,78);
  const seen=new Set();
  for(const pair of data.interactions){
    const key=[...pair.ids].sort().join('/');assert.ok(!seen.has(key),key);seen.add(key);
    assert.equal(pair.ids.length,2);
    const gods=pair.ids.map(id=>original.deities.find(d=>d.id===id));assert.ok(gods.every(Boolean));
    assert.equal(restorationRoot(greekIsopsephy(pair.word.greek)),restorationRoot(gods[0].number+gods[1].number),key);
    assert.ok(pair.myth&&pair.life&&pair.practice);
    assert.ok(pair.sourceIds.length&&pair.sourceIds.every(id=>data.sources.some(s=>s.id===id)));
    const balance=olympianBalance(gods[0].number,gods[1].number);
    assert.equal(restorationRoot(balance.total),6,key);
    assert.equal(restorationRoot(balance.alternative.total),6,key);
    assert.equal(balance.total,balance.sum+greekIsopsephy(balance.letter));
    assert.equal(balance.alternative.total,balance.sum+greekIsopsephy(balance.alternative.letter));
    assert.notEqual(balance.total,balance.alternative.total);
  }
  const aresAthena=data.interactions.find(p=>p.ids.includes('ares')&&p.ids.includes('athena'));
  assert.equal(aresAthena.word.greek,'ΕΡΙΣ');
});

test('every printed name calculation contains the actual letters and values',()=>{
  assert.equal(olympianLetterEquation('Ζεύς'),'Ζ(7) + Ε(5) + Υ(400) + Σ(200) = 612');
  assert.equal(expandOlympianEquations('ΖΕΥΣ = 612.'),'ΖΕΥΣ: Ζ(7) + Ε(5) + Υ(400) + Σ(200) = 612.');
  assert.equal(expandOlympianEquations('ΑΘΗΝΑ = 69; ΑΚΜΗ = 69.'),'ΑΘΗΝΑ: Α(1) + Θ(9) + Η(8) + Ν(50) + Α(1) = 69; ΑΚΜΗ: Α(1) + Κ(20) + Μ(40) + Η(8) = 69.');
  for(const word of Object.values(data.deities).flatMap(d=>[...d.words,...d.rootWords])){
    const equation=olympianLetterEquation(word.greek);
    assert.ok(equation.endsWith(`= ${greekIsopsephy(word.greek)}`));
    for(const letter of word.greek)assert.ok(equation.includes(`${letter}(${greekIsopsephy(letter)})`));
  }
});

test('reader copy keeps the agreed voice and explains the sacred meaning of every root in all languages',()=>{
  const ru=read('app/olympian-knowledge-copy/ru.json');
  assert.equal(ru.mathematicalReading,'Это математическое прочтение Ордена Авроры пифагорейским методом.');
  for(const lang of [...REGION_LANGUAGES]){
    const copy=read(`app/olympian-knowledge-copy/${lang}.json`);
    for(let i=1;i<=9;i++)assert.ok(copy[`rootName.${i}`]&&copy[`rootMeaning.${i}`],`${lang}/${i}`);
    for(const deity of Object.values(data.deities))for(const word of deity.rootWords)assert.ok(copy[word.meaning]&&copy[word.note]);
    for(const pair of data.interactions)for(const key of [pair.myth,pair.life,pair.practice,pair.word.meaning,pair.word.note])assert.ok(copy[key],`${lang}/${key}`);
  }
  assert.doesNotMatch(Object.values(ru).join('\n'),/можно предложить|версии нужно показывать|было бы новым|не приписывается архаическому|не служит прогнозом|не доказывает тождества|GENESIS добавляет/iu);
});
