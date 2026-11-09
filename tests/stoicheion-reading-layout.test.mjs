import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {calendarModule} from './helpers/calendar-modules.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
const {splitStoicheionReading}=calendarModule('app/stoicheion-reading-layout.ts');
const source=ts.createSourceFile('stoicheion-data.ts',readFileSync(new URL('../app/stoicheion-data.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const ru={};
function visit(node){if(ts.isObjectLiteralExpression(node)){const properties=Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(source),p.initializer]));if(properties.id&&properties.content&&ts.isStringLiteral(properties.id)&&ts.isStringLiteral(properties.content))ru[properties.id.text]={content:properties.content.text};}ts.forEachChild(node,visit);}
visit(source);
test('both orientations are separated without losing any paragraph in all 336 localized cards',()=>{
 assert.equal(Object.keys(ru).length,24);
 for(const language of ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
  const cards=language==='ru'?ru:JSON.parse(readFileSync(new URL(`../app/catalog-translations/${language}.json`,import.meta.url),'utf8')).stoicheion;
  for(const [id,{content}] of Object.entries(cards)){
   const split=splitStoicheionReading(content,id);
   assert.ok(split.upright.length>30&&split.reversed.length>30,`${language}/${id}: orientation missing`);
   assert.deepEqual([split.upright,split.reversed,...split.profile.split(/\n\s*\n/)].sort(),content.split(/\n\s*\n/).sort(),`${language}/${id}: content lost`);
   if(language==='ru'){assert.match(split.upright,/^Парадное положение/);assert.match(split.reversed,/^Перев[её]рнутое положение/);}
  }
 }
 assert.throws(()=>splitStoicheionReading('Changed text','alpha'),/MISMATCH/);
});
