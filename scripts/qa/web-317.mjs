import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {verifyUi317} from './web-ui317.mjs';
// The accepted website is released independently of Android. An APK-only
// release must not require replacing the website's visible release label.
const expectedVersion = '3.2.9';

const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);

/** Real UI actions against the existing isolated QA account. No payment actions. */
export async function verifyRelease317({context,page,tier,output,check,snapshot}) {
  const baseURL=new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL),'Only an isolated loopback account is allowed');
  const originalMapUrl=page.url(),downloads=[];
  let visitNumber=0;
  const visit=async path=>{
    const url=new URL(path,baseURL);url.searchParams.set('qa317',String(++visitNumber));
    await page.goto(url.href);
    // These scenarios exercise a fully loaded document, not hit testing during initial layout.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).waitFor();
  };
  const seenDownload=download=>downloads.push(download.suggestedFilename());
  page.on('download',seenDownload);
  const upgrade=()=>page.getByRole('dialog',{name:/Больше возможностей GENESIS/});
  const closeUpgrade=async()=>{
    // The shared header replaces the original close control on the next animation frame.
    await upgrade().locator('[data-dialog-header-host]').waitFor();
    await upgrade().getByRole('button',{name:'Закрыть',exact:true}).click();await upgrade().waitFor({state:'hidden'});
  };
  const openAccount=async({navigate=true}={})=>{
    if(navigate)await visit('/#today');
    await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
    const account=page.locator('.account-panel');await account.waitFor();
    await account.locator('[data-settings-tab="account"]').click();return account;
  };
  const saveDownload=async(action,name)=>{
    const pending=page.waitForEvent('download');await action();const download=await pending;
    assert.equal(await download.failure(),null);const path=`${output}/${tier}-${name}`;
    await download.saveAs(path);return readFile(path,'utf8');
  };
  const openHabitData=async()=>{
    await visit('/#habits');
    await page.getByRole('tab',{name:'Прогресс Статистика и награды',exact:true}).click();
    const details=page.locator('.habit-data-export');await details.locator('summary').click();return details;
  };
  let habitBackup=null,mapBackup=null;
  try {
    await check('release317-comparison',async()=>{
      const account=await openAccount();
      assert.equal((await account.locator('.account-release-version').innerText()).trim(),expectedVersion);
      await account.locator('.account-plan-upgrade button').click();await upgrade().waitFor();
      const features=await upgrade().locator('[data-feature]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-feature')));
      assert(!features.includes('future-modeling'));assert(!features.includes('theokyklos'));
      assert.equal(features[features.indexOf('stoicheion-letters')+1],'data-export');
      assert(features.includes('stoicheion-spread')&&features.includes('physis'),'Unrelated features were removed');
      await upgrade().locator('.upgrade-plan-premium input').check();
      assert.equal((await upgrade().locator('.upgrade-quota-grid > div').filter({hasText:'Личные майндмепы'}).locator('dd').innerText()).trim(),'100');
      await upgrade().locator('.upgrade-plan-free input').check();
      assert.equal(await upgrade().locator('[data-feature="data-export"]').getAttribute('data-included'),'false');
      await upgrade().locator('.upgrade-plan-business input').check();
      await upgrade().getByText(/100 проектов первого уровня на все пространства владельца/).waitFor();
      for(const width of [360,390,768,1440])for(const scheme of ['light','dark']){
        await closeUpgrade();await account.getByRole('button',{name:'Закрыть',exact:true}).click();
        await page.setViewportSize({width,height:1000});
        const desired=scheme==='dark'?'standart-dark':'standart';
        if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)
          await page.getByRole('button',{name:scheme==='dark'?'Включить тёмную тему':'Включить светлую тему',exact:true}).click();
        await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
        await account.locator('.account-plan-upgrade button').click();
        await upgrade().locator('.upgrade-plan-premium input').check();
        const bounds=await upgrade().boundingBox();assert(bounds&&bounds.width<=width&&bounds.x>=0);
        await page.screenshot({path:`${output}/${tier}-release317-comparison-${width}-${scheme}.png`,fullPage:true,animations:'disabled'});
      }
      await writeFile(`${output}/${tier}-release317-comparison.json`,JSON.stringify({features,premiumMindmaps:100,widths:[360,390,768,1440],schemes:['light','dark']},null,2));
      await snapshot('release317-comparison');await closeUpgrade();
    });

    await verifyUi317({context,page,tier,output,check,snapshot,originalMapUrl,visit,openAccount,upgrade,closeUpgrade});

    await check('release317-calendar-export',async()=>{
      await visit('/#today');const title=`QA 3.1.7 ICS ${tier}`;
      await page.getByRole('button',{name:'Создать задачу',exact:true}).first().click();
      const create=page.getByRole('dialog',{name:'Создать · Личное дело',exact:true});
      await create.getByRole('textbox',{name:'Новая задача',exact:true}).fill(title);
      await create.getByRole('button',{name:'Добавить задачу',exact:true}).click();await create.waitFor({state:'hidden'});
      const account=await openAccount(),count=downloads.length;
      const action=()=>account.getByRole('button',{name:'Экспортировать календарь .ics',exact:true}).click();
      if(tier==='free'){
        await action();await upgrade().waitFor();assert.equal(downloads.length,count,'Free ICS export downloaded a file');
        await snapshot('release317-calendar-export');await closeUpgrade();
      }else{
        const file=await saveDownload(action,'release317-calendar.ics');assert.match(file,/BEGIN:VCALENDAR/);assert(file.includes(`SUMMARY:${title}`));
        await snapshot('release317-calendar-export');
      }
    });

    await check('release317-habit-export',async()=>{
      const details=await openHabitData(),count=downloads.length;
      const action=()=>details.getByRole('button',{name:'Резервная копия JSON',exact:true}).click();
      if(tier==='free'){
        await action();await upgrade().waitFor();assert.equal(downloads.length,count,'Free habit export downloaded a file');
        await snapshot('release317-habit-export');await closeUpgrade();
      }else{
        habitBackup=JSON.parse(await saveDownload(action,'release317-habits.json'));
        assert.equal(habitBackup.format,'genesis.habits.backup');assert(habitBackup.data.habits.length>0);
        await snapshot('release317-habit-export');
      }
    });

    await check('release317-habit-import',async()=>{
      const details=await openHabitData();
      const input=details.locator('input[type="file"]');await input.waitFor({state:'attached'});
      const writes=[],observe=request=>{if(new URL(request.url()).pathname==='/api/workspace'&&request.method()==='PUT')writes.push(request.url());};
      await page.waitForLoadState('networkidle');page.on('request',observe);
      try{
        if(tier==='free'){
          // The handler must reject before parsing, preview persistence or workspace writes.
          await input.setInputFiles({name:'blocked-import.json',mimeType:'application/json',buffer:Buffer.from('{"format":"must-not-be-parsed"}')});
          await upgrade().waitFor();assert.equal(await details.locator('.habit-restore-preview').count(),0);assert.equal(writes.length,0);
          await snapshot('release317-habit-import');await closeUpgrade();
        }else{
          assert(habitBackup,'Paid export prerequisite is missing');
          const oldId=habitBackup.data.habits[0].id,newId=randomUUID(),title=`QA 3.1.7 imported habit ${tier}`;
          const replace=value=>Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)])):value===oldId?newId:value;
          const data=replace(habitBackup.data);data.habits.find(habit=>habit.id===newId).title=title;
          const backup={...habitBackup,data,checksum:createHash('sha256').update(canonical(data)).digest('hex')};
          await input.setInputFiles({name:'qa-habit-import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
          await details.locator('.habit-restore-preview').getByText(title,{exact:true}).waitFor();
          await details.getByRole('button',{name:'Применить восстановление',exact:true}).click();
          await details.getByText('Восстановление завершено.',{exact:true}).waitFor();assert(writes.length>0,'Paid import did not persist the workspace');
          await snapshot('release317-habit-import');
        }
      }finally{page.off('request',observe);}
    });

    await check('release317-mindmap-export',async()=>{
      assert(new URL(originalMapUrl).searchParams.has('mindmap'),'The existing map prerequisite is missing');
      await visit(originalMapUrl);await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
      await page.getByRole('button',{name:'Настройка карты',exact:true}).click();const count=downloads.length;
      await page.getByRole('button',{name:'Экспорт',exact:true}).click();
      if(tier==='free'){
        await upgrade().waitFor();assert.equal(downloads.length,count);assert.equal(await page.getByRole('dialog',{name:'Экспорт карты',exact:true}).count(),0);
        await snapshot('release317-mindmap-export');await closeUpgrade();
      }else{
        const dialog=page.getByRole('dialog',{name:'Экспорт карты',exact:true});
        mapBackup=JSON.parse(await saveDownload(()=>dialog.getByRole('button',{name:'JSON',exact:true}).click(),'release317-map.json'));
        assert.equal(mapBackup.format,'genesis-mindmap');await snapshot('release317-mindmap-export');
      }
    });

    await check('release317-mindmap-import',async()=>{
      await visit(originalMapUrl);await page.getByRole('button',{name:'Все майндмепы',exact:true}).click();
      const writes=[],observe=request=>{if(/\/api\/mindmaps\//.test(request.url())&&request.method()==='PUT')writes.push(request.url());};
      page.on('request',observe);
      try{
        await page.getByRole('button',{name:'Импорт JSON',exact:true}).click();
        if(tier==='free'){
          await upgrade().waitFor();assert.equal(await page.getByRole('dialog',{name:'Импорт карты GENESIS',exact:true}).count(),0);assert.equal(writes.length,0);
          await snapshot('release317-mindmap-import');await closeUpgrade();
        }else{
          assert(mapBackup,'Paid map export prerequisite is missing');const title=`QA 3.1.7 imported map ${tier}`;
          const imported=structuredClone(mapBackup);imported.document.title=title;
          const root=imported.document.nodes.find(node=>node.parentId===null);if(root?.kind==='idea')root.text=title;
          const dialog=page.getByRole('dialog',{name:'Импорт карты GENESIS',exact:true});
          await dialog.getByLabel('Выберите JSON карты',{exact:true}).setInputFiles({name:'qa-map-import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
          await dialog.getByRole('button',{name:'Импортировать отдельную карту',exact:true}).click();
          await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
          const importedUrl=page.url();assert.notEqual(new URL(importedUrl).searchParams.get('mindmap'),new URL(originalMapUrl).searchParams.get('mindmap'));
          assert(writes.length>0,'Paid map import did not persist the encrypted document');
          await page.reload();await page.locator('.mindmap-map-title').filter({hasText:title}).waitFor();
          await snapshot('release317-mindmap-import');
        }
      }finally{page.off('request',observe);}
    });

    if(['business','premium4life'].includes(tier))await check('release317-owner-quota',async()=>{
      const session=await (await context.request.get('/api/session')).json();assert(session.user.email.endsWith('@example.invalid'));
      const headers={Origin:baseURL,'X-CSRF-Token':session.csrf};
      const created=await context.request.post('/api/shared/spaces',{headers,data:{title:`QA 3.1.7 owner quota ${tier}`}});assert(created.ok());
      const space=(await created.json()).space;
      const directory=await (await context.request.get('/api/shared/spaces')).json();
      assert.equal(directory.ownedProjectQuota.ownerId,session.user.uid);assert.equal(space.projectQuota.ownerId,session.user.uid);
      assert.equal(directory.ownedProjectQuota.limit,100);assert.equal(space.projectQuota.limit,100);
      await visit('/#projects');await page.getByRole('button',{name:'Общие',exact:true}).click();
      await page.locator('[data-project-quota]').waitFor();
      await page.locator('.shared-space-picker,.shared-space-open').first().waitFor();
      const picker=page.getByRole('combobox',{name:'Текущее пространство',exact:true});
      if(await picker.count())await picker.selectOption(space.id);
      else await page.locator('.shared-space-open').filter({hasText:space.title}).click();
      const note=page.locator('[data-project-quota]');await note.waitFor();assert.match(await note.innerText(),/Проекты, созданные участниками, используют лимит владельца/);
      assert((await note.innerText()).includes(`${space.projectQuota.count} / 100`));await snapshot('release317-owner-quota');
      await writeFile(`${output}/${tier}-release317-owner-quota.json`,JSON.stringify({ownedProjectQuota:directory.ownedProjectQuota,spaceProjectQuota:space.projectQuota},null,2));
    });
  }finally{page.off('download',seenDownload);}
}
