import assert from 'node:assert/strict';import test from 'node:test';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';import {fileURLToPath,pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {build} from 'vite';import react from '@vitejs/plugin-react';

test('real habit reports render every language in all four calendars without moving dates or translating user content',async()=>{
 const root=fileURLToPath(new URL('../app/',import.meta.url)).replaceAll('\\','/'),entry='virtual:habit-report-contract';
 const bundle=await build({configFile:false,logLevel:'silent',plugins:[react(),{name:'habit-report-contract',resolveId:id=>id===entry?entry:undefined,
  load:id=>id===entry?`export {HabitInsightsPanel} from ${JSON.stringify(root+'HabitInsightsPanel.tsx')};export * from ${JSON.stringify(root+'i18n.ts')};export * from ${JSON.stringify(root+'habits.ts')};export {formatCalendarDateValue} from ${JSON.stringify(root+'calendar-data.ts')};`:undefined}],
  build:{ssr:true,write:false,rolldownOptions:{input:entry,external:['react','react/jsx-runtime','react/jsx-dev-runtime'],output:{codeSplitting:false}}}});
 const dir=new URL('../node_modules/.cache/genesis-tests/',import.meta.url);await mkdir(dir,{recursive:true});const file=new URL('habit-report-'+randomUUID()+'.mjs',dir);
 await writeFile(file,bundle.output.find(item=>item.isEntry).code);
 try{
  const {HabitInsightsPanel,LANGUAGES,setRuntimeLanguage,formatTranslatedText,translateText,EMPTY_HABIT_WORKSPACE,defaultHabit,formatCalendarDateValue}=await import(pathToFileURL(fileURLToPath(file)).href);
  const habit={...defaultHabit('2024-03-19','profane'),id:'render-history',title:'Моя запись · 日本語 · Ελληνικά',createdDate:'2024-03-19'};
  const workspace={...structuredClone(EMPTY_HABIT_WORKSPACE),habits:[habit]},before=JSON.stringify(workspace);
  for(const language of LANGUAGES){setRuntimeLanguage(language);
   for(const [calendarMode,gregorianYearStart]of [['profane','january'],['profane','march'],['sacred','january'],['lunar','january']]){
    const reportContext={version:2,timeZone:'America/New_York',gregorianYearStart};
    const html=renderToStaticMarkup(createElement(HabitInsightsPanel,{workspace,date:'2024-03-20',language,calendarMode,reportContext}));
    assert.ok(html.includes(habit.title),language+': user title was translated');
    assert.ok(html.includes(formatCalendarDateValue(habit.createdDate,calendarMode,true,reportContext)),language+': the record date lost its report context');
    assert.ok(html.includes(translateText('Индекс Ритма',language)),language+': report copy was not localized during render');
    assert.doesNotMatch(html,/\{(?:count|value|year|qualified|perfect|target)\}/);
    if(language!=='ru')assert.ok(!html.includes('Мозаика года'),language+': Russian heading leaked');
   }
   const user='Собственное название <日本語>';
   assert.equal(formatTranslatedText('Выполнено: {count}',language,{count:user}).includes(user),true);
   const number=new Intl.NumberFormat(language).format(12345.5);
   assert.ok(formatTranslatedText('Индекс Ритма {value} из 100',language,{value:number}).includes(number));
  }
  assert.equal(JSON.stringify(workspace),before);
 }finally{await rm(file);}
});

test('report sentence parameters are complete and authored in all fourteen languages',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../app/habit-report-translations.json',import.meta.url),'utf8'));
 const keys=['Выполнено: {count}','Индекс Ритма {value} из 100','{year} · дней с целью: {qualified} · идеальных: {perfect}','Мозаика активности привычек за {year} год','Рубеж {count}','{count} до {target}'];
 const params=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 for(const [language,copy]of Object.entries(catalog))for(const key of keys){assert.ok(copy[key]?.trim(),language+': '+key);assert.deepEqual(params(copy[key]),params(key));if(language!=='en')assert.notEqual(copy[key],catalog.en[key],language+': untranslated sentence');}
});
