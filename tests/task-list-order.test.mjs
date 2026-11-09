import test from 'node:test';
import assert from 'node:assert/strict';
import {orderPersonalTasks,unreadPersonalCommentIds} from '../app/task-list-order.ts';

test('personal task ordering uses creation date, keeps ties stable, and leaves stored order intact',()=>{
  const tasks=[{id:'old',title:'Z',createdAt:'2026-01-01T00:00:00Z'},
    {id:'new-a',title:'B',createdAt:'2026-10-16T00:00:00Z'},
    {id:'new-b',title:'A',createdAt:'2026-10-16T00:00:00Z'},
    {id:'legacy',title:'C'}];
  assert.deepEqual(orderPersonalTasks(tasks,'createdAt').map(task=>task.id),['new-a','new-b','old','legacy']);
  assert.deepEqual(orderPersonalTasks(tasks,'createdAtAsc').map(task=>task.id),['legacy','old','new-a','new-b']);
  assert.deepEqual(orderPersonalTasks(tasks,'title').map(task=>task.id),['new-b','new-a','legacy','old']);
  assert.deepEqual(tasks.map(task=>task.id),['old','new-a','new-b','legacy']);
});
test('undated tasks follow dated tasks and unknown dates cannot introduce NaN comparisons',()=>{
  const tasks=[{id:'none',title:'None',dueDate:null,createdAt:'invalid'},
    {id:'later',title:'Later',dueDate:'2026-10-20'}, {id:'soon',title:'Soon',dueDate:'2026-10-17'}];
  assert.deepEqual(orderPersonalTasks(tasks,'dueDate').map(task=>task.id),['soon','later','none']);
  assert.deepEqual(orderPersonalTasks(tasks,'createdAt').map(task=>task.id),['none','later','soon']);
});
test('only other authors unseen comments are unread, and later arrivals survive acknowledgement',()=>{
  const comments=[{id:'mine',authorId:'me'},{id:'seen',authorId:'peer'},{id:'arriving',authorId:'peer'}];
  assert.deepEqual(unreadPersonalCommentIds(comments,'me',['seen']),['arriving']);
  assert.deepEqual(unreadPersonalCommentIds(comments,'me',['seen','arriving']),[]);
  assert.deepEqual(unreadPersonalCommentIds([...comments,{id:'later',authorId:'peer'}],'me',['seen','arriving']),['later']);
});

test('timestamp sorting retains legacy invalid values, offsets, numeric updates, and stable ties', () => {
  const tasks = Object.freeze([
    Object.freeze({ id: 'invalid', title: 'First', createdAt: 'invalid', updatedAt: 'invalid' }),
    Object.freeze({ id: 'offset', title: 'Second', createdAt: '2026-01-01T03:00:00+03:00', updatedAt: 1767225600000 }),
    Object.freeze({ id: 'utc', title: 'Third', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    Object.freeze({ id: 'missing', title: 'Fourth' }),
  ]);
  assert.deepEqual(orderPersonalTasks(tasks, 'createdAt').map(row => row.id), ['offset', 'utc', 'invalid', 'missing']);
  assert.deepEqual(orderPersonalTasks(tasks, 'createdAtAsc').map(row => row.id), ['invalid', 'missing', 'offset', 'utc']);
  assert.deepEqual(orderPersonalTasks(tasks, 'updatedAt').map(row => row.id), ['offset', 'utc', 'invalid', 'missing']);
  const position = orderPersonalTasks(tasks, 'position');
  assert.notEqual(position, tasks);
  assert.equal(position[0], tasks[0]);
});

test('sorting recalculates edited dates in the same array without retaining another user data', () => {
  const tasks = [{ id: 'a', title: 'A', createdAt: '2026-01-01' }, { id: 'b', title: 'B', createdAt: '2026-02-01' }];
  assert.deepEqual(orderPersonalTasks(tasks, 'createdAt').map(row => row.id), ['b', 'a']);
  tasks[0].createdAt = '2026-03-01';
  assert.deepEqual(orderPersonalTasks(tasks, 'createdAt').map(row => row.id), ['a', 'b']);
});
