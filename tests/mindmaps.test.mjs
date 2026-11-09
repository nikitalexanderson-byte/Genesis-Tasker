import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const modules = new Map();
function loadTs(path) {
 if(modules.has(path)) return modules.get(path);
 const loaded = {exports:{}};
 const source = ts.transpileModule(readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',source)(id => {
   if(id === './i18n') return {runtimeLocale:()=> 'ru-RU',getRuntimeLanguage:()=> 'ru',translateText:v=>v};
   if(id.endsWith('?raw')) return readFileSync(resolve(path,'..',id.slice(0,-4)),'utf8');
   if(id.endsWith('.json')) return JSON.parse(readFileSync(resolve(path,'..',id),'utf8'));
   return id.startsWith('.') ? loadTs(resolve(path,'..',id.endsWith('.ts') ? id : id+'.ts')) : require(id);
 },loaded,loaded.exports);
 modules.set(path,loaded.exports);return loaded.exports;
}
const {newMindmap, validateMindmap, removeBranch, removeThought, moveNode, attachTask, nodeTitle, nodeDateLabel, mapProgress, mapCatalogStats, mapHomeView, parseOutline, exportMindmap, importMindmap, mapSvg, mapMarkdown, layoutMap, resolveMapTask, mapNodeBox, mapConnection, MAP_IMAGE_LIMIT} = loadTs(resolve('app/mindmaps-model.ts'));

const task = {id:'real-task',title:'Source title',done:false,projectId:'project-a',dependsOnIds:['other'],dueDate:'2026-10-12',recurrenceMode:'none',recurrenceExcludedDates:[]};
const view={mode:'map',collapsed:[],focus:null,zoom:1};

test('Premium saves its hundredth personal map and rejects only the hundred-and-first',async()=>{
 const tab=await cloudSyncClient({withMindmaps:true});
 const policy=JSON.parse(readFileSync(resolve('server/resources/feature-access-policy.json'),'utf8'));
 tab.featureAccess.rememberFeatureAccess(tab.userId,{schemaVersion:1,enforcementEnabled:true,effectivePlan:'premium',limits:policy.limits.premium,freeLimits:policy.limits.free,validUntil:'2099-01-01T00:00:00Z'});
 let writes=0;tab.respond((_url,init)=>{writes++;return Response.json({revision:JSON.parse(init.body).expectedRevision+1});});
 const repository=new tab.mindmaps.MindmapRepository(tab.userId);
 for(let n=0;n<99;n++)repository.adopt({document:newMindmap(`Existing ${n}`,null),revision:1,updatedAt:''});
 const map=newMindmap('Hundredth',null);repository.adopt({document:map,revision:0,updatedAt:'',pending:true});
 await repository.save(map,()=>{});assert.equal(writes,1);
 const extra=newMindmap('Over quota',null);repository.adopt({document:extra,revision:0,updatedAt:'',pending:true});
 await assert.rejects(repository.save(extra,()=>{}),{code:'SUBSCRIPTION_QUOTA_mindmaps'});assert.equal(writes,1);
 await repository.save({...map,title:'Existing map still editable'},()=>{});assert.equal(writes,2);
});

test('opening a new map draft does not consume its quota twice; persisted maps still enforce the limit',async()=>{
 const tab=await cloudSyncClient({withMindmaps:true});
 tab.featureAccess.rememberFeatureAccess(tab.userId,{schemaVersion:1,enforcementEnabled:true,effectivePlan:'free',limits:{mindmaps:1},validUntil:null});
 let writes=0;
 tab.respond(async(url,init)=>{
   assert.equal(init.method,'PUT');
   const body=JSON.parse(init.body);writes++;
   return new Response(JSON.stringify({revision:body.expectedRevision+1}));
 });
 const repository=new tab.mindmaps.MindmapRepository(tab.userId),states=[];
 const first=newMindmap('First map',null);
 repository.adopt({document:first,revision:0,updatedAt:'',pending:true});
 await repository.save(first,state=>states.push(state));
 assert.equal(writes,1);assert.equal(states.at(-1),'synced');
 await repository.save({...first,title:'Edited first map'},state=>states.push(state));
 assert.equal(writes,2);
 const second=newMindmap('Over limit',null);
 repository.adopt({document:second,revision:0,updatedAt:'',pending:true});
 await assert.rejects(repository.save(second,()=>{}),{code:'SUBSCRIPTION_QUOTA_mindmaps'});
 assert.equal(writes,2,'A second Free map must never reach the transport');
});

