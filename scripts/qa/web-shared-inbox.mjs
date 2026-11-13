import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {sanitizeTraceFile} from './trace-sanitize.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const localOrigin=value=>assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(value),'An isolated loopback QA runtime is required');

// The observer is attached immediately, so an earlier geometry/action failure cannot
// leave a rejecting event waiter unhandled. Awaiting the original promise still fails.
function expectedResponse(page,predicate,options) {
  const response=page.waitForResponse(predicate,options);void response.catch(()=>{});return response;
}

let dragSequence=0;
async function mouseDrag(page,source,target,{after=false,cancel=false}={}) {
  await page.evaluate(()=>document.fonts.ready);
  // Keep the gesture away from viewport-edge autoscroll. Otherwise the row
  // under a self-drop can change between the hit check and pointer release.
  await source.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  let from,to,previous,stable=0;
  for(let attempt=0;attempt<30;attempt++) {
    [from,to]=await Promise.all([source.boundingBox(),target.boundingBox()]);
    assert(from&&to,'Both drag endpoints must be rendered');
    const geometry=[from.x,from.y,from.width,from.height,to.x,to.y,to.width,to.height];
    stable=previous&&geometry.every((value,index)=>Math.abs(value-previous[index])<.5)?stable+1:0;
    if(stable>=2)break;
    previous=geometry;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  assert(stable>=2,'Drag endpoints did not settle before the gesture');
  const start={x:from.x+Math.min(from.width/2,60),y:from.y+Math.min(from.height/2,22)};
  const visibleDropPoint=()=>target.evaluate((element,after)=>{
    const rect=element.getBoundingClientRect();
    const xs=[Math.min(rect.width/2,70),rect.width/2,rect.width*.25,rect.width*.75];
    const visibleTop=Math.max(0,-rect.y),visibleBottom=Math.min(rect.height,innerHeight-rect.y);
    const ys=after?[rect.height-6,rect.height*.75,rect.height*.6]:[Math.min(rect.height/4,20),rect.height*.4,rect.height*.25,
      visibleTop+(visibleBottom-visibleTop)*.25,visibleTop+(visibleBottom-visibleTop)*.4];
    for(const dy of ys)for(const dx of xs){
      const x=rect.x+dx,y=rect.y+dy;
      if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
      const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===element||element.contains(hit)))return{x,y};
    }
    return null;
  },after);
  let end=await visibleDropPoint();
  assert(end,'Drag destination must expose an unobstructed point');
  assert(start.y>=0&&end.y>=0&&Math.max(start.y,end.y)<page.viewportSize().height,'Functional fixture must keep both drag endpoints visible');
  const hitsTarget=()=>target.evaluate((element,point)=>{const hit=document.elementFromPoint(point.x,point.y);return Boolean(hit&&(hit===element||element.contains(hit)));},end);
  const evidence={from,to,start,end,beforeHit:await hitsTarget(),steps:[]};
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  try {
    await page.mouse.move(start.x+10,start.y+4,{steps:3});
    await page.mouse.move(end.x,end.y,{steps:18});
    // Layout can finish loading or scroll during the gesture. Follow the actual
    // intended DOM target instead of releasing over a different view switch.
    for(let attempt=0;!await hitsTarget()&&attempt<3;attempt++) {
      to=await target.boundingBox();assert(to,'Drag destination disappeared');
      const point=await visibleDropPoint();assert(point,'Drag destination became obstructed');end=point;
      assert(end.y>=0&&end.y<page.viewportSize().height,'Drag destination left the visible fixture');
      evidence.steps.push({to,end});await page.mouse.move(end.x,end.y,{steps:8});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    evidence.beforeReleaseHit=await hitsTarget();
    assert(evidence.beforeReleaseHit,'Gesture must end over the requested DOM destination');
    evidence.outcome=cancel?'cancelled':'released';
    if(cancel)await page.keyboard.press('Escape');
  } catch(error) {
    evidence.error=error.message;evidence.outcome='failed';
    throw error;
  } finally {
    await page.mouse.up();
    const directory=process.env.GENESIS_QA_WEB_OUTPUT;
    if(directory)writeFileSync(path.join(directory,'inbox-drag-geometry-'+(++dragSequence)+'.json'),JSON.stringify(evidence,null,2));
  }
}

