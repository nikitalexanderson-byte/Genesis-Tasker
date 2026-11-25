import assert from 'node:assert/strict';

// Populate the ordinary legacy APIs before the mounted migration. These are
// disabled rules and synthetic content, with no external jobs or authority seed.
export async function seedSharedRecords({context,baseURL,space,project,task,canary}){
 const session=await(await context.request.get('/api/session')).json();
 const headers={Origin:baseURL,'X-CSRF-Token':session.csrf};
 const request=async(method,path,data)=>{
  const response=await context.request.fetch('/api/'+path,{method,headers,...data===undefined?{}:{data}});
  const value=await response.json();assert(response.ok(),`${method} ${path}: ${response.status()} ${value.error??''}`);return value;
 };
 const comment=canary+' retained task comment',projectComment=canary+' retained project comment';
 await request('POST',`shared/projects/${project.id}/tasks/${task.id}/comments`,{body:comment,mentionIds:[]});
 await request('POST',`shared/projects/${project.id}/comments`,{body:projectComment,mentionIds:[]});
 const snapshot=await request('GET',`shared/projects/${project.id}`);
 const statuses=snapshot.statuses.filter(row=>!row.isChaos),roles=['owner','manager','member'];
 assert(statuses.length>=3);
 const workflow={enabled:false,statuses:statuses.map(row=>({statusId:row.id,wipLimit:null,requiredFields:[]})),
  transitions:[{fromStatusId:null,toStatusId:statuses[0].id,roles},...statuses.flatMap(from=>statuses.filter(to=>from.id!==to.id).map(to=>({fromStatusId:from.id,toStatusId:to.id,roles}))) ]};
 const workflowLimits=[2,5],limitedStatus=statuses.find(status=>!status.isDone);
 assert(limitedStatus);
 for(const [revision,limit] of workflowLimits.entries()){
  const statuses=workflow.statuses.map(status=>status.statusId===limitedStatus.id?{...status,wipLimit:limit}:status);
  await request('PUT',`shared/projects/${project.id}/workflow`,{...workflow,statuses,expectedRevision:revision,requestId:crypto.randomUUID()});
 }
 const ruleTitle=canary+' retained disabled automation';
 const definition={schemaVersion:1,trigger:{type:'created'},conditions:[],actions:[{type:'priority',value:2}],calendarMode:'profane',
  calendarContext:{version:2,timeZone:'UTC',gregorianYearStart:'march'}};
 const rule=(await request('POST',`shared/projects/${project.id}/automations`,{operationId:crypto.randomUUID(),title:ruleTitle,enabled:false,definition})).rule;
 assert.equal(rule.enabled,false);
 const maps=[];
 for(const kind of ['project','space']){
  const id=crypto.randomUUID(),title=canary+' '+kind+' map';
  const previousNode=canary+' '+kind+' previous node',node=canary+' '+kind+' current node';
  for(let revision=0;revision<2;revision++){
   const document={schemaVersion:1,id,title,pinned:false,archived:false,projectId:kind==='project'?project.id:null,
    nodes:[{id:'root',parentId:null,kind:'idea',text:revision===0?previousNode:node,note:''}],links:[]};
   const saved=await request('PUT',`shared/spaces/${space.id}/mindmaps/${id}`,{schemaVersion:1,expectedRevision:revision,operationId:crypto.randomUUID(),document});
   assert.equal(saved.revision,revision+1);
  }
  const history=await request('GET',`shared/spaces/${space.id}/mindmaps/${id}/history`);assert.equal(history.versions.length,2);
  maps.push({kind,id,title,node,previousNode,versions:2});
 }
 assert((await request('GET',`shared/projects/${project.id}/tasks/${task.id}/comments`)).comments.some(row=>row.body===comment));
 const versions=(await request('GET',`shared/projects/${project.id}/workflow/history`)).versions;
 assert.equal(versions.length,workflowLimits.length);
 for(const version of versions)assert.equal(version.statuses.find(status=>status.statusId===limitedStatus.id)?.wipLimit,workflowLimits[version.revision-1]);
 return{comment,projectComment,ruleTitle,maps,disabledRule:true,workflowVersions:2,workflowLimits};
}