test('map edit history restores content and positions, groups typing, and clears redo after a new edit',()=>{
 const {MindmapEditHistory}=loadTs(resolve('app/mindmap-edit-history.ts'));
 const history=new MindmapEditHistory(),document=newMindmap('History',null,'idea');
 const id=document.nodes[1].id;
 const first={document,positions:undefined,selected:id};
 const moved={...first,positions:{[id]:{x:500,y:300}}};
 history.record(first,moved);
 assert.deepEqual(history.take('undo',moved),first);
 assert.deepEqual(history.take('redo',first),moved);
 const renamed={...moved,document:{...document,nodes:document.nodes.map(node=>node.id===id?{...node,text:'A'}:node)}};
 const typed={...renamed,document:{...renamed.document,nodes:renamed.document.nodes.map(node=>node.id===id?{...node,text:'AB'}:node)}};
 history.record(moved,renamed,'title',1000);history.record(renamed,typed,'title',1100);
 assert.deepEqual(history.take('undo',typed),moved);
 assert.equal(history.canRedo,true);
 const removed={...moved,document:removeThought(document,id)};
 history.record(moved,removed);
 assert.equal(history.canRedo,false);
 assert.deepEqual(history.take('undo',removed),moved);
 history.clear();assert.equal(history.canUndo,false);assert.equal(history.canRedo,false);
});

test('notification positions survive viewport changes and account layout keeps pin settings',()=>{
 const {dockPositionToLayout,dockSavedPosition}=loadTs(resolve('app/notification-dock-model.ts'));
 const {accountLayout}=loadTs(resolve('app/ui-visibility.ts'));
 const bounds={left:300,top:12,right:1428,bottom:988};
 const saved=dockPositionToLayout({x:836,y:472},bounds);
 assert.deepEqual(saved,{notificationDockX:5000,notificationDockY:5000});
 assert.deepEqual(dockSavedPosition(saved.notificationDockX,saved.notificationDockY,{left:12,top:12,right:348,bottom:904}),{x:152,y:430});
 const settings=accountLayout({...saved,notificationDockPinned:true});
 assert.equal(settings.notificationDockPinned,true);assert.equal(settings.notificationDockX,5000);
 assert.equal(accountLayout().notificationDockPinned,false);assert.equal(accountLayout().notificationDockX,-1);
});

test('workspace save acknowledges the encrypted journal before network, and refuses a failed device write',async()=>{
 const tab=await cloudSyncClient(),events=[],entered=deferred(),release=deferred();let failWrite=false;
 const write=tab.storage.setItem.bind(tab.storage);
 tab.storage.setItem=(key,value)=>{if(key.includes(':workspace:')){if(failWrite)throw Error('Quota exceeded');assert.equal(value.includes('secret title'),false);events.push('journal');}write(key,value);};
 tab.respond(async()=>{events.push('network');entered.resolve();await release.promise;return new Response(JSON.stringify({workspace:{version:1,updatedAt:new Date().toISOString()}}));});
 const project={id:'secret-project',title:'secret title',tags:[],status:'active',position:0};
 const save=tab.client.saveWorkspaceStructure([project],[],[],{},undefined,undefined,()=>events.push('acknowledged'));
 await entered.promise;assert.deepEqual(events,['journal','acknowledged','network']);release.resolve();await save;
 assert.equal([...tab.storage.data.keys()].some(key=>key.includes(':workspace:')),false);
 events.length=0;failWrite=true;await assert.rejects(tab.client.saveWorkspaceStructure([project],[],[],{},undefined,undefined,()=>events.push('acknowledged')),/Quota exceeded/);assert.deepEqual(events,[]);
});

