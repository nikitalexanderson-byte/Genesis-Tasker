import test from 'node:test';
import assert from 'node:assert/strict';
import {clampDockPosition,clampDockSize,dockSavedPosition,dockPositionToLayout,loadNotificationPanelSize,saveNotificationPanelSize} from '../app/notification-dock-model.ts';
import {clearPrivateDeviceStorage} from '../app/local-sign-out.ts';
import {sharedUnreadCount} from '../app/shared-unread-count.ts';

test('both shared counters include task, project, comment and other inbox events',()=>{
 const overview={projects:1,rootProjects:1,subprojects:0,tasks:2,openTasks:2,completedTasks:0,newTasks:2,newProjects:1,newComments:3,newNotifications:4};
 assert.equal(sharedUnreadCount(overview),10);
 assert.equal(sharedUnreadCount({...overview,newComments:0,newTasks:0}),5);
 assert.equal(sharedUnreadCount({...overview,newTasks:0,newProjects:0,newComments:0,newNotifications:0}),0);
 const {newNotifications,...legacy}=overview;assert.equal(sharedUnreadCount(legacy),6);assert.equal(newNotifications,4);
 assert.equal(sharedUnreadCount(null,[{isRead:0},{isRead:1},{isRead:0}]),2);
 assert.equal(sharedUnreadCount(null),0);
});

test('a moved resizable panel restores its relative position using the full window dimensions',()=>{
 const bounds={left:12,top:12,right:1428,bottom:988},size={width:600,height:700},point={x:420,y:150};
 const saved=dockPositionToLayout(point,bounds,size.width,size.height),restored=dockSavedPosition(saved.notificationDockX,saved.notificationDockY,bounds,size.width,size.height);
 assert.ok(Math.abs(restored.x-point.x)<1&&Math.abs(restored.y-point.y)<1);
 const small={left:12,top:12,right:348,bottom:608},fit=clampDockSize(size,small),next=dockSavedPosition(saved.notificationDockX,saved.notificationDockY,small,fit.width,fit.height);
 assert.ok(next.x>=12&&next.y>=12&&next.x+fit.width<=348&&next.y+fit.height<=608);
});
test('panel resize and move remain within a short or narrow viewport',()=>{
 for(const bounds of [{left:12,top:12,right:348,bottom:220},{left:12,top:12,right:1428,bottom:988}])for(const input of [{width:9999,height:9999},{width:0,height:0}]){
  const size=clampDockSize(input,bounds),position=clampDockPosition({x:9999,y:-9999},bounds,size.width,size.height);
  assert.ok(size.width<=bounds.right-bounds.left&&size.height<=bounds.bottom-bounds.top);
  assert.ok(position.x>=bounds.left&&position.y>=bounds.top&&position.x+size.width<=bounds.right&&position.y+size.height<=bounds.bottom);
 }
});
test('desktop panel sizes are account scoped, reject corrupt preferences and survive storage failure',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 saveNotificationPanelSize(storage,'alice',{width:540,height:640});assert.deepEqual(loadNotificationPanelSize(storage,'alice'),{width:540,height:640});assert.deepEqual(loadNotificationPanelSize(storage,'bob'),{width:360,height:560});
 for(const invalid of ['bad','null','{"width":-1,"height":640}','{"width":999999,"height":640}','{"width":540.1,"height":640}']){values.set('genesis.notification-panel.v1:alice',invalid);assert.deepEqual(loadNotificationPanelSize(storage,'alice'),{width:360,height:560});}
 assert.doesNotThrow(()=>saveNotificationPanelSize({setItem:()=>{throw Error('quota');}},'alice',{width:540,height:640}));
});
test('sign-out clears account panel preferences alongside encrypted private journals',()=>{
 const values=new Map([['genesis.notification-panel.v1:alice','{"width":540,"height":640}'],['genesis-language-v1','ru']]);
 clearPrivateDeviceStorage({get length(){return values.size;},key:index=>[...values.keys()][index]??null,removeItem:key=>values.delete(key)});
 assert.deepEqual([...values.keys()],['genesis-language-v1']);
});
