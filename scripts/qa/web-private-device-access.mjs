import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

// Real two-browser product enrollment. Only the existing synthetic identity
// provider is supplied by the fixture; no recovery secret opens the new device.
export async function checkPrivateDeviceAccess({browser,page,baseURL,output,login,check,report,canary,rememberSecret,withRateRetry}) {
 const read=name=>JSON.parse(readFileSync(`contracts/e2ee/${name}-copy-v1.json`,'utf8')).ru;
 const c=read('personal-device-entry'),d=read('device-access'),common=read('shared-security'),v=read('vault');
 let clean,fresh,localCode;const pageErrors=[];
 try {
  await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
  await page.locator('[data-settings-tab=account]').click();
  const ownerPanel=page.locator('section.account-preferences').filter({has:page.getByRole('heading',{name:d.title,exact:true})}).last();
  await ownerPanel.getByRole('button',{name:c.targetExport,exact:true}).click();
  const target=ownerPanel.getByRole('textbox',{name:c.target,exact:true});await target.waitFor();
  const targetJson=await target.inputValue(),targetFingerprint=await ownerPanel.locator('code.private-shared-fingerprint').first().innerText();
  assert.match(targetFingerprint,/^[A-Za-z0-9_-]{20,128}$/);
  clean=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU',acceptDownloads:true});
  await clean.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
  await clean.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
  await login(clean);fresh=await clean.newPage();fresh.setDefaultTimeout(30000);
  report.deviceRefusals=[];report.deviceApiErrors=[];
  fresh.on('console',message=>{const prefix='GENESIS_QA_DEVICE_REFUSAL ';if(message.text().startsWith(prefix))report.deviceRefusals.push(message.text().slice(prefix.length));});
  if(process.env.GENESIS_QA_DIAGNOSTIC_BUNDLE){
   const debug=await clean.newCDPSession(fresh);await debug.send('Debugger.enable');
   const directory=path.join(process.env.GENESIS_QA_DIAGNOSTIC_BUNDLE,'assets');
   for(const artifact of readdirSync(directory).filter(name=>/^[\w-]+\.js$/.test(name))){
    const source=readFileSync(path.join(directory,artifact),'utf8');
    for(const match of source.matchAll(/([A-Za-z_$][\w$]*)\s+instanceof Error\s*&&\s*\1\.message\s*===\s*["']E2EE_CHALLENGE_EXPIRED["']/g)){
     const before=source.slice(0,match.index),lineNumber=before.split('\n').length-1,columnNumber=match.index-before.lastIndexOf('\n')-1,variable=match[1];
     const condition=`(()=>{const code=typeof ${variable}==='object'&&${variable} instanceof Error?${variable}.message:'';console.info('GENESIS_QA_DEVICE_REFUSAL '+(/^E2EE_[A-Z_]+$/.test(code)?code:'NON_TECHNICAL_ERROR'));return false;})()`;
     await debug.send('Debugger.setBreakpointByUrl',{url:baseURL+'/assets/'+artifact,lineNumber,columnNumber,condition});
    }
   }
  }
  fresh.on('pageerror',error=>pageErrors.push(error.name));
  fresh.on('response',async response=>{
   const url=new URL(response.url());if(url.origin!==baseURL||!/^\/api\/e2ee\/v1\/[a-z-]+$/.test(url.pathname))return;
   if(response.status()===429){const seconds=Number(response.headers()['retry-after']);report.rateLimits.push({path:url.pathname,action:null,observedAt:Date.now(),retryAfterSeconds:seconds>=1&&seconds<=600?seconds:600});}
   if(!response.ok()){const body=await response.json().catch(()=>null),code=typeof body?.error==='string'&&/^(?:E2EE_[A-Z_]+|API_RATE_LIMIT)$/.test(body.error)?body.error:'UNCLASSIFIED_HTTP_REFUSAL';report.deviceApiErrors.push({path:url.pathname,status:response.status(),code});}
  });
  await fresh.goto('/?lang=ru#today');const gate=fresh.locator('.private-vault-dialog');await gate.waitFor();
  await check('Google identity alone keeps the clean second browser locked',async()=>{
   assert.equal(await fresh.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).count(),0);
   assert.equal(await gate.locator('input[type=password]').inputValue(),'');
  });
  await gate.getByRole('button',{name:c.title,exact:true}).click();
  const entry=gate.locator('section').filter({has:fresh.getByRole('heading',{name:c.title,exact:true})}).first();
  await check('trusted-device form uses its full column in both themes at all required widths',async()=>{
   report.deviceVisualCases=[];
   for(const scheme of ['light','dark']){
    const session=await(await clean.request.get('/api/session')).json();
    const preference=await clean.request.put('/api/account/preferences',{headers:{Origin:baseURL,'X-CSRF-Token':session.csrf},data:{theme:scheme==='dark'?'standart-dark':'standart',expectedThemeRevision:session.user.themeRevision}});
    assert(preference.ok(),'Owned public theme preference');await fresh.reload();await gate.getByRole('button',{name:c.title,exact:true}).click();
    for(const width of [360,390,768,1440]){
     await fresh.setViewportSize({width,height:1000});await entry.waitFor();
     const geometry=await entry.evaluate(element=>{const bounds=element.getBoundingClientRect(),parent=element.parentElement.getBoundingClientRect();return{width:bounds.width,parentWidth:parent.width,left:bounds.left,right:bounds.right,viewport:innerWidth,overflow:element.scrollWidth>element.clientWidth+2};});
     assert(geometry.width>=Math.min(240,width-96)&&geometry.left>=0&&geometry.right<=width+2&&!geometry.overflow,'The trusted-device form must stay inside its available column');
     const artifact=`trusted-device-${scheme}-${width}.png`;await fresh.screenshot({path:`${output}/${artifact}`,animations:'disabled',mask:[fresh.locator('input,textarea')]});
     report.deviceVisualCases.push({scheme,width,status:'PASS',geometry,artifact});
    }
   }
  });
  await entry.getByRole('button',{name:c.generate,exact:true}).click();
  localCode=await entry.getByRole('textbox',{name:c.localCode,exact:true}).inputValue();assert.match(localCode,/^[A-Za-z0-9_-]{43}$/);rememberSecret(localCode);
  await entry.getByRole('checkbox',{name:c.codeSaved,exact:true}).check();
  await entry.getByRole('textbox',{name:c.target,exact:true}).fill(targetJson);
  await entry.getByRole('button',{name:c.inspect,exact:true}).click();
  const compared=entry.getByRole('textbox',{name:d.compare,exact:true});await compared.waitFor();
  await check('enrollment requires the separately compared target fingerprint',async()=>{
   await compared.fill('incorrect-fingerprint');assert(await entry.getByRole('button',{name:d.create,exact:true}).isDisabled());
   await compared.fill(targetFingerprint);assert(await entry.getByRole('button',{name:d.create,exact:true}).isEnabled());
  });
  await entry.getByRole('button',{name:d.create,exact:true}).click();
  const request=entry.getByRole('textbox',{name:d.request,exact:true});
  const created=await Promise.race([request.waitFor().then(()=>true),entry.getByRole('alert').waitFor().then(()=>false)]);
  assert(created,'Device request refused: '+report.deviceRefusals.join(',')+'; '+report.deviceApiErrors.map(row=>row.code).join(','));
  const requestJson=await request.inputValue(),requestFingerprint=await entry.locator('code.private-shared-fingerprint').last().innerText();
  await ownerPanel.getByRole('textbox',{name:d.incoming,exact:true}).fill(requestJson);
  await ownerPanel.getByRole('button',{name:common.load,exact:true}).last().click();
  const ownerCompared=ownerPanel.getByRole('textbox',{name:d.compare,exact:true});await ownerCompared.waitFor();
  assert.equal(await ownerPanel.locator('code.private-shared-fingerprint').last().innerText(),requestFingerprint);
  await check('the current owner must compare the requesting device before approval',async()=>{
   await ownerCompared.fill('incorrect-fingerprint');assert(await ownerPanel.getByRole('button',{name:d.approve,exact:true}).isDisabled());
   await ownerCompared.fill(requestFingerprint);await ownerPanel.getByRole('button',{name:d.approve,exact:true}).click();
   await ownerPanel.getByRole('textbox',{name:d.approval,exact:true}).waitFor();
  });
  const approval=await ownerPanel.getByRole('textbox',{name:d.approval,exact:true}).inputValue();
  await entry.getByRole('textbox',{name:d.approval,exact:true}).fill(approval);
  await entry.getByRole('button',{name:c.finish,exact:true}).click();await gate.waitFor({state:'hidden',timeout:120000});
  await check('approved second browser reads normal private content without a recovery secret',async()=>{
   await fresh.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor({timeout:60000});
   await fresh.screenshot({path:`${output}/approved-second-device.png`,fullPage:true,animations:'disabled',mask:[fresh.locator('input,textarea')]});
  });
  await check('approved device cold unlock uses its own local code and retained keys',async()=>{
   await withRateRetry('approved second device cold reader',async()=>{
    await fresh.reload();const locked=fresh.locator('.private-vault-dialog');await locked.waitFor();
    await locked.locator('input[type=password]').fill(localCode);await locked.getByRole('button',{name:v.unlock,exact:true}).click();
    await locked.waitFor({state:'hidden',timeout:120000});await fresh.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor({timeout:60000});
   });
   assert.deepEqual(pageErrors,[]);
  });
  report.deviceAccess={separateBrowser:true,recoverySecretSupplied:false,targetFingerprintCompared:true,deviceFingerprintCompared:true,normalContentRead:true,coldLocalCodeUnlock:true};
 } catch(error) {
  if(fresh){await fresh.screenshot({path:`${output}/device-access-failure.png`,animations:'disabled',mask:[fresh.locator('input,textarea')]}).catch(()=>{});const snapshot=await fresh.locator('body').ariaSnapshot().catch(()=>'');writeFileSync(`${output}/device-access-failure.txt`,localCode?snapshot.replaceAll(localCode,'[redacted synthetic local code]'):snapshot);}
  throw error;
 } finally {localCode=undefined;if(clean)await clean.close();}
}
