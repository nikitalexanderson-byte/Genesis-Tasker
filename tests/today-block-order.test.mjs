import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {TODAY_BLOCK_IDS,todayBlockOrder,effectiveTodayBlockOrder,moveTodayBlock,availableTodayBlockStorage,readTodayBlockOrder,storeTodayBlockOrder} from '../app/today-block-order.ts';
import {uiVisibility} from '../app/ui-visibility.ts';

test('default and invalid orders retain every movable block and never include the pinned hero',()=>{
  for(const input of [null,undefined,[],['hero'],['tasks','tasks'],['unknown'],{},['tasks',false]])assert.deepEqual(effectiveTodayBlockOrder(input),[...TODAY_BLOCK_IDS]);
  assert.equal(todayBlockOrder(['hero']),null);
  assert.deepEqual(todayBlockOrder(['tasks']),['tasks',...TODAY_BLOCK_IDS.filter(id=>id!=='tasks')]);
  assert.deepEqual(uiVisibility({todayBlockOrder:['tasks']}).todayBlockOrder,todayBlockOrder(['tasks']));
});

test('moving blocks changes real sequence without mutating caller settings or losing hidden slots',()=>{
  const before=[...TODAY_BLOCK_IDS],moved=moveTodayBlock(before,'details','advice');
  assert.equal(moved[0],'details');assert.deepEqual(before,[...TODAY_BLOCK_IDS]);
  assert.deepEqual([...moved].sort(),[...TODAY_BLOCK_IDS].sort());
  const visibility=uiVisibility({hiddenTodayBlocks:['rhythm','details'],todayBlockOrder:moved});
  assert.deepEqual(visibility.hiddenTodayBlocks,['rhythm','details']);assert.deepEqual(visibility.todayBlockOrder,moved);
});

test('device fallback is scoped to its owner and tolerates unavailable or corrupt storage',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const order=[...TODAY_BLOCK_IDS].reverse();assert.equal(storeTodayBlockOrder(storage,'owner-a',order),true);
  assert.deepEqual(readTodayBlockOrder(storage,'owner-a'),order);
  assert.deepEqual(readTodayBlockOrder(storage,'owner-b'),[...TODAY_BLOCK_IDS]);
  assert.deepEqual(readTodayBlockOrder(storage,'guest'),[...TODAY_BLOCK_IDS]);
  assert.equal(storeTodayBlockOrder(null,'guest',order),false);
  assert.equal(availableTodayBlockStorage(null),null);
  assert.equal(availableTodayBlockStorage(Object.defineProperty({},'localStorage',{get(){throw new DOMException('Synthetic blocked storage','SecurityError');}})),null);
  assert.equal(storeTodayBlockOrder({setItem(){throw new Error('Synthetic blocked storage');}},'guest',order),false);
  assert.deepEqual(readTodayBlockOrder({getItem:()=>'{broken'},'guest'),[...TODAY_BLOCK_IDS]);
});

test('real Today slots render in DOM order with the hero first and retain all eight editor identities',async()=>{
  const root=fileURLToPath(new URL('../app/',import.meta.url)).replaceAll('\\','/'),entry='virtual:today-block-order';
  const bundle=await build({configFile:false,logLevel:'silent',plugins:[react(),{name:'today-block-order',resolveId:id=>id===entry?entry:undefined,
    load:id=>id===entry?`export {TodayBlocks,TodayBlock} from ${JSON.stringify(root+'TodayBlocks.tsx')};export {TodayBlockOrderDialog} from ${JSON.stringify(root+'TodayBlockOrderDialog.tsx')};`:undefined}],
    build:{ssr:true,write:false,rolldownOptions:{input:entry,external:['react','react/jsx-runtime','react/jsx-dev-runtime'],output:{codeSplitting:false}}}});
  const directory=new URL('../node_modules/.cache/genesis-tests/',import.meta.url);await mkdir(directory,{recursive:true});
  const file=new URL(`today-order-${randomUUID()}.mjs`,directory);await writeFile(file,bundle.output.find(value=>value.isEntry).code);
  try{
    const {TodayBlocks,TodayBlock,TodayBlockOrderDialog}=await import(pathToFileURL(fileURLToPath(file)).href);
    const order=[...TODAY_BLOCK_IDS].reverse(),children=[...TODAY_BLOCK_IDS,'hero'].map(id=>createElement(TodayBlock,{id,key:id},id==='ads'?null:createElement('section',null,id)));
    const html=renderToStaticMarkup(createElement(TodayBlocks,{order},children));
    assert.deepEqual([...html.matchAll(/data-today-block="([^"]+)"/g)].map(match=>match[1]),['hero',...order]);
    assert.ok(html.indexOf('>details</section>')<html.indexOf('>advice</section>'));
    const editor=renderToStaticMarkup(createElement(TodayBlockOrderDialog,{order,language:'ru',onSave(){},onClose(){}}));
    assert.deepEqual([...editor.matchAll(/data-order-block="([^"]+)"/g)].map(match=>match[1]),order);
    assert.ok(!editor.includes('data-order-block="hero"'));assert.match(editor,/Дата и часы всегда сверху/);
  }finally{await rm(file);}
});

test('all fourteen editor locales name every block and keyboard/touch action',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/today-block-order-copy.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(copy).sort(),['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'].sort());
  const fields=Object.keys(copy.ru).sort();
  for(const [language,messages]of Object.entries(copy)){
    assert.deepEqual(Object.keys(messages).sort(),fields,language);
    for(const value of Object.values(messages))assert.ok(typeof value==='string'&&value.trim(),language);
    for(const id of TODAY_BLOCK_IDS)assert.ok(messages[id].trim(),`${language}:${id}`);
  }
});