test('deleting one thought preserves child branches, sibling order and live task references',()=>{
 const base=newMindmap('Single deletion',null,'idea'),root=base.nodes[0].id,target=base.nodes[1].id;
 const child={id:'child-kept',parentId:target,kind:'idea',text:'Keep child',note:'Keep note'};
 const taskNode={id:'task-kept',parentId:target,kind:'task',refId:task.id,note:''};
 const grandchild={id:'grandchild-kept',parentId:child.id,kind:'idea',text:'Keep grandchild',note:''};
 const map=validateMindmap({...base,nodes:[...base.nodes,child,taskNode,grandchild],links:[{id:'removed-link',from:target,to:base.nodes[2].id,label:'Removed'},{id:'kept-link',from:child.id,to:taskNode.id,label:'Kept'}]});
 const result=removeThought(map,target);
 assert.equal(result.nodes.length,map.nodes.length-1);assert.equal(result.nodes.some(node=>node.id===target),false);
 assert.deepEqual(result.nodes.filter(node=>node.parentId===root).map(node=>node.id),[child.id,taskNode.id,...base.nodes.slice(2).map(node=>node.id)]);
 assert.equal(result.nodes.find(node=>node.id===grandchild.id).parentId,child.id);
 assert.equal(resolveMapTask(result.nodes.find(node=>node.id===taskNode.id),[task]),task);
 assert.deepEqual(result.links,[map.links[1]]);assert.equal(map.nodes.find(node=>node.id===child.id).parentId,target);
 assert.throws(()=>removeThought(map,root));assert.throws(()=>removeThought(map,taskNode.id));
 assert.deepEqual(importMindmap(exportMindmap(result)),result);
});

test('notification dock stays within its work area and returns home after collapse',()=>{
 const {clampDockPosition,clampDockSize,dockHome,newestUnseenToken,NOTIFICATION_PREVIEW_MS}=loadTs(resolve('app/notification-dock-model.ts'));
 const bounds={left:300,top:12,right:1428,bottom:988};
 assert.deepEqual(clampDockPosition({x:-500,y:4000},bounds,360,560),{x:300,y:428});
 assert.deepEqual(dockHome(bounds,56,56),{x:1372,y:932});
 assert.deepEqual(dockHome({left:12,top:12,right:348,bottom:904},56,56),{x:292,y:848});
 assert.deepEqual(clampDockPosition({x:400,y:900},{left:12,top:12,right:300,bottom:500},360,560),{x:12,y:12});
 assert.deepEqual(clampDockSize({width:1,height:1},bounds),{width:320,height:240});
 assert.deepEqual(clampDockSize({width:4000,height:4000},bounds),{width:760,height:820});
 assert.deepEqual(clampDockSize({width:4000,height:4000},{left:12,top:12,right:300,bottom:180}),{width:288,height:168});
 const seen=new Set();assert.equal(newestUnseenToken(['comment:a','task:b'],seen),'comment:a');
 assert.equal(newestUnseenToken(['comment:a','task:b'],seen),null);
 assert.equal(newestUnseenToken(['comment:new','comment:a','task:b'],seen),'comment:new');
 assert.equal(NOTIFICATION_PREVIEW_MS,5000);
});

test('home reveals a moved root from a focused branch without altering saved node positions',()=>{
 const map=newMindmap('Moved root',null,'idea'),root=map.nodes[0].id;
 const positions={[root]:{x:1700,y:1400},[map.nodes[1].id]:{x:2400,y:2200}};
 const previous={...view,focus:map.nodes[1].id,zoom:1.8,viewport:{left:2000,top:1900},positions,collapsed:[map.nodes[2].id]};
 const home=mapHomeView(map,previous);
 assert.equal(home.focus,null);assert.equal(home.zoom,1);
 assert.deepEqual(home.viewport,{left:1676,top:1376});
 assert.deepEqual(home.positions,positions);assert.deepEqual(home.collapsed,previous.collapsed);
 assert.equal(layoutMap(map,home)[0].node.id,root);assert.equal(previous.focus,map.nodes[1].id);
 assert.deepEqual(mapHomeView(map,view).viewport,{left:0,top:0});
});

