import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapAdviceText } from '../app/advice-share.ts';
import { sharedMovePreview } from '../app/shared-move-preview.ts';
import { isSharedInboxTask, sharedTaskDropPosition } from '../app/shared-inbox-drop.ts';

test('export wraps full multilingual advice without losing words or long Unicode sequences', () => {
  for (const value of ['Полный текст без сокращений', '打开世界展开新的思考', 'A veryveryverylongword and a second paragraph.\nSource attribution']) {
    const lines=wrapAdviceText(value,12,text=>Array.from(text).length);
    assert.ok(lines.every(line=>Array.from(line).length<=12));
    assert.equal(lines.join('').replace(/\s/g,''),value.replace(/\s/g,''));
  }
});

const task={id:'task',projectId:'source',statusId:'todo',title:'Preserved task',revision:7,attachments:[{name:'kept'}]};
const snapshot={project:{id:'source'},tasks:[task],taskPage:{tasks:[task],total:8,statusCounts:{todo:5,done:3}}};
test('the destination status renders while transport is still pending, with matching counters',()=>{
  const result=sharedMovePreview(snapshot,{task:{...task,statusId:'done',pending:true}});
  assert.equal(result.tasks[0].statusId,'done');assert.equal(result.tasks[0].pending,true);
  assert.deepEqual(result.taskPage.statusCounts,{todo:4,done:4});
  assert.equal(result.taskPage.total,8);assert.equal(snapshot.tasks[0].statusId,'todo');
  assert.deepEqual(result.tasks[0].attachments,task.attachments);
});
test('cross-project previews remove the source once without injecting into unrelated authorized queries',()=>{
  const move={...task,projectId:'destination',pending:true};
  const result=sharedMovePreview(snapshot,{task:move});
  assert.equal(result.tasks.length,0);assert.equal(result.taskPage.total,7);
  const unrelated={...snapshot,tasks:[],project:{id:'other'}};
  assert.equal(sharedMovePreview(unrelated,{task:move}),unrelated);
  assert.equal(sharedMovePreview(null,{task:move}),null);
});
test('clearing a rejected preview restores the unchanged source snapshot',()=>{
  assert.equal(sharedMovePreview(snapshot,{}),snapshot);
  assert.equal(snapshot.taskPage.statusCounts.todo,5);
});

test('a newer synchronized row supersedes a queued preview',()=>{
  const actual={...task,statusId:'done',revision:9};
  const base={...snapshot,tasks:[actual]};
  assert.deepEqual(sharedMovePreview(base,{task:{...task,statusId:'todo',pending:true}}).tasks,[actual]);
});

test('project inbox drops retain open/done groups and their insertion order', () => {
  const row = (id, position, completedAt = null) => ({id,projectId:'project',position,completedAt,statusId:`chaos-${completedAt ? 'done' : 'open'}:project`});
  const a=row('a',0), b=row('b',1), c=row('c',2), done=row('done',0,'2026-11-03T12:00:00Z');
  const context={project:{id:'project'},statuses:[{id:'board'}],tasks:[a,done,b,c],taskPage:{statusCounts:{'chaos-open:project':3,'chaos-done:project':1,board:0}}};
  assert(isSharedInboxTask(a,context.statuses));assert(!isSharedInboxTask({statusId:'board'},context.statuses));
  assert.equal(sharedTaskDropPosition(context,a,'','c',false,true),1,'remove a before computing insertion before c');
  assert.equal(sharedTaskDropPosition(context,a,'','c',true,true),2);
  assert.equal(sharedTaskDropPosition(context,c,'','a',false,true),0);
  assert.equal(sharedTaskDropPosition(context,{id:'new',projectId:'other',statusId:'board',position:0},'',undefined,false,true),3);
  assert.equal(sharedTaskDropPosition(context,{id:'completed',projectId:'other',statusId:'done',position:0,completedAt:done.completedAt},'',undefined,false,true),1);
  assert.equal(sharedTaskDropPosition(context,done,'','b',false,true),0,'an open anchor must not change the completed task group');
  assert.deepEqual(context.tasks.map(task=>task.id),['a','done','b','c'],'drop calculation must not reorder the query');
});

test('drop ranks handle complete groups with gaps and paged status totals', () => {
  const moving={id:'moving',projectId:'project',statusId:'board',position:4};
  const before={id:'before',projectId:'project',statusId:'board',position:1};
  const after={id:'after',projectId:'project',statusId:'board',position:9};
  const context={project:{id:'project'},statuses:[{id:'board'}],tasks:[after,moving,before],taskPage:{statusCounts:{board:3}}};
  assert.equal(sharedTaskDropPosition(context,moving,'board','after',false,true),1);
  assert.equal(sharedTaskDropPosition(context,moving,'board','before',true,true),1);
  assert.equal(sharedTaskDropPosition(context,moving,'board',undefined,false,true),2);
  const paged={...context,taskPage:{statusCounts:{board:40}}};
  assert.equal(sharedTaskDropPosition(paged,moving,'board','after'),8);
  assert.equal(sharedTaskDropPosition(paged,moving,'board'),Number.MAX_SAFE_INTEGER);
  assert.equal(sharedTaskDropPosition(context,moving,'board','after'),8,'filtered counts must not compact hidden rows');
  assert.equal(sharedTaskDropPosition(context,moving,'board'),Number.MAX_SAFE_INTEGER,'append must include unseen rows');
});

test('dropping a shared task on itself preserves its persisted position', () => {
  for (const statusId of ['board', 'chaos-open:project', 'chaos-done:project']) {
    const tasks = [0, 4, 9].map(position => ({id:`task-${position}`,projectId:'project',statusId,position,
      completedAt:statusId.includes('done:') ? '2026-11-03T12:00:00Z' : null}));
    const context = {project:{id:'project'},statuses:[{id:'board'}],tasks,taskPage:{statusCounts:{[statusId]:3}}};
    const destination = statusId === 'board' ? statusId : '';
    for (const moving of tasks.slice(0, 2)) for (const after of [false, true]) for (const unfiltered of [false, true]) {
      assert.equal(sharedTaskDropPosition(context,moving,destination,moving.id,after,unfiltered),moving.position);
      const paged = {...context,taskPage:{statusCounts:{[statusId]:40},hasMore:true}};
      assert.equal(sharedTaskDropPosition(paged,moving,destination,moving.id,after,unfiltered),moving.position);
    }
  }
});
