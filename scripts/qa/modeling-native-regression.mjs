import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {_android as android} from 'playwright';

const option=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const serial=option('serial',''),language=option('language','ru'),dark=option('dark','false')==='true';
if(!serial||!/^[-\w]+$/.test(serial))throw Error('Pass an explicit authorized --serial');
if(!['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'].includes(language))throw Error('Unknown language');
const output=resolve(option('output',`output/qa/android334-modeling-${serial}-${language}-${dark}`));
if(!output.startsWith(resolve('output/qa')+'/')&&!output.startsWith(resolve('output/qa')+'\\'))throw Error('QA output boundary');
mkdirSync(output,{recursive:true});
const sdk=process.env.ANDROID_HOME??join(process.env.LOCALAPPDATA,'Android/Sdk');
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');
const pkg='ru.genesis.calendar.qa1103.release',activity='ru.genesis.calendar.ModelingReleaseQaActivity';
const run=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:45000}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[],errors=[];
let devices=[];
try {
  // This minified package is built with a fake gateway; production cannot enter this host.
  run('shell','am','start','-S','-W','-n',`${pkg}/${activity}`,'--es','language',language,'--ez','dark',String(dark),'--el','seed','4294967295');
  // Android's WebView transport avoids desktop-only Browser context commands.
  // Driver installation is unnecessary: all native input uses the selected ADB serial.
  devices=await android.devices({omitDriverInstall:true});
  const device=devices.find(candidate=>candidate.serial()===serial);
  if(!device)throw Error('The explicitly selected Android device is unavailable');
  const webview=await device.webView({pkg},{timeout:20000});
  const page=await webview.page();
  if(page.url()!=='https://appassets.androidplatform.net/aurora/index.html')throw Error('The local signed modeling entry is not open');
  page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForSelector('.gno-dialog select',{timeout:20000});
  const check=async domain=>{
    const state=await page.evaluate(()=>({cards:document.querySelectorAll('.gno-tile').length,
      bodyHeight:document.querySelector('.gno-body')?.getBoundingClientRect().height??0,
      overflow:document.documentElement.scrollWidth>innerWidth,
      language:document.querySelector('.gno-dialog')?.lang,
      step:document.querySelector('.gno-progress [aria-current]')?.textContent}));
    results.push({domain,...state});
    if(errors.length||state.cards!==9||state.bodyHeight<100||state.overflow||state.language!==language)
      throw Error(`Second-step regression in domain ${domain}: ${JSON.stringify({state,errors})}`);
  };
  for(let domain=0;domain<13;domain++) {
    await page.locator('.gno-progress button').first().click();
    await page.locator('.gno-intake select').nth(0).selectOption(String(domain));
    await page.locator('.gno-intake select').nth(1).selectOption('0');
    const fields=page.locator('.gno-intake select');
    if(await fields.count()!==8)throw Error('The complete intake controls did not appear');
    for(let index=2;index<8;index++) {
      const field=fields.nth(index);
      await field.selectOption(index===6?'10':await field.locator('option:not([disabled])').first().getAttribute('value'));
    }
    await page.locator('.gno-footer .primary-button').click();
    await page.waitForSelector('.gno-workspace',{timeout:10000});
    await check(domain);
    if(domain===3) {
      await page.waitForFunction(()=>[...document.querySelectorAll('.gno-art .stoicheion-card-artwork')].every(image=>image.complete&&image.naturalWidth>0),null,{timeout:15000});
      const art=await page.locator('.gno-art .stoicheion-card-visual').evaluateAll(cards=>cards.map(card=>({
        card:card.getBoundingClientRect().toJSON(),image:card.querySelector('img').getBoundingClientRect().toJSON(),
        loaded:card.querySelector('img').naturalWidth,title:getComputedStyle(card.querySelector('.stoicheion-card-title')).fontSize,
        caption:getComputedStyle(card.querySelector('.stoicheion-card-caption')).fontSize,
      })));
      writeFileSync(join(output,'home-art-layout.json'),JSON.stringify(art,null,2));
      await page.screenshot({path:join(output,'home-second-step-webview.png')});
      writeFileSync(join(output,'home-second-step-native.png'),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{windowsHide:true,timeout:10000}));
    }
  }
  // The native Back path must flush the synthetic encrypted draft and dismiss the window.
  run('shell','input','keyevent','4');
  let closed=false;
  for(let attempt=0;attempt<60;attempt++) {
    const resumed=run('shell','dumpsys','activity','activities').split('\n').filter(line=>/topResumedActivity|mResumedActivity/.test(line)).join('\n');
    if(!resumed.includes(activity)){closed=true;break;}
    await sleep(250);
  }
  if(!closed)throw Error('Native Back did not dismiss the healthy modeling window');
  writeFileSync(join(output,'results.json'),JSON.stringify({status:'PASS',serial,language,dark,domains:results.length,results,errors,nativeBack:closed},null,2));
  console.log(JSON.stringify({status:'PASS',serial,language,dark,domains:results.length,nativeBack:closed}));
} catch(error) {
  writeFileSync(join(output,'results.json'),JSON.stringify({status:'FAIL',serial,language,dark,results,errors,error:String(error)},null,2));
  throw error;
} finally {
  await Promise.all(devices.map(device=>device.close().catch(()=>undefined)));
}