test('catalog counts current maps and live tasks once, giving device drafts precedence',()=>{
 let a=newMindmap('A',null,'idea');a=attachTask(a,a.nodes[1].id,task);
 let b=newMindmap('B');b=attachTask(b,b.nodes[0].id,task);
 const archived={...newMindmap('Archive'),archived:true};
 const duplicate={...a,nodes:[...a.nodes,{id:'old-only',parentId:a.nodes[0].id,kind:'idea',text:'Old version',note:''}]};
 assert.deepEqual(mapCatalogStats([a,duplicate,b,archived],[task]),{maps:2,ideas:a.nodes.filter(n=>n.kind==='idea').length,total:1,done:0});
 assert.equal(mapCatalogStats([a,b],[{...task,done:true}]).done,1);
 assert.equal(mapCatalogStats([a,b],[]).total,0);
 assert.deepEqual(mapCatalogStats([a,archived],[task],true),{maps:1,ideas:1,total:0,done:0});
});
test('undated tasks stay references without a fabricated calendar occurrence or overdue state',()=>{
 const source={...task,dueDate:'',endDate:'',time:''};const map=newMindmap('Undated');
 const linked=attachTask(map,map.nodes[0].id,source);
 assert.equal(linked.nodes[0].occurrenceDate,undefined);
 assert.equal(nodeDateLabel(linked.nodes[0],[source]),'Без срока');
 const {isTaskOverdue}=loadTs(resolve('app/task-overdue.ts'));
 assert.equal(isTaskOverdue(source,new Date('2026-10-12T12:00:00Z')),false);
 const {recurrenceDatesForTask}=loadTs(resolve('app/task-recurrence.ts'));
 assert.deepEqual(recurrenceDatesForTask(source),[]);
 const {cleanTaskDescription}=loadTs(resolve('app/task-description.ts'));
 assert.equal(cleanTaskDescription('User note\n\nGENESIS-CREATE:'+'a'.repeat(64)),'User note');
});
test('T01/T03 one task resolves live in several maps, unique progress excludes ProjectRef',()=>{
 let a=newMindmap('A',null,'idea');a=attachTask(a,a.nodes[1].id,task);a=attachTask(a,a.nodes[2].id,task);
 let b=newMindmap('B'); b=attachTask(b,b.nodes[0].id,task);
 a.nodes.push({id:'project-ref',kind:'project',refId:'project-a',parentId:a.nodes[0].id,note:''});
 assert.equal(nodeTitle(a.nodes.at(-1),[task],[{id:'project-a',title:'Project source'}]),'Project source');
 assert.deepEqual(mapProgress(a,[task]),{total:1,done:0});
 const updated={...task,title:'Edited in personal affairs',done:true};
 assert.equal(nodeTitle(a.nodes[1],[updated],[]),updated.title);
 assert.equal(nodeTitle(b.nodes[0],[updated],[]),updated.title);
 assert.deepEqual(mapProgress(a,[updated]),{total:1,done:1});
 assert.equal('title' in a.nodes[1],false); assert.equal('text' in a.nodes[1],false);
});
test('T04/T05 moving, deleting and restoring map nodes never mutates tasks or dependencies',()=>{
 let a=newMindmap('A',null,'idea');a=attachTask(a,a.nodes[1].id,task);const baseline=JSON.stringify(task);
 const original=a; a=moveNode(a,a.nodes[1].id,a.nodes[2].id);assert.equal(a.nodes.find(n=>n.refId===task.id).parentId,a.nodes[1].id);
 a=removeBranch(a,a.nodes.find(n=>n.refId===task.id).id);assert.equal(a.nodes.some(n=>n.refId===task.id),false);
 assert.equal(JSON.stringify(task),baseline);assert.equal(nodeTitle(original.nodes[1],[{...task,done:true}],[]),task.title);
 assert.throws(()=>moveNode(original,original.nodes[0].id,original.nodes[1].id));
});
test('conversion preserves children and semantic links, while undo only changes map',()=>{
 let m=newMindmap('Map',null,'idea'); const n=m.nodes[1];m.nodes.push({id:'child',kind:'idea',parentId:n.id,text:'Child',note:''});
 m.links.push({id:'link',from:n.id,to:m.nodes[2].id,label:'related'});
 const converted=attachTask(m,n.id,task);assert.deepEqual(converted.links,m.links);assert.equal(converted.nodes.at(-1).parentId,n.id);assert.equal(m.nodes[1].kind,'idea');
});
test('thought tags survive validation, export and conversion without changing old maps',()=>{
 const old=newMindmap('Plan');assert.equal(old.nodes[0].tags,undefined);
 const tagged=validateMindmap({...old,nodes:old.nodes.map(n=>({...n,tags:['решение','осень']}))});
 assert.deepEqual(importMindmap(exportMindmap(tagged)).nodes[0].tags,['решение','осень']);
 assert.deepEqual(attachTask(tagged,tagged.nodes[0].id,task).nodes[0].tags,['решение','осень']);
 assert.throws(()=>validateMindmap({...old,nodes:old.nodes.map(n=>({...n,tags:Array(9).fill('лишний')}))}));
});
test('T06 occurrence resolves its existing exception and never silently resolves the whole series',()=>{
 const root={...task,recurrenceMode:'classic',recurrenceExcludedDates:['2026-10-12']};
 const n={kind:'task',refId:task.id,occurrenceDate:'2026-10-12'};
 assert.equal(resolveMapTask(n,[root]),undefined);
 const occurrence={...task,id:'exception',recurrenceSeriesId:task.id,done:true};
 assert.equal(resolveMapTask(n,[root,occurrence]),occurrence);
 const moved = {...occurrence,dueDate:'2026-10-20',recurrenceOriginalDate:'2026-10-12'};
 assert.equal(resolveMapTask(n,[root,moved]),moved);
 assert.equal(resolveMapTask({kind:'task',refId:task.id},[root]),undefined);
});
test('ordinary task schedule preserves empty dates, shifted ranges and occurrence exclusions',()=>{
 const schedule=loadTs(resolve('app/personal-task-schedule.ts'));
 const {DEFAULT_RECURRENCE_CONFIG,recurrenceDatesForTask}=loadTs(resolve('app/task-recurrence.ts'));
 const undated={...task,dueDate:'',endDate:'',time:''};
 const saved=schedule.buildTaskSeries(undated,DEFAULT_RECURRENCE_CONFIG)[0];
 assert.equal(saved.dueDate,'');assert.equal(saved.endDate,'');assert.equal(schedule.taskRangeLabel(saved),'Без даты');
 assert.equal(schedule.shiftRangeEndDate('2026-03-07','2026-03-10','2026-03-08'),'2026-03-11');
 const series=schedule.buildTaskSeries({...task,endDate:'2026-10-14',calendarMode:'profane'},
  {...DEFAULT_RECURRENCE_CONFIG,enabled:true,mode:'classic',pattern:'daily',rangeStart:'2026-10-12',rangeEnd:'2026-10-15'})[0];
 const remaining=schedule.taskSeriesAfterExcludingOccurrence(series,'2026-10-12');
 assert.equal(remaining.dueDate,'2026-10-13');assert.equal(remaining.endDate,'2026-10-15');
 assert.deepEqual(recurrenceDatesForTask(remaining),['2026-10-13','2026-10-14','2026-10-15']);
 assert.deepEqual(series.recurrenceExcludedDates,[]);
 const standalone=schedule.standaloneTaskFromOccurrence(schedule.taskForOccurrence(series,'2026-10-14'),series.id);
 assert.equal(standalone.endDate,'2026-10-16');assert.equal(standalone.recurrenceMode,'none');assert.equal(standalone.recurrenceSeriesId,series.id);
});
test('map dates read both start and deadline, shifting a recurring range by the occurrence date',()=>{
 const node={kind:'task',refId:task.id};
 assert.equal(nodeDateLabel(node,[{...task,endDate:'2026-10-20'}]),'2026-10-12 — 2026-10-20');
 const root={...task,recurrence:'daily',recurrenceMode:'classic',recurrencePattern:'daily',recurrenceStartDate:'2026-10-12',recurrenceEndDate:'2026-10-16',endDate:'2026-10-14'};
 assert.equal(nodeDateLabel({...node,occurrenceDate:'2026-10-13'},[root]),'2026-10-13 — 2026-10-15');
});
test('T10 own JSON round-trips; links do not grant access or create tasks',()=>{
 let m=attachTask(newMindmap('Portable'),newMindmap('different').nodes[0].id,task);
 m=attachTask(m,m.nodes[0].id,task);const imported=importMindmap(exportMindmap(m));assert.deepEqual(imported,m);
 assert.equal(nodeTitle(imported.nodes[0],[],[]),'Задача недоступна');
 assert.deepEqual(mapProgress(imported,[]),{total:0,done:0});
});
test('T10 malformed graphs, future schema, excessive depth, size, duplicates and cycles rejected',()=>{
 const base=newMindmap('Safe',null,'idea');
 assert.throws(()=>validateMindmap({...base,schemaVersion:2}));
 assert.throws(()=>validateMindmap({...base,nodes:[...base.nodes,base.nodes[0]]}));
 assert.throws(()=>validateMindmap({...base,nodes:base.nodes.map(n=>({...n,parentId:base.nodes[1].id}))}));
 assert.throws(()=>importMindmap('x'.repeat(2_000_001)));
 let parent=base.nodes[0].id;const nodes=[base.nodes[0]];for(let i=0;i<33;i++){nodes.push({id:`n${i}`,parentId:parent,kind:'idea',text:'x',note:''});parent=`n${i}`;}
 assert.throws(()=>validateMindmap({...base,nodes}));
 assert.throws(()=>validateMindmap({...base,links:[{id:'x',from:base.nodes[0].id,to:'missing',label:''}]}));
});
test('T10 SVG is passive escaped geometry; import strips unrecognized executable fields',()=>{
 const m=newMindmap('<script>alert(1)</script> & javascript:');m.nodes[0].html='<img src=x onerror=alert(1)>';
 const clean=validateMindmap(m);assert.equal(clean.nodes[0].html,undefined);
 const svg=mapSvg(clean,n=>n.text);assert.doesNotMatch(svg,/<script|<foreignObject|href=|onerror=/i);assert.match(svg,/&lt;script&gt;/);
 assert.match(mapMarkdown(clean,n=>n.text),/alert/);
});
test('paste has deterministic indentation, preview limit and no tasks',()=>{
 const nodes=parseOutline('First\n  Child\n\tSibling\n\nSecond','root');assert.equal(nodes.length,4);assert.equal(nodes[1].parentId,nodes[0].id);assert.equal(nodes[2].parentId,nodes[0].id);assert.ok(nodes.every(n=>n.kind==='idea'));
 assert.throws(()=>parseOutline('  Missing root','root'));assert.throws(()=>parseOutline('A\n   Bad indent','root'));assert.throws(()=>parseOutline(Array(201).fill('x').join('\n'),'root'));
});
test('T13 deterministic 200/1000-node layout, collapse and focus (measured CPU, not browser latency)',()=>{
 for(const count of [200,1000]){
  let m=newMindmap('Performance');m={...m,nodes:[m.nodes[0],...Array.from({length:count-1},(_,i)=>({id:`node${i}`,parentId:m.nodes[0].id,kind:'idea',text:`Мысль ${i}`,note:''}))]};
  const samples=[];for(let i=0;i<20;i++){const t=performance.now();const rows=layoutMap(validateMindmap(m),view);assert.equal(rows.length,count);samples.push(performance.now()-t);}
  assert.equal(layoutMap(m,{...view,collapsed:[m.nodes[0].id]}).length,1);assert.equal(layoutMap(m,{...view,focus:'node1'}).length,1);
  console.log(`layout ${count} nodes: p95 ${samples.sort((a,b)=>a-b)[18].toFixed(2)}ms`);
 }
});