async function waitForValue(read,predicate,message) {
  let value;
  for(let attempt=0;attempt<40;attempt++) {
    value=await read();if(predicate(value))return value;
    await pause(150);
  }
  assert.fail(`${message}; last observed: ${JSON.stringify(value)}`);
}

// Only joins an existing ordinary synthetic account to this newly created test space.
// The public invitation endpoint intentionally requires Gmail; no invitation is sent.
function seedViewer({runtime,php,spaceId,tier}) {
  assert(runtime&&php,'Owned runtime and PHP executable are required for real ACL checks');
  const code=String.raw`
  $dir=str_replace('\\','/',getenv('GENESIS_QA_INBOX_RUNTIME'));
  $owner=json_decode((string)file_get_contents($dir.'/owner.json'),true,16,JSON_THROW_ON_ERROR);
  if(($owner['synthetic']??false)!==true||$owner['directory']!==$dir||!hash_equals($owner['configSha256'],(string)hash_file('sha256',$dir.'/config.php')))throw new RuntimeException('Owned fixture required');
  define('GENESIS_LOCAL_TEST_CONFIG',$dir.'/config.php');
  foreach(['bootstrap','repository','google','shared-projects'] as $module)require_once getcwd().'/server/src/'.$module.'.php';
  if(genesisConfig()['db_path']!==$dir.'/genesis.sqlite')throw new RuntimeException('Fixture database mismatch');
  $users=json_decode((string)file_get_contents($dir.'/users.json'),true,16,JSON_THROW_ON_ERROR)['users'];
  $actor=$users[getenv('GENESIS_QA_INBOX_TIER')]['id'];$viewer=$users['outsider']['id'];$space=getenv('GENESIS_QA_INBOX_SPACE');
  foreach([$actor,$viewer] as $id){$user=genesisFindUser($id);if(!$user||!str_ends_with($user['email'],'@example.invalid')||genesisIsAdminUser($user)||genesisSharedTester($user))throw new RuntimeException('Ordinary synthetic actor required');}
  if(genesisSharedSpaceAccess($space,$actor)['created_by']!==$actor)throw new RuntimeException('Fixture owner mismatch');
  $db=genesisDb();$now=genesisNow();genesisBeginWriteTransaction($db);
  try{
    $db->prepare("UPDATE users SET subscription_plan='business',subscription_valid_until='2035-01-01T00:00:00Z',updated_at=? WHERE id=?")->execute([$now,$viewer]);
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'guest',1,?)")->execute([$space,$viewer,$now]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) SELECT id,?,'viewer',? FROM shared_projects WHERE space_id=?")->execute([$viewer,$now,$space]);
    $db->commit();
  }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
  echo json_encode(['synthetic'=>true,'viewerId'=>$viewer],JSON_THROW_ON_ERROR);session_write_close();`;
  const result=spawnSync(php,['-d','disable_functions=curl_exec,mail','-r',code],{cwd:root,windowsHide:true,encoding:'utf8',timeout:20000,
    env:{...process.env,GENESIS_QA_INBOX_RUNTIME:runtime.replaceAll('\\','/'),GENESIS_QA_INBOX_TIER:tier,GENESIS_QA_INBOX_SPACE:spaceId}});
  assert.equal(result.status,0,`Local viewer fixture failed: ${result.stderr}`);
  const fixture=JSON.parse(result.stdout);assert.equal(fixture.synthetic,true);return fixture.viewerId;
}

