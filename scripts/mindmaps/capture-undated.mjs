import {chromium} from './browser.mjs';
import {readFileSync} from 'node:fs';
const result=JSON.parse(readFileSync('output/mindmaps-undated-result.json'));
const b=await chromium.launch({headless:true,channel:'chrome'});const c=await b.newContext({storageState:'output/undated-state.json',viewport:{width:390,height:960}});const p=await c.newPage();
await p.goto('http://127.0.0.1:4319/#projects');await p.getByRole('button',{name:'Создать задачу',exact:true}).click();const d=p.getByRole('dialog');await d.getByRole('textbox',{name:'Новая задача',exact:true}).fill('Обдумать следующий шаг');await d.getByRole('checkbox',{name:'Без даты',exact:true}).check();
for(const theme of ['standart','standart-dark']) for(const width of [320,360,390,768,1440]) {
 await p.setViewportSize({width,height:960});await p.evaluate(t=>{document.documentElement.dataset.genesisTheme=t;window.scrollTo({top:0,left:0,behavior:"instant"})},theme);
 await d.evaluate(e=>{document.activeElement?.blur();const parents=[];for(let el=e;el;el=el.parentElement)parents.push(el);for(const el of [...parents,...e.querySelectorAll('*')]) el.scrollTo({top:0,left:0,behavior:'instant'});});
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 console.log(theme,width,await d.evaluate(e=>({top:e.getBoundingClientRect().top,scroll:window.scrollY})));
 await p.screenshot({path:`output/playwright/mindmaps/undated/form-${theme}-${width}.png`,fullPage:false,animations:'disabled'});
}
await p.keyboard.press('Escape');await p.goto(result.mapUrl);await p.getByRole('button',{name:'Структура',exact:true}).click();
console.log('Captured undated composer from its top at all 10 theme/width states.');await b.close();