test('card presentation and embedded image survive JSON, task conversion and branch changes',()=>{
 const m=newMindmap('Designed',null,'idea'),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 m.nodes[0].presentation={icon:'target',align:'center',width:400,layout:'side',showNote:true,image:{data:png,alt:'Project target',fit:'contain'}};
 m.nodes[1].presentation={icon:'lightbulb'};m.nodes[1].style={fill:'#ffffff',border:'#255b59'};
 const clean=validateMindmap(m);assert.deepEqual(importMindmap(exportMindmap(clean)),clean);
 const converted=attachTask(clean,clean.nodes[0].id,task);assert.deepEqual(converted.nodes[0].presentation,clean.nodes[0].presentation);assert.equal(task.title,'Source title');
 assert.deepEqual(moveNode(clean,clean.nodes[1].id,clean.nodes[2].id).nodes.find(n=>n.id===clean.nodes[1].id).presentation,{icon:'lightbulb'});
});

test('untrusted icons, non-root formatting, remote and executable images are rejected',()=>{
 const m=newMindmap('Safe',null,'idea');
 for(const presentation of [{icon:'../../other'},{width:900},{align:'bottom'},{html:'<script/>'},{image:{data:'https://example.com/a.png',alt:'x',fit:'contain'}},{image:{data:'data:image/svg+xml;base64,PHN2Zy8+',alt:'x',fit:'contain'}},{image:{data:'data:image/png;base64,PHNjcmlwdD4=',alt:'x',fit:'contain'}},{image:{data:'data:image/png;base64,'+'A'.repeat(MAP_IMAGE_LIMIT),alt:'x',fit:'contain'}}]){
  assert.throws(()=>validateMindmap({...m,nodes:m.nodes.map((n,i)=>i? n:{...n,presentation})}));
 }
 assert.throws(()=>validateMindmap({...m,nodes:m.nodes.map((n,i)=>i===1?{...n,presentation:{align:'center'}}:n)}));
 assert.deepEqual(mapNodeBox(m.nodes[0]),{width:240,height:88});
});