/** Real gestures and saved API state; caller supplies only an owned local QA session. */
export async function verifySharedInbox({context,page,tier,output,check,runtime,php,phase='after'}) {
  assert(['business','premium4life'].includes(tier));
  assert(['before','after'].includes(phase));const baselineOnly=phase==='before';
  const baseURL=new URL(page.url()).origin;localOrigin(baseURL);
  const session=await (await context.request.get(`${baseURL}/api/session`)).json();
  assert.equal(session.user.isAdmin,false);assert.equal(session.user.subscriptionPlan,tier);
  assert(session.user.email.endsWith('@example.invalid'));
  const headers={Origin:baseURL,'X-CSRF-Token':session.csrf};
  const api=async(route,method='GET',data)=>{
    const response=await context.request.fetch(`${baseURL}/api/${route}`,{method,headers,...(data===undefined?{}:{data})});
    assert(response.ok(),`Fixture ${method} ${route}: HTTP ${response.status()}`);return response.json();
  };
  const stamp=randomUUID().slice(0,8);
  const space=(await api('shared/spaces','POST',{title:`QA inbox ${tier} ${stamp}`})).space;
  const project=(await api(`shared/spaces/${space.id}/projects`,'POST',{title:`QA project ${stamp}`,layout:'board'})).project;
  const projectRoute=`shared/projects/${project.id}`;
  const initial=await api(projectRoute);const board=initial.statuses.find(item=>!item.isDone);
  assert(board,'A real open board is required');
  const child=(await api(`shared/spaces/${space.id}/projects`,'POST',{title:`QA child ${stamp}`,parentId:project.id,boardStatusId:board.id,description:'Preserved subproject description',tags:['сохранить']})).project;
  const list=(await api(`shared/spaces/${space.id}/projects`,'POST',{title:`QA list ${stamp}`,kind:'task-list',parentId:project.id})).project;
  const tasks=[];
  for(let i=0;i<3;i++) {
    let task=(await api(`${projectRoute}/tasks`,'POST',{title:`QA inbox task ${i} ${stamp}`,description:`Task body ${i} 🌙`,tags:['проверка'],statusId:board.id,requestId:randomUUID()})).task;
    if(i)task={...task,...(await api(`${projectRoute}/tasks/${task.id}/move`,'POST',{destinationProjectId:project.id,statusId:'',position:i-1,expectedRevision:task.revision,requestId:randomUUID()})).task};
    tasks.push(task);
  }
  const taskId=tasks[0].id;
  const url=new URL('/',baseURL);url.searchParams.set('affairs','shared');url.searchParams.set('space',space.id);url.searchParams.set('project',project.id);url.searchParams.set('projectView','board');url.hash='projects';
  const visit=async(target=page)=>{await target.goto(url.href);await target.locator('.shared-project-chaos').waitFor({state:'attached'});};
  const prefs=async()=> (await api('session')).user.uiVisibility;
  const task=async(id=taskId)=>(await api(`${projectRoute}/tasks/${id}`)).task;
  const projects=async()=>(await api(`shared/spaces/${space.id}/projects`)).projects;
  const inbox=()=>page.locator('.shared-project-chaos');
  const boardElement=()=>page.locator(`.shared-project-board-content [data-shared-drop-status="${board.id}"]`);
  const taskElement=id=>page.locator(`[data-shared-task-id="${id}"]`);
  const savePreference=async(action,key,value)=>{
    const saved=expectedResponse(page,response=>new URL(response.url()).pathname==='/api/account/preferences'&&response.request().method()==='PUT'&&response.ok()
      &&response.request().postDataJSON()?.uiLayout?.[key]===value);
    void saved.catch(()=>{});
    await action();await saved;await waitForValue(async()=>(await prefs())[key],actual=>actual===value,`${key}: expected ${JSON.stringify(value)}`);
  };
  const choosePosition=async position=>savePreference(()=>inbox().getByRole('combobox',{name:'Расположение хаос-бокса',exact:true}).selectOption(position),'sharedInboxPosition',position);
  const reload=async()=>{await page.reload();await inbox().waitFor({state:'attached'});};
  const savedLayout=Object.fromEntries(['sharedInboxPosition','sharedInboxHidden','sharedInboxWidth','sharedInboxCompact'].map(key=>[key,session.user.uiVisibility?.[key]??({sharedInboxPosition:'right',sharedInboxHidden:false,sharedInboxWidth:300,sharedInboxCompact:false}[key]) ]));
  let viewerContext;
  try {
    await page.setViewportSize({width:1440,height:1600});await visit();
    if(!baselineOnly) {
    await check('inbox-existing-layout',async()=>{
      assert.equal(await page.locator('.shared-project-board-workspace').getAttribute('data-inbox-position'),savedLayout.sharedInboxPosition);
      assert.equal(await page.locator('.shared-project-board-workspace').getAttribute('data-inbox-hidden'),String(savedLayout.sharedInboxHidden));
      assert.equal(await inbox().getByRole('button',{name:'Создать задачу',exact:true}).count(),0);
      if(savedLayout.sharedInboxHidden)await savePreference(()=>page.getByRole('button',{name:'Показать хаос-бокс',exact:true}).click(),'sharedInboxHidden',false);
      await choosePosition('right');await reload();
      assert.equal(await page.locator('.shared-project-board-workspace').getAttribute('data-inbox-position'),'right');
    });
    await check('inbox-task-self-drop',async()=>{
      const id=tasks[1].id,original=await task(id),writes=[];
      const order=async()=>inbox().locator('[data-shared-task-id]').evaluateAll(rows=>rows.map(row=>row.dataset.sharedTaskId));
      const originalOrder=await order();assert(originalOrder.length>=2,'Self-drop requires a following task');
      const route=`/api/${projectRoute}/tasks/${id}/move`;
      const observe=request=>{if(new URL(request.url()).pathname===route&&request.method()==='POST')writes.push(request.url());};
      page.on('request',observe);
      try {
        await mouseDrag(page,taskElement(id).locator('[data-affair-drag-surface]'),taskElement(id));
        await pause(300);
        assert.equal(writes.length,0,'Dropping onto the same task must not send a move');
        const current=await task(id);assert.equal(current.position,original.position);assert.equal(current.revision,original.revision);
        await reload();assert.deepEqual(await order(),originalOrder);
        assert.equal(await page.locator('dialog[open]').count(),0,'Self-drop must suppress the click');
      } finally {page.off('request',observe);}
    });
    await check('inbox-task-drag-and-rank',async()=>{
      const original=await task();
      const moved=expectedResponse(page,response=>new URL(response.url()).pathname===`/api/${projectRoute}/tasks/${taskId}/move`&&response.request().method()==='POST');
      await mouseDrag(page,taskElement(taskId).locator('[data-affair-drag-surface]'),taskElement(tasks[2].id));
      assert((await moved).ok());
      const saved=await waitForValue(task,row=>row.statusId===`chaos-open:${project.id}`,'Task did not enter inbox');
      assert.equal(saved.position,1,'Task must be inserted before the second inbox task');
      for(const key of ['title','description','tags','dueDate'])assert.deepEqual(saved[key],original[key]);
      await reload();assert.equal(await inbox().locator(`[data-shared-task-id="${taskId}"]`).count(),1);
      const returned=expectedResponse(page,response=>new URL(response.url()).pathname===`/api/${projectRoute}/tasks/${taskId}/move`&&response.request().method()==='POST');
      await mouseDrag(page,taskElement(taskId).locator('[data-affair-drag-surface]'),boardElement());assert((await returned).ok());
      await waitForValue(task,row=>row.statusId===board.id,'Task did not return to its board');
      await reload();assert.equal(await boardElement().locator(`[data-shared-task-id="${taskId}"]`).count(),1);
      assert.equal(new URL(page.url()).searchParams.get('project'),project.id);
      assert.equal(await page.locator('dialog[open]').count(),0,'Dragging must not open a task dialog');
    });
    await check('inbox-subproject-and-list-drag',async()=>{
      for(const entity of [child,list]) {
        let current=(await projects()).find(row=>row.id===entity.id);
        const firstStatus=current.boardStatusId?'':board.id;
        for(const statusId of [firstStatus,firstStatus?'':board.id]) {
          const source=page.locator(`[data-shared-container-id="${entity.id}"] [data-affair-drag-surface]`);
          const changed=expectedResponse(page,response=>new URL(response.url()).pathname===`/api/shared/projects/${entity.id}`&&response.request().method()==='PATCH');
          await mouseDrag(page,source,statusId?boardElement():inbox().locator('.shared-project-chaos-items'));assert((await changed).ok());
          current=await waitForValue(async()=>(await projects()).find(row=>row.id===entity.id),row=>row.boardStatusId===(statusId||null),'Child placement was not saved');
          assert.equal(current.parentId,project.id);assert.equal(current.title,entity.title);assert.equal(current.kind,entity.kind);
          if(entity.id===child.id)assert.equal(current.description,'Preserved subproject description');
          await reload();assert.equal(await (statusId?boardElement():inbox()).locator(`[data-shared-container-id="${entity.id}"]`).count(),1);
        }
      }
    });
    await check('inbox-conflict-rollback',async()=>{
      const original=await task(),route=`${baseURL}/api/${projectRoute}/tasks/${taskId}/move`;
      const reject=async request=>request.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'SHARED_TASK_CONFLICT'})});
      await page.route(route,reject,{times:1});
      try {
        const rejected=expectedResponse(page,response=>response.url()===route&&response.request().method()==='POST');
        await mouseDrag(page,taskElement(taskId).locator('[data-affair-drag-surface]'),inbox().locator('.shared-project-chaos-items'));
        assert.equal((await rejected).status(),409);
        await boardElement().locator(`[data-shared-task-id="${taskId}"]`).waitFor();
        assert.equal((await task()).revision,original.revision);assert.equal((await task()).statusId,board.id);
        await reload();assert.equal(await boardElement().locator(`[data-shared-task-id="${taskId}"]`).count(),1);
      } finally {await page.unroute(route,reject);}
    });
    await check('inbox-docking-persistence',async()=>{
      for(const position of ['left','top','bottom','right']) {
        await choosePosition(position);await reload();
        assert.equal(await page.locator('.shared-project-board-workspace').getAttribute('data-inbox-position'),position);
      }
      const geometry=[];
      try {for(const position of ['left','top','bottom','right']) {
        const handle=inbox().getByRole('button',{name:'Переместить хаос-бокс',exact:true});
        await handle.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
        const from=await handle.boundingBox();assert(from);
        const step={position,from,viewport:page.viewportSize()};geometry.push(step);
        await savePreference(async()=>{
          await page.mouse.move(from.x+20,from.y+20);await page.mouse.down();
          try {
            await page.mouse.move(from.x+30,from.y+20,{steps:3});
            const rect=await page.locator('.shared-project-board-workspace').boundingBox();assert(rect);step.rect=rect;
            const top=Math.max(0,rect.y),bottom=Math.min(page.viewportSize().height,rect.y+rect.height);
            assert(bottom-top>200,'Docking fixture must expose more than an edge strip');
            const point={x:position==='left'?rect.x+rect.width*.125:position==='right'?rect.x+rect.width*.875:rect.x+rect.width/2,
              y:position==='top'?top+(bottom-top)*.125:position==='bottom'?bottom-(bottom-top)*.125:(top+bottom)/2};
            step.point=point;
            await page.mouse.move(point.x,point.y,{steps:24});
            step.preview=await page.locator('.inbox-dock-preview').innerText();
            assert(step.preview.endsWith({left:'Слева',top:'Сверху',bottom:'Снизу',right:'Справа'}[position]),
              `Dock preview mismatch: ${JSON.stringify(step)}`);
          } finally {await page.mouse.up();}
        },'sharedInboxPosition',position);
        await reload();step.saved=await page.locator('.shared-project-board-workspace').getAttribute('data-inbox-position');
        assert.equal(step.saved,position);
      }} finally {writeFileSync(path.join(output,`${tier}-inbox-docking-geometry.json`),JSON.stringify(geometry,null,2));}
      const before=await prefs(),writes=[];const observe=request=>{if(request.method()==='PUT'&&request.url().endsWith('/api/account/preferences'))writes.push(request.url());};
      page.on('request',observe);
      try {await mouseDrag(page,inbox().getByRole('button',{name:'Переместить хаос-бокс',exact:true}),boardElement(),{cancel:true});await pause(200);}
      finally {page.off('request',observe);}
      assert.equal(writes.length,0);assert.equal((await prefs()).sharedInboxPosition,before.sharedInboxPosition);
      assert.equal(await page.locator('html').getAttribute('data-inbox-dragging'),null);
    });
    await check('inbox-hide-compact-resize',async()=>{
      await savePreference(()=>inbox().getByRole('button',{name:'Скрыть хаос-бокс',exact:true}).click(),'sharedInboxHidden',true);await reload();
      assert.equal(await inbox().isVisible(),false);
      await savePreference(()=>page.getByRole('button',{name:'Показать хаос-бокс',exact:true}).click(),'sharedInboxHidden',false);await reload();
      assert(await inbox().isVisible());
      await savePreference(()=>inbox().getByRole('button',{name:'Кратко',exact:true}).click(),'sharedInboxCompact',true);await reload();
      assert.equal(await inbox().getAttribute('data-inbox-compact'),'true');
      await savePreference(()=>inbox().getByRole('button',{name:'Подробно',exact:true}).click(),'sharedInboxCompact',false);
      await choosePosition('right');await reload();
      const separator=page.locator('.shared-project-board-workspace > .inbox-resize-boundary');
      assert(await separator.isVisible(),'Resize requires a visible side splitter');
      await savePreference(()=>separator.press('Home'),'sharedInboxWidth',300);
      await savePreference(()=>separator.press('ArrowLeft'),'sharedInboxWidth',316);await reload();
      assert(Math.abs((await inbox().boundingBox()).width-316)<=2);
    });
    await check('inbox-existing-trash-undo',async()=>{
      await taskElement(taskId).getByRole('button',{name:`Удалить задачу «${tasks[0].title}»`,exact:true}).click();
      await page.getByRole('dialog',{name:'Переместить в корзину',exact:true}).getByRole('button',{name:'В корзину',exact:true}).click();
      await taskElement(taskId).waitFor({state:'detached'});
      await page.getByRole('button',{name:'Отменить действие',exact:true}).click();
      await taskElement(taskId).waitFor();assert.equal((await task()).title,tasks[0].title);await reload();await taskElement(taskId).waitFor();
    });
    }
    await check('shared-panels-responsive-spacing',async()=>{
      const panelSelectors=['.shared-project-categories','.shared-space-collaboration','.shared-projects-google','.shared-activity'];
      const visual=[];
      for(const width of [360,390,768,1440])for(const scheme of ['light','dark']) {
        await page.setViewportSize({width,height:1000});
        const desired=scheme==='dark'?'standart-dark':'standart';
        if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)
          await page.getByRole('button',{name:scheme==='dark'?'Включить тёмную тему':'Включить светлую тему',exact:true}).click();
        for(const state of ['collapsed','expanded','mixed']) {
          for(const [index,selector] of panelSelectors.entries()) {
            const panel=page.locator(`.shared-projects-main > ${selector}`);await panel.waitFor();
            const details=selector==='.shared-space-collaboration'?panel.locator('.shared-space-participants'):panel;
            const wanted=state==='expanded'||state==='mixed'&&index%2===0;
            if(await details.evaluate(el=>el.open)!==wanted)await details.locator(':scope > summary').click();
          }
          const geometry=await page.evaluate(selectors=>{
            const panels=selectors.map(selector=>document.querySelector(`.shared-projects-main > ${selector}`).getBoundingClientRect());
            return {gaps:panels.slice(1).map((rect,index)=>rect.top-panels[index].bottom),overflow:document.documentElement.scrollWidth-innerWidth};
          },panelSelectors);
          if(!baselineOnly)assert(geometry.gaps.every(gap=>Math.abs(gap-16)<=1),`${width}/${scheme}/${state}: ${geometry.gaps}`);
          if(!baselineOnly)assert(geometry.overflow<=1,`${width}/${scheme}: horizontal page overflow ${geometry.overflow}`);
          const controls=await inbox().locator('.inbox-hide-button,.inbox-display-switch button,.inbox-position-choice select').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>({label:el.getAttribute('aria-label')||el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
          if(!baselineOnly)assert(controls.length>=4&&controls.every(control=>control.width>=44&&control.height>=44),`Touch targets: ${JSON.stringify(controls)}`);
          const file=`${tier}-${phase}-shared-panels-${width}-${scheme}-${state}.png`;
          await page.screenshot({path:path.join(output,file),fullPage:true,animations:'disabled'});
          visual.push({width,scheme,state,...geometry,evidence:file});
        }
      }
      writeFileSync(path.join(output,`${tier}-shared-panels-geometry.json`),JSON.stringify(visual,null,2));
    });
    if(!baselineOnly)await check('inbox-real-acl',async()=>{
      const viewerId=seedViewer({runtime,php,spaceId:space.id,tier});
      viewerContext=await context.browser().newContext({baseURL,viewport:{width:1440,height:1600},locale:'ru-RU'});
      await viewerContext.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
      await viewerContext.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
      assert((await viewerContext.request.get('/api/qa/login?tier=outsider')).ok());
      const viewerPage=await viewerContext.newPage(),viewerErrors=[];viewerPage.on('pageerror',error=>viewerErrors.push(error.message));await visit(viewerPage);
      const viewerSession=await (await viewerContext.request.get('/api/session')).json();
      assert.equal(viewerSession.user.isAdmin,false);assert.equal(viewerSession.user.subscriptionPlan,'business');
      assert(viewerSession.user.featureAccess.allowedFeatures.includes('shared-projects'),'ACL actor must pass the subscription gate');
      const viewerHeaders={Origin:baseURL,'X-CSRF-Token':viewerSession.csrf};
      const permissions={createProjects:false,editTasks:false,organizeTasks:false,comment:false,manageProjects:false,inviteMembers:false};
      for(const kind of ['viewer','editor-without-organize']) {
        if(kind!=='viewer') {
          await api(`shared/spaces/${space.id}/members/${viewerId}`,'PATCH',{role:'member',permissions:{...permissions,editTasks:true},canOrganizeTasks:false});
          await viewerPage.reload();await viewerPage.locator('.shared-project-chaos').waitFor();
        }
        const current=(await (await viewerContext.request.get(`/api/${projectRoute}`)).json()).project;
        assert.equal(Boolean(current.canOrganizeTasks),false);assert.equal(current.permissions.manageProjects,false);
        const writes=[];const observe=request=>{if(/\/api\/shared\/projects\//.test(request.url())&&['POST','PATCH','DELETE'].includes(request.method()))writes.push(request.url());};
        viewerPage.on('request',observe);
        try {await mouseDrag(viewerPage,viewerPage.locator(`[data-shared-task-id="${taskId}"] [data-affair-drag-surface]`),viewerPage.locator('.shared-project-chaos-items'));await pause(200);}
        finally {viewerPage.off('request',observe);}
        assert.equal(writes.length,0,`${kind} must not issue a drag mutation`);
        const latest=await task();
        const denied=await viewerContext.request.post(`/api/${projectRoute}/tasks/${taskId}/move`,{headers:viewerHeaders,data:{destinationProjectId:project.id,statusId:'',position:0,expectedRevision:latest.revision,requestId:randomUUID()}});
        assert.equal(denied.status(),403);assert.equal((await denied.json()).error,'SHARED_PROJECT_FORBIDDEN');
        assert.equal((await task()).revision,latest.revision);
      }
      await api(`shared/spaces/${space.id}/members/${viewerId}`,'PATCH',{role:'member',permissions:{...permissions,editTasks:true,organizeTasks:true,manageProjects:true},canOrganizeTasks:true});
      await viewerPage.reload();await viewerPage.locator('.shared-project-chaos').waitFor();
      const custom=(await (await viewerContext.request.get(`/api/${projectRoute}`)).json()).project;
      assert.equal(custom.permissions.manageProjects,true);
      const changed=viewerPage.waitForResponse(response=>new URL(response.url()).pathname===`/api/shared/projects/${child.id}`&&response.request().method()==='PATCH');
      await mouseDrag(viewerPage,viewerPage.locator(`[data-shared-container-id="${child.id}"] [data-affair-drag-surface]`),viewerPage.locator('.shared-project-chaos-items'));
      const changedResponse=await changed,changedBody=await changedResponse.json();
      assert(changedResponse.ok(),`Explicit manage permission must work without the manager role: HTTP ${changedResponse.status()}, ${changedBody.error??'no error code'}`);
      const saved=(await projects()).find(row=>row.id===child.id);assert.equal(saved.parentId,project.id);assert.equal(saved.boardStatusId,null);
      try {
        await viewerPage.reload();
        const restored=viewerPage.locator(`.shared-project-chaos [data-shared-container-id="${child.id}"]`);
        await restored.waitFor({state:'visible',timeout:20000});
        assert.equal(await restored.count(),1,'Reload must render exactly one authorized inbox subproject');
        const reread=await viewerContext.request.get(`/api/shared/spaces/${space.id}/projects`);
        assert(reread.ok(),'The authorized participant must still read the project after reload');
        const persisted=(await reread.json()).projects.find(row=>row.id===child.id);
        assert(persisted,'The saved subproject must still be present');
        assert.equal(persisted.parentId,project.id);assert.equal(persisted.boardStatusId,null);
        await viewerPage.screenshot({path:path.join(output,`${tier}-inbox-acl-reloaded.png`),fullPage:true,animations:'disabled'});
      } catch(error) {
        await viewerPage.screenshot({path:path.join(output,`${tier}-inbox-acl-viewer-failure.png`),fullPage:true,animations:'disabled'}).catch(()=>{});
        await viewerPage.locator('body').ariaSnapshot().then(value=>writeFileSync(path.join(output,`${tier}-inbox-acl-viewer-failure.txt`),value)).catch(()=>{});
        throw error;
      }
      assert.deepEqual(viewerErrors,[]);
    });
    return {spaceId:space.id,projectId:project.id,taskIds:tasks.map(row=>row.id),childIds:[child.id,list.id],
      projectOrdering:'No subproject rank field; parentId/boardStatusId persist, server order is updated_at DESC',
      limitations:['No move undo exists; existing trash undo is tested','Numeric rank inside a filtered/paged group uses server positions; an unfiltered complete group compacts gaps','Narrow screens use the existing personal inbox stacked layout while preserving the saved side']};
  } finally {
    await viewerContext?.close();
    await api('account/preferences','PUT',{uiLayout:savedLayout});
  }
}

export async function runSharedInbox({baseURL,output,runtime,php,tiers=['business','premium4life'],phase='after'}) {
  localOrigin(baseURL);assert(runtime&&php,'Supply the owned backend runtime and PHP path');
  assert(!existsSync(path.join(output,'results.json')),'Use a fresh output directory to preserve previous evidence');
  mkdirSync(output,{recursive:true});
  const report={schemaVersion:1,gate:phase==='before'?'shared-project-inbox-baseline-capture':'shared-project-inbox',phase,startedAt:new Date().toISOString(),status:'RUNNING',cases:[],fixtures:[],
    sources:['app/SharedProjects.tsx','app/layout-refinements.css','app/shared-inbox-drop.ts','tests/release-311-interactions.test.mjs','scripts/qa/web-shared-inbox.mjs'].map(file=>({path:file,sha256:createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex')}))};
  const save=()=>writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');save();
  const browser=await chromium.launch({headless:true});report.browser={name:'Chromium',version:browser.version()};
  try {
    for(const tier of tiers) {
      const context=await browser.newContext({baseURL,viewport:{width:1440,height:1600},locale:'ru-RU',timezoneId:'Europe/Moscow'});
      await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
      await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
      await context.tracing.start({screenshots:false,snapshots:true,sources:true});
      const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const check=async(id,operation)=>{
        const item={id:`web.${tier}.${id}`,planId:tier,status:'RUNNING'};report.cases.push(item);save();
        try {await operation();item.status='PASS';}
        catch(error){item.status='FAIL';item.error=error.message;await page.screenshot({path:path.join(output,`${tier}-${id}-failure.png`),fullPage:true}).catch(()=>{});throw error;}
        finally{save();}
      };
      try {
        const login=await context.request.get(`/api/qa/login?tier=${tier}`);assert(login.ok()&&(await login.json()).synthetic);
        await page.goto(baseURL);report.fixtures.push(await verifySharedInbox({context,page,tier,output,check,runtime,php,phase}));
        await check('inbox-no-pageerror',async()=>assert.deepEqual(errors,[]));
      } catch(error) {if(!report.cases.some(row=>row.planId===tier&&row.status==='FAIL'))report.cases.push({id:`web.${tier}.fixture`,planId:tier,status:'FAIL',error:error.message});}
      finally {
        const rawTrace=path.join(tmpdir(),`genesis-inbox-${randomUUID()}.zip`);
        try {
          await context.tracing.stop({path:rawTrace});
          const trace=sanitizeTraceFile(rawTrace,path.join(output,`${tier}-trace.zip`));
          report.traces??=[];report.traces.push({tier,...trace});
        } finally {if(existsSync(rawTrace))unlinkSync(rawTrace);await context.close();save();}
      }
    }
  } finally {await browser.close();report.status=report.cases.every(row=>row.status==='PASS')?'PASS':'FAIL';report.finishedAt=new Date().toISOString();save();}
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const result=await runSharedInbox({baseURL:process.env.GENESIS_QA_WEB_ORIGIN,output:path.resolve(process.env.GENESIS_QA_WEB_OUTPUT??'output/playwright/shared-inbox'),runtime:process.env.GENESIS_QA_BACKEND_RUNTIME,php:process.env.GENESIS_QA_PHP,phase:process.env.GENESIS_QA_INBOX_PHASE??'after'});
  console.log(JSON.stringify({status:result.status,cases:result.cases.map(({id,status})=>({id,status}))}));
  if(result.status!=='PASS')process.exitCode=1;
}
