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
 for(let revision=0;revision<2;revision++)await request('PUT',`shared/projects/${project.id}/workflow`,{...workflow,expectedRevision:revision,requestId:crypto.randomUUID()});
 const ruleTitle=canary+' retained disabled automation';
 const definition={schemaVersion:1,trigger:{type:'created'},conditions:[],actions:[{type:'priority',value:2}],calendarMode:'profane',
  calendarContext:{version:2,timeZone:'UTC',gregorianYearStart:'march'}};
 const rule=(await request('POST',`shared/projects/${project.id}/automations`,{operationId:crypto.randomUUID(),title:ruleTitle,enabled:false,definition})).rule;
 assert.equal(rule.enabled,false);
 const maps=[];
 for(const kind of ['project','space']){
  const id=crypto.randomUUID(),title=canary+' '+kind+' map',node=canary+' '+kind+' current node';
  for(let revision=0;revision<2;revision++){
   const document={schemaVersion:1,id,title,pinned:false,archived:false,projectId:kind==='project'?project.id:null,
    nodes:[{id:'root',parentId:null,kind:'idea',text:revision===0?canary+' '+kind+' previous node':node,note:''}],links:[]};
   const saved=await request('PUT',`shared/spaces/${space.id}/mindmaps/${id}`,{schemaVersion:1,expectedRevision:revision,operationId:crypto.randomUUID(),document});
   assert.equal(saved.revision,revision+1);
  }
  const history=await request('GET',`shared/spaces/${space.id}/mindmaps/${id}/history`);assert.equal(history.versions.length,2);
  maps.push({kind,id,title,node,versions:2});
 }
 assert((await request('GET',`shared/projects/${project.id}/tasks/${task.id}/comments`)).comments.some(row=>row.body===comment));
 assert.equal((await request('GET',`shared/projects/${project.id}/workflow/history`)).versions.length,2);
 return{comment,projectComment,ruleTitle,maps,disabledRule:true,workflowVersions:2};
}

export async function readSharedRecords({page,fixture,output}){
 await page.locator(`[data-shared-task-id="${fixture.task.id}"]`).getByText(fixture.task.title,{exact:true}).click();
 const task=page.getByRole('dialog',{name:fixture.task.title,exact:true});await task.waitFor();
 await task.getByText(fixture.records.comment,{exact:true}).waitFor({timeout:60000});
 await task.screenshot({path:`${output}/shared-records-comment.png`,animations:'disabled'});
 await task.getByRole('button',{name:'Закрыть',exact:true}).click();await task.waitFor({state:'hidden'});
 await page.locator('[data-automation-trigger]').click();
 const rules=page.locator('.shared-automations-dialog');await rules.waitFor();
 await rules.getByText(fixture.records.ruleTitle,{exact:true}).click();
 await rules.getByRole('textbox',{name:'Название правила',exact:true}).waitFor();
 assert.equal(await rules.getByRole('textbox',{name:'Название правила',exact:true}).inputValue(),fixture.records.ruleTitle);
 await rules.screenshot({path:`${output}/shared-records-automation.png`,animations:'disabled'});
 await rules.getByRole('button',{name:'Закрыть',exact:true}).click();await rules.waitFor({state:'hidden'});
 await page.locator('.shared-mindmaps-open').click();
 for(const map of fixture.records.maps)await page.getByText(map.title,{exact:true}).waitFor({timeout:60000});
 await page.screenshot({path:`${output}/shared-records-maps.png`,fullPage:true,animations:'disabled'});
 return{taskComment:true,disabledAutomationEditor:true,projectAndSpaceMapTitles:true,historyReadback:false,workflowReadback:false};
}