test('card dimensions and joints follow wide, tall and manually moved cards in all directions',()=>{
 const m=newMindmap('Root',null,'idea');m.nodes[0].presentation={width:400,align:'center',icon:'target',showNote:true};m.nodes[0].note='Note';
 const rows=layoutMap(m,view),a=rows[0],b=rows[1];assert.equal(a.width,400);assert.ok(a.height>88);assert.ok(b.x>a.x+a.width);assert.ok(b.y>=a.y+a.height+28);
 assert.equal(mapConnection(a,b).start.x,a.x+a.width);assert.equal(mapConnection(a,b).end.x,b.x);
 const left={x:0,y:a.y,width:240,height:88};assert.equal(mapConnection({...a,x:600},left).start.x,600);assert.equal(mapConnection({...a,x:600},left).end.x,240);
 const down={...a,y:a.y+a.height+100};assert.equal(mapConnection(a,down).start.y,a.y+a.height);assert.equal(mapConnection(down,a).end.y,a.y+a.height);
});

test('SVG is self-contained with embedded raster, trusted vectors and license notices',()=>{
 const m=newMindmap('Export');m.nodes[0].presentation={icon:'target',width:400,image:{data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',alt:'<script> example',fit:'cover'}};
 const svg=mapSvg(m,n=>n.text);assert.match(svg,/<metadata>ISC License/);assert.match(svg,/Cole Bemis/);assert.match(svg,/<image href="data:image\/png;base64,/);assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script|<foreignObject|onerror=|href="https?:/i);
});

test('100 bundled PNG icons and feature labels cover every supported language',()=>{
 const catalog=JSON.parse(readFileSync('app/mindmap-icon-catalog.json','utf8')),names=JSON.parse(readFileSync('app/mindmap-icon-names.json','utf8')),copy=JSON.parse(readFileSync('app/mindmap-feature-copy.json','utf8'));
 assert.equal(catalog.length,100);assert.equal(new Set(catalog.map(i=>i.id)).size,100);
 for(const icon of catalog)assert.equal(readFileSync(`public/mindmap-icons/${icon.id}.png`).subarray(1,4).toString(),'PNG');
 for(const language of ['ru','en','de','fr','es','it','pt','pl','el','sr','uk','zh','tr','ja']){
  assert.equal(names[language].length,100);assert.ok(names[language].every(v=>typeof v==='string'&&v.trim()));assert.deepEqual(Object.keys(copy[language]).sort(),Object.keys(copy.ru).sort());assert.ok(Object.values(copy[language]).every(v=>typeof v==='string'&&v.trim()));
 }
});
