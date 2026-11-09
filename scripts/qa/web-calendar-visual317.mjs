import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const widths=[360,390,768,1440],schemes=['light','dark'];
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

/** Callback-only real UI regression. The caller owns the browser, synthetic runtime, trace and cleanup. */
export async function verifyCalendarVisual317({context,page,tier,output,check,snapshot}) {
  const origin=new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin),'Only an isolated loopback QA account is allowed');
  assert(['standart','premium','business','premium4life'].includes(tier),'18+ settings require a paid ordinary fixture');
  const session=await (await context.request.get('/api/session')).json();
  assert(session.user.email.endsWith('@example.invalid')&&!session.user.isAdmin,'An ordinary synthetic account is required');
  const language=session.user.language??'ru';
  const labels=JSON.parse(await readFile(new URL('../../app/daily-advice-copy.json',import.meta.url),'utf8'))[language];
  assert(labels,'Unsupported fixture language');
  assert(session.user.adviceAvailableCategories?.includes('aphrodisia'),'The real local catalog must expose Aphrodisia');
  const headers={Origin:origin,'X-CSRF-Token':session.csrf};
  const initial={url:page.url(),viewport:page.viewportSize(),theme:await page.locator('html').getAttribute('data-genesis-theme'),
    advice:structuredClone(session.user.advicePreferences??{}),visibility:structuredClone(session.user.uiVisibility??{})};
  const report={schemaVersion:1,gate:'calendar-visual317',planId:tier,language,startedAt:new Date().toISOString(),status:'RUNNING',
    beforeEvidence:'Scoped browser-only CSS controls reproduce the former desktop inline identity and margin:0 dialog placement. They are not an untouched older binary.',
    widths,schemes,cases:[],cleanup:{status:'PENDING'},
    limitations:['One ordinary paid synthetic tariff; this is layout/interaction coverage, not all-tariff entitlement coverage',
      'The fixture uses its real current language; northeast and west include the original short and multi-deity names',
      'CSS controls exist only in this browser document and are removed before after-captures']};
  const save=()=>writeFile(path.join(output,`${tier}-calendar-visual317.json`),JSON.stringify(report,null,2)+'\n');
  const prefs=async data=>{
    const response=await context.request.put('/api/account/preferences',{headers,data});
    assert(response.ok(),`Synthetic preference request failed: ${response.status()}`);return (await response.json()).user;
  };
  let visitNumber=0;
  const visit=async hash=>{const url=new URL(`/${hash}`,origin);url.searchParams.set('qa317visual',String(++visitNumber));await page.goto(url.href);};
  const screen=async(file)=>{
    await settled(page);await page.screenshot({path:path.join(output,file),fullPage:false,animations:'disabled'});return file;
  };
  const theme=async scheme=>{
    await page.locator('.theme-mode-toggle:visible:not([disabled])').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.theme-mode-toggle')].filter(el=>el.getClientRects().length).every(el=>el.getAttribute('aria-busy')!=='true'));
    const desired=scheme==='dark'?'standart-dark':'standart';
    if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)await page.locator('.theme-mode-toggle:visible').first().click();
    await page.waitForFunction(value=>document.documentElement.getAttribute('data-genesis-theme')===value,desired);
    await page.waitForFunction(()=>[...document.querySelectorAll('.theme-mode-toggle')].filter(el=>el.getClientRects().length).every(el=>el.getAttribute('aria-busy')!=='true'));
  };
  const run=async(id,operation)=>check(id,async()=>{
    const item={id,status:'RUNNING'};report.cases.push(item);await save();
    try{await operation(item);item.status='PASS';}
    catch(error){item.status='FAIL';item.error=error.message;throw error;}
    finally{await save();}
  });
  let originalCollapsed=null;
  const library=async()=>{
    await visit('#habits');await page.locator('[data-experimental-habit-tab="library"]').click();
    const section=page.locator('.sacred-habit-library');await section.waitFor();
    const toggle=section.locator('.habit-suggestions-toggle');
    const collapsed=await toggle.getAttribute('aria-expanded')==='false';
    if(originalCollapsed===null)originalCollapsed=collapsed;
    if(collapsed)await toggle.click();return section;
  };
  const managed=async dialog=>{await dialog.waitFor();await dialog.locator('[data-dialog-header-host]').first().waitFor();await settled(page);};
  const identityGeometry=dialog=>dialog.locator('.theokyklos-details-identity').evaluate(el=>{
    const label=el.querySelector(':scope > .eyebrow'),patron=el.querySelector(':scope > strong');
    const box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return {label:box(label),patron:box(patron),labelText:label.textContent.trim(),patronText:patron.textContent.trim(),
      identityOverflow:el.scrollWidth-el.clientWidth,dialogOverflow:el.closest('[role="dialog"]').scrollWidth-el.closest('[role="dialog"]').clientWidth};
  });
  const ageGeometry=dialog=>dialog.evaluate(el=>{
    const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
      centerDeltaX:Math.abs(r.x+r.width/2-innerWidth/2),centerDeltaY:Math.abs(r.y+r.height/2-innerHeight/2),
      nativeModal:el instanceof HTMLDialogElement&&el.open&&el.matches(':modal'),
      aboveSettings:hit===el||el.contains(hit),focusInside:el.contains(document.activeElement),
      labelId:el.getAttribute('aria-labelledby'),descriptionId:el.getAttribute('aria-describedby')};
  });
  const assertCentered=(geometry,label)=>{
    assert(geometry.nativeModal&&geometry.aboveSettings,`${label}: native modal must be above settings`);
    assert(geometry.focusInside,`${label}: initial focus must be inside the native modal`);
    assert(geometry.centerDeltaX<=1&&geometry.centerDeltaY<=1,`${label}: dialog not centered ${JSON.stringify(geometry)}`);
    assert(geometry.x>=-1&&geometry.y>=-1&&geometry.x+geometry.width<=geometry.viewportWidth+1&&geometry.y+geometry.height<=geometry.viewportHeight+1,`${label}: dialog exceeds viewport`);
    assert(geometry.labelId&&geometry.descriptionId,`${label}: native modal lost accessible labels`);
  };
  try {
    await prefs({uiVisibility:{...initial.visibility,sacredFeaturesEnabled:true},advicePreferences:{...initial.advice,
      enabled:true,smart:false,collections:['aurora'],categories:['aretology','aphrodisia'],aphrodisiaAdult:true}});
    for(const width of widths)for(const scheme of schemes) {
      await run(`calendar-visual317-deity-${width}-${scheme}`,async item=>{
        await page.setViewportSize({width,height:1000});await visit('#habits');await theme(scheme);
        item.sectors=[];
        for(const sectorId of ['northeast','west']) {
          const section=await library();await section.locator(`button[data-sector-id="${sectorId}"]`).click();
          const chooser=page.locator('.sacred-sector-modal');await managed(chooser);
          await chooser.locator('.sacred-sector-modal-actions > button').first().click();
          const dialog=page.locator('.theokyklos-details');await managed(dialog);
          await page.waitForFunction(()=>[...document.querySelectorAll('.theokyklos-details-symbol img,.theokyklos-details-art img')].every(img=>img.complete&&img.naturalWidth>0));
          const beforeControl=width>760;
          const control=beforeControl?await page.addStyleTag({content:'.theokyklos-details .theokyklos-details-identity{display:block!important}.theokyklos-details .theokyklos-details-identity>.eyebrow,.theokyklos-details .theokyklos-details-identity>strong{display:inline!important}'}):null;
          const record={sectorId,beforeControl,baselineKind:beforeControl?'simulated previous desktop CSS':'existing narrow layout; no control applied'};
          item.sectors.push(record);
          try {
            await settled(page);record.before=await identityGeometry(dialog);
            record.beforeEvidence=await screen(`${tier}-calendar-visual317-deity-${width}-${scheme}-${sectorId}-before.png`);
          } finally {if(control)await control.evaluate(el=>el.remove());}
          await settled(page);record.after=await identityGeometry(dialog);
          record.afterEvidence=await screen(`${tier}-calendar-visual317-deity-${width}-${scheme}-${sectorId}-after.png`);
          assert(record.after.labelText&&record.after.patronText,'Original localized sector/patron text must remain');
          assert(record.after.patron.y>=record.after.label.bottom-1,`${width}/${scheme}/${sectorId}: patron must start on its own line`);
          assert(record.after.identityOverflow<=1&&record.after.dialogOverflow<=1,`${width}/${scheme}/${sectorId}: localized identity overflows`);
          if(beforeControl&&sectorId==='northeast')assert(record.before.patron.y<record.before.label.bottom-1,'The desktop inline negative control must reproduce the reported defect');
          if(snapshot)await snapshot(`calendar-visual317-deity-${width}-${scheme}`);
          await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
        }
      });
      await run(`calendar-visual317-age-${width}-${scheme}`,async item=>{
        await page.setViewportSize({width,height:1000});await visit('#today');await theme(scheme);
        await page.locator('.account-open:visible').first().click();
        const account=page.locator('.account-panel');await account.waitFor();await account.locator('[data-settings-tab="appearance"]').click();
        const trigger=account.locator('.daily-advice-age-setting button');await trigger.scrollIntoViewIfNeeded();
        item.scrolledParents=await trigger.evaluate(el=>{
          const parents=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(p).overflowY))parents.push({className:p.className,scrollTop:p.scrollTop});return parents;
        });
        assert(item.scrolledParents.some(parent=>parent.scrollTop>0),'The confirmation must be opened from genuinely scrolled settings');
        const dialog=page.locator('dialog.daily-advice-age-dialog');
        const open=async()=>{await trigger.click();await managed(dialog);assertCentered(await ageGeometry(dialog),`${width}/${scheme}`);};
        // Open first, reproduce the missing margin only in this document, then remove the control.
        await trigger.click();await managed(dialog);
        const control=await page.addStyleTag({content:'dialog.daily-advice-age-dialog{position:fixed!important;inset:0!important;margin:0!important}'});
        try {
          await settled(page);item.before=await ageGeometry(dialog);
          item.beforeEvidence=await screen(`${tier}-calendar-visual317-age-${width}-${scheme}-before.png`);
          assert(item.before.centerDeltaY>1,'The margin:0 negative control must reproduce the misplaced dialog');
        } finally {await control.evaluate(el=>el.remove());}
        await settled(page);item.after=await ageGeometry(dialog);assertCentered(item.after,`${width}/${scheme}`);
        item.afterEvidence=await screen(`${tier}-calendar-visual317-age-${width}-${scheme}-after.png`);
        if(snapshot)await snapshot(`calendar-visual317-age-${width}-${scheme}`);
        const count=await dialog.getByRole('button').count();assert(count>=3,'The native dialog needs close, no and yes controls');
        for(const key of ['Tab','Shift+Tab'])for(let i=0;i<count+2;i++) {
          await page.keyboard.press(key);assert(await dialog.evaluate(el=>el.contains(document.activeElement)),`${key}: focus escaped the native modal`);
        }
        item.actions=[];
        const closeResult=async(action,answer)=>{
          const writes=[];const observe=request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname==='/api/account/preferences')writes.push(request.url());};
          page.on('request',observe);
          try {
            let response;
            if(typeof answer==='boolean') {
              const pending=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/account/preferences'&&res.request().method()==='PUT');
              await dialog.getByRole('button',{name:answer?labels.ageYes:labels.ageNo,exact:true}).click();response=await pending;assert(response.ok());
              assert.equal((await response.json()).user.advicePreferences.aphrodisiaAdult,answer);
            } else if(action==='Escape')await page.keyboard.press('Escape');
            else await dialog.locator('.dialog-universal-actions .dialog-close-button').click();
            await dialog.waitFor({state:'hidden'});await settled(page);
            const returned=await trigger.evaluate(el=>document.activeElement===el);
            item.actions.push({action,answer:answer??null,preferenceWrites:writes.length,focusReturned:returned});
            if(typeof answer!=='boolean')assert.equal(writes.length,0,`${action} must not save an age answer`);
          } finally {page.off('request',observe);}
        };
        await closeResult('no',false);await open();await closeResult('yes',true);
        await open();await closeResult('Escape');await open();await closeResult('close');
        assert(item.actions.every(action=>action.focusReturned),'Closing the confirmation must return focus to its real initiating button');
      });
    }
  } finally {
    try {
      const restored=await prefs({advicePreferences:initial.advice,uiVisibility:initial.visibility});
      assert.deepEqual(restored.advicePreferences,initial.advice,'Original advice preferences must be restored');
      assert.equal(restored.uiVisibility?.sacredFeaturesEnabled??true,initial.visibility.sacredFeaturesEnabled??true);
      if(originalCollapsed===true) {
        const section=await library();await section.locator('.habit-suggestions-toggle[aria-expanded="true"]').click();
        await page.waitForLoadState('networkidle');
      }
      await page.goto(initial.url);if(initial.viewport)await page.setViewportSize(initial.viewport);
      if(initial.theme)await theme(initial.theme.endsWith('-dark')?'dark':'light');
      report.cleanup.status='PASS';
    } catch(error){report.cleanup={status:'FAIL',error:error.message};}
    report.status=report.cleanup.status==='PASS'&&report.cases.length===16&&report.cases.every(item=>item.status==='PASS')?'PASS':'FAIL';
    report.finishedAt=new Date().toISOString();await save();
  }
  assert.equal(report.cleanup.status,'PASS','Synthetic preferences and viewport must be restored');
  return report;
}
