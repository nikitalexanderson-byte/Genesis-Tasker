import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Call at the end of a Business/Elite UI pass. All writes target the owned local fixture. */
export async function verifySharedRetention({context, page, tier, output,
  runtime = process.env.GENESIS_QA_BACKEND_RUNTIME, php = process.env.GENESIS_QA_PHP,
  baseURL = process.env.GENESIS_QA_WEB_ORIGIN}) {
  assert(['business','premium4life'].includes(tier), 'Retention fixture requires a collaboration plan');
  assert(runtime && php && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL), 'Explicit local runtime, PHP and web origin required');
  const session = await (await context.request.get(`${baseURL}/api/session`)).json();
  assert.equal(session.user.subscriptionPlan,tier);
  assert.equal(session.user.isAdmin,false);
  assert(session.user.email.endsWith('@example.invalid'));
  const headers = {Origin:baseURL,'X-CSRF-Token':session.csrf};
  const post = async (route,data) => {
    const response = await context.request.post(`${baseURL}/api/${route}`,{headers,data});
    assert(response.ok(), `Synthetic setup failed: ${route}, HTTP ${response.status()}`);
    return response.json();
  };
  const stamp=randomUUID().slice(0,8), title=`QA retained ${tier} ${stamp}`;
  const space=(await post('shared/spaces',{title:`Retention ${stamp}`})).space;
  const project=(await post(`shared/spaces/${space.id}/projects`,{title:`Kept project ${stamp}`})).project;
  const snapshot=await (await context.request.get(`${baseURL}/api/shared/projects/${project.id}`)).json();
  const status=snapshot.statuses.find(item=>!item.isDone);
  assert(status,'Synthetic project needs an open status');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const task=(await post(`shared/projects/${project.id}/tasks`,{title,statusId:status.id,dueDate:today,requestId:randomUUID()})).task;
  const control = (expired) => {
    const args=['-d','disable_functions=curl_exec,mail','scripts/qa/backend-control.php',`--dir=${runtime.replaceAll('\\','/')}`,
      `--tier=${tier}`,'--action=subscription',`--plan=${expired && tier==='premium4life'?'free':tier}`,...(expired?['--state=expired']:[])];
    const result=spawnSync(php,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000});
    assert.equal(result.status,0,`Owned subscription fixture control failed: ${result.stderr}`);
  };
  const requests=[],failures=[];
  const observe=response=>{
    const url=new URL(response.url());
    if(url.origin!==baseURL || !url.pathname.startsWith('/api/shared/'))return;
    const entry={path:url.pathname,method:response.request().method(),status:response.status()};
    requests.push(entry);if(response.status()>=400)failures.push(entry);
  };
  // Stop the previously paid screen and drain its responses before observing
  // the new readonly session; its in-flight writes predate the downgrade.
  await page.goto('about:blank');
  await page.waitForLoadState('networkidle');
  page.on('response',observe);
  try {
    control(true);
    const expired=await (await context.request.get(`${baseURL}/api/session`)).json();
    assert.equal(expired.user.featureAccess.effectivePlan,'free');
    assert.equal(expired.user.sharedProjectsEnabled,true);
    await page.goto(`${baseURL}/#today`);
    await page.locator('.today-shared-tasks').getByText(title,{exact:true}).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('dialog',{name:/Больше возможностей GENESIS/}).count(),0);
    assert.equal(requests.filter(row=>row.path==='/api/shared/notification-context').length,0,'A downgraded read must not write notification context');
    assert.equal(failures.length,0,JSON.stringify(failures));
    assert(requests.some(row=>row.method==='GET'&&row.path==='/api/shared/tasks'&&row.status===200),'Existing task must be read from the API');
    for(const width of [360,390,768,1440])for(const scheme of ['light','dark']){
      await page.setViewportSize({width,height:1000});
      const desired=scheme==='dark'?'standart-dark':'standart';
      if(await page.locator('html').getAttribute('data-genesis-theme')!==desired){
        await page.getByRole('button',{name:scheme==='dark'?'Включить тёмную тему':'Включить светлую тему',exact:true}).click();
      }
      await page.locator('.today-shared-tasks').getByText(title,{exact:true}).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-genesis-theme'),desired);
      assert.equal(await page.getByRole('dialog',{name:/Больше возможностей GENESIS/}).count(),0);
      await page.screenshot({path:`${output}/${tier}-shared-existing-after-downgrade-${width}-${scheme}.png`,fullPage:true,animations:'disabled'});
    }
    await page.locator('.today-task-open').filter({hasText:title}).click();
    // The Today deep link opens the detail dialog. Close it before navigating the project list.
    const linkedDialog=page.getByRole('dialog',{name:title,exact:true});
    await linkedDialog.waitFor();
    await linkedDialog.getByRole('button',{name:'Закрыть',exact:true}).click();
    await linkedDialog.waitFor({state:'hidden'});
    const existingTask=page.locator(`[data-shared-task-id="${task.id}"]`);
    await existingTask.getByText(title,{exact:true}).first().waitFor();
    const currentProject=page.getByRole('combobox',{name:'Текущий проект',exact:true});
    await currentProject.selectOption('');
    await currentProject.selectOption(project.id);
    await existingTask.getByText(title,{exact:true}).first().waitFor();
    await existingTask.getByText(title,{exact:true}).first().click();
    await page.getByRole('dialog',{name:title,exact:true}).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('dialog',{name:/Больше возможностей GENESIS/}).count(),0);
    assert.equal(requests.filter(row=>row.method==='POST'&&row.path.endsWith(`/${task.id}/read`)).length,0,'Opening retained data must not make a paid read acknowledgement');
    assert.equal(requests.filter(row=>row.method==='POST'&&row.path.endsWith('/participants')).length,0,'Existing participants must load without a paid presence write');
    assert.equal(requests.filter(row=>row.method==='PATCH'&&row.path.endsWith('/ui')).length,0,'Readonly project navigation must preserve expansion locally');
    assert(requests.some(row=>row.method==='GET'&&row.path.endsWith('/participants')&&row.status===200),'Existing participant list must remain readable');
    assert.equal(failures.length,0,JSON.stringify(failures));
    await page.screenshot({path:`${output}/${tier}-shared-existing-after-downgrade-details.png`,fullPage:true,animations:'disabled'});
    // A read in a new authenticated session still sees the exact stored task.
    const reopenedContext=await context.browser().newContext({baseURL});
    try {
      await reopenedContext.request.get(`${baseURL}/api/qa/login?tier=${tier}`);
      const reopened=await (await reopenedContext.request.get(`${baseURL}/api/shared/projects/${project.id}/tasks/${task.id}`)).json();
      assert.equal(reopened.task.title,title);
      const exportSession=await (await reopenedContext.request.get(`${baseURL}/api/session`)).json();
      const exported=await reopenedContext.request.post(`${baseURL}/api/shared/spaces/${space.id}/data-export`,{headers:{Origin:baseURL,'X-CSRF-Token':exportSession.csrf},data:{scope:'tree',projectId:project.id}});
      const exportedBody=await exported.json();
      assert.equal(exported.status(),403,JSON.stringify({status:exported.status(),error:exportedBody.error}));
      assert.equal(exportedBody.error,'FEATURE_SUBSCRIPTION_REQUIRED');
      assert.equal(exportedBody.feature,'data-export');
      assert.equal('content' in exportedBody,false);
    } finally { await reopenedContext.close(); }
    assert.equal(await page.getByRole('dialog',{name:/Больше возможностей GENESIS/}).count(),0);
    await page.screenshot({path:`${output}/${tier}-shared-existing-after-downgrade.png`,fullPage:true,animations:'disabled'});
    writeFileSync(`${output}/${tier}-shared-existing-after-downgrade.json`,JSON.stringify({tier,effectivePlan:'free',taskId:task.id,projectId:project.id,title,requests,failures,exportStatus:403,checks:['today task visible','GET remains authorized','no background context write','no upgrade modal','all 8 viewport/scheme states','existing shared task opens in projects','project expansion stays local','participants readable without presence write','no paid read acknowledgement','new session preserves task','ordinary JSON export is denied with no content']},null,2));
  } finally {
    writeFileSync(`${output}/${tier}-shared-existing-after-downgrade-requests.json`,JSON.stringify({requests,failures},null,2));
    page.off('response',observe);
    control(false);
  }
}