export async function readSharedRecords({page,fixture,output}){
 await page.locator(`[data-shared-task-id="${fixture.task.id}"]`).getByText(fixture.task.title,{exact:true}).click();
 const task=page.getByRole('dialog',{name:fixture.task.title,exact:true});await task.waitFor();
 await task.getByRole('tab',{name:/^Комментарии · \d+$/}).click();
 await task.getByText(fixture.records.comment,{exact:true}).waitFor({timeout:1200000});
 await task.screenshot({path:`${output}/shared-records-comment.png`,animations:'disabled'});
 await task.getByRole('button',{name:'Закрыть',exact:true}).click();await task.waitFor({state:'hidden'});
 await page.locator('[data-automation-trigger]').click();
 const rules=page.locator('.shared-automations-dialog');await rules.waitFor();
 await rules.getByText(fixture.records.ruleTitle,{exact:true}).click({timeout:1200000});
 await rules.getByRole('textbox',{name:'Название правила',exact:true}).waitFor({timeout:1200000});
 assert.equal(await rules.getByRole('textbox',{name:'Название правила',exact:true}).inputValue(),fixture.records.ruleTitle);
 await rules.screenshot({path:`${output}/shared-records-automation.png`,animations:'disabled'});
 await rules.getByRole('button',{name:'Закрыть',exact:true}).click();await rules.waitFor({state:'hidden'});
 await page.locator('[data-planning-trigger]').click();
 const planning=page.locator('.shared-planning-dialog');await planning.waitFor();
 const workflow=planning.locator('[data-workflow-panel]');
 await workflow.locator(':scope > summary').click();
 const workflowHistory=workflow.locator('.shared-workflow-history');
 await workflowHistory.locator(':scope > summary').click({timeout:1200000});
 await workflowHistory.getByRole('button',{name:'Загрузить',exact:true}).click();
 for(const [index,limit] of fixture.records.workflowLimits.entries()){
  const version=workflowHistory.locator(':scope > details').filter({hasText:new RegExp('^Версия '+(index+1)+' ·')});
  await version.locator(':scope > summary').click({timeout:1200000});
  await version.getByText(new RegExp('^Лимит незавершённых задач: '+limit+' ·')).waitFor();
 }
 await planning.screenshot({path:`${output}/shared-records-workflow-history.png`,animations:'disabled'});
 await planning.getByRole('button',{name:'Закрыть',exact:true}).click();await planning.waitFor({state:'hidden'});

 await page.locator('.shared-mindmaps-open').click();
 const catalog=page.locator('.mindmap-catalog-open');
 for(const map of fixture.records.maps)await catalog.filter({hasText:map.title}).waitFor({timeout:1200000});
 await page.screenshot({path:`${output}/shared-records-maps.png`,fullPage:true,animations:'disabled'});
 for(const map of fixture.records.maps){
  await catalog.filter({hasText:map.title}).click();
  await page.locator('.mindmap-map-title').filter({hasText:map.title}).waitFor();
  await page.getByRole('button',{name:'Настройка карты',exact:true}).click();
  await page.getByRole('dialog',{name:'Настройка карты',exact:true}).getByRole('button',{name:'История',exact:true}).click();
  const history=page.getByRole('dialog',{name:'История карты',exact:true});
  for(const [index,node] of [map.previousNode,map.node].entries()){
   const heading=page.getByRole('heading',{name:'Версия '+(index+1),exact:true});
   const version=history.getByRole('article').filter({has:heading});
   await version.getByText('Посмотреть содержимое',{exact:true}).click({timeout:1200000});
   await version.locator('pre').filter({hasText:node}).waitFor();
  }
  await history.screenshot({path:`${output}/shared-records-${map.kind}-map-history.png`,animations:'disabled'});
  await history.getByRole('button',{name:'Закрыть окно карты',exact:true}).click();await history.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Все майндмепы',exact:true}).click();
 }
 return{taskComment:true,disabledAutomationEditor:true,projectAndSpaceMapTitles:true,historyReadback:true,workflowReadback:true};
}
