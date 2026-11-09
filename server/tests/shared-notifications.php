<?php
declare(strict_types=1);
foreach(['bootstrap','repository','google','shared-projects']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
$noticeSuiteFinished=false;
register_shutdown_function(static function()use(&$noticeSuiteFinished):void{
 if(!$noticeSuiteFinished){fwrite(STDERR,"FAIL shared-notifications: suite did not finish (including early API responses).\n");exit(1);}
});
function noticeExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function noticeRows(string $user,?string $task=null):array{$rows=genesisNotificationInbox($user,'',false,100)['notifications'];return$task?array_values(array_filter($rows,fn($r)=>$r['objectId']===$task)):$rows;}
function noticeKind(string $user,string $kind,string $task):array{return array_values(array_filter(noticeRows($user,$task),fn($r)=>$r['kind']===$kind));}
function noticeReject(callable $fn):void{try{$fn();}catch(GenesisSharedAccessException|InvalidArgumentException){return;}throw new RuntimeException('Expected access/validation rejection');}
function noticeDelivery(string $user,string $event,string $subscription):array{
 $db=genesisDb();$id=genesisUuid();$now=genesisNow();$db->prepare('INSERT INTO shared_notification_outbox(id,user_id,channel,target_id,bucket_key,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')->execute([$id,$user,'push',$subscription,'test:'.$id,$now,$now,$now]);
 $db->prepare('INSERT INTO shared_notification_delivery_items(delivery_id,event_id,user_id,channel,target_id) VALUES(?,?,?,?,?)')->execute([$id,$event,$user,'push',$subscription]);genesisBackgroundEnqueue('shared-notification','notification:'.$id,['deliveryId'=>$id]);return['id'=>$id,'deliveryId'=>$id];
}
$db=genesisDb();$prefix='notify-'.bin2hex(random_bytes(4));$owner=$prefix.'-owner';$watcher=$prefix.'-watcher';$assignee=$prefix.'-assignee';$outsider=$prefix.'-outsider';$users=[$owner,$watcher,$assignee,$outsider];$space=null;
foreach($users as$user){
 $db->prepare('INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  ->execute([$user,$user,$user.'@example.invalid','Synthetic','business',gmdate('Y-m-d\TH:i:s\Z',time()+86400),genesisNow(),genesisNow()]);
 genesisUpdateAccountPreferences($user,['sharedProjectsEnabled'=>true]);
}
try{
 $space=genesisSharedCreateSpace($owner,['title'=>'Notification synthetic']);$project=genesisSharedCreateProject($owner,$space['id'],['title'=>'Notification project']);$pid=$project['id'];
 foreach([$watcher,$assignee]as$user){$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$space['id'],$user,genesisNow()]);$db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$pid,$user,genesisNow()]);}
 $project=genesisSharedUpdateProject($owner,$pid,['title'=>'Notification project updated','expectedRevision'=>$project['revision']]);
 genesisSharedSetMemberRole($owner,$pid,$watcher,['role'=>'viewer']);genesisSharedSetMemberRole($owner,$pid,$watcher,['role'=>'member']);
 $invitationEvent=genesisSharedAudit($pid,$owner,'invitation.accepted',genesisUuid());
 foreach(['project.updated','member.role_changed','invitation.accepted']as$action){$rows=array_values(array_filter(noticeRows($watcher),fn($r)=>$r['action']===$action));noticeExpect(count($rows)>=1&&$rows[0]['kind']==='changes','Project/member legacy notification lost');noticeExpect(!isset(genesisNotificationDestination($watcher,$rows[0]['id'])['taskId']),'Project notification created a nonexistent task link');}
 noticeExpect(in_array($invitationEvent,array_column(genesisSharedNotifications($watcher),'id'),true),'Legacy inbox lost shared project events');
 $statuses=genesisSharedProjectSnapshot($owner,$pid)['statuses'];$open=array_values(array_filter($statuses,fn($s)=>!$s['isDone']))[0]['id'];
 $task=genesisSharedTask($owner,$pid,['title'=>'Private synthetic task','statusId'=>$open,'assigneeId'=>$assignee]);$id=$task['id'];
 noticeExpect(count(noticeKind($assignee,'assignment',$id))===1,'Assignment audience lost raw user ID');noticeExpect(!noticeRows($owner,$id),'Actor notified about own creation');
 noticeReject(fn()=>genesisSharedTaskWatch($outsider,$pid,$id,['watching'=>true]));
 noticeExpect(!genesisSharedTaskWatch($watcher,$pid,$id)['watching'],'Watch enabled without an explicit choice');
 foreach([true,true,false,true]as$watching)noticeExpect(genesisSharedTaskWatch($watcher,$pid,$id,['watching'=>$watching])['watching']===$watching,'Watch put was not idempotent');
 $task=genesisSharedTask($owner,$pid,['expectedRevision'=>$task['revision'],'priority'=>2],$id);noticeExpect(count(noticeKind($watcher,'changes',$id))===1,'Watcher missed significant change');
 $comment=genesisSharedAddComment($owner,$pid,$id,['body'=>'@Synthetic mention fixture','mentionIds'=>[$watcher,$assignee]]);
 $mention=noticeKind($watcher,'mentions',$id);noticeExpect(count($mention)===1&&$mention[0]['commentId']===$comment['id'],'Mention missing or duplicated');
 noticeExpect(count(array_filter(noticeRows($watcher,$id),fn($r)=>$r['id']===$mention[0]['id']))===1,'One audit identity generated multiple inbox rows');
 genesisNotificationRead($watcher,['eventIds'=>[$mention[0]['id']]]);noticeExpect(!array_filter(genesisNotificationInbox($watcher,'',true)['notifications'],fn($r)=>$r['id']===$mention[0]['id']),'Read state did not suppress exactly one mention');
 genesisNotificationRead($watcher,['eventIds'=>[$mention[0]['id']],'read'=>false]);noticeExpect((int)noticeKind($watcher,'mentions',$id)[0]['isRead']===0,'Unread state did not round-trip');
 noticeExpect(genesisNotificationDestination($watcher,$mention[0]['id'])['commentId']===$comment['id'],'Mention deep link lost exact comment');
 genesisSharedTaskWatch($watcher,$pid,$id,['watching'=>false]);$before=count(noticeKind($watcher,'changes',$id));$task=genesisSharedTask($owner,$pid,['expectedRevision'=>$task['revision'],'priority'=>3],$id);noticeExpect(count(noticeKind($watcher,'changes',$id))===$before,'Unwatch did not stop future changes');
 $commentBefore=count(noticeRows($watcher,$id));genesisSharedAddComment($owner,$pid,$id,['body'=>'Unwatched synthetic comment']);noticeExpect(count(noticeRows($watcher,$id))===$commentBefore,'Unwatch did not stop comments or legacy fallback replayed a new event');
 $historical=genesisUuid();$db->prepare('INSERT INTO shared_audit_events(id,project_id,actor_id,action,object_id,created_at,task_id,details_json) VALUES(?,?,?,?,?,?,?,?)')->execute([$historical,$pid,$owner,'task.updated',$id,'2026-01-01T00:00:00Z',$id,'{}']);
 noticeExpect(in_array($historical,array_column(noticeKind($watcher,'changes',$id),'id'),true),'Pre-migration task history disappeared from legacy/common inbox');
 $trashed=genesisSharedTask($owner,$pid,['title'=>'Trash notification fixture','statusId'=>$open,'assigneeId'=>$assignee]);$trashEvent=noticeKind($assignee,'assignment',$trashed['id'])[0]['id'];genesisSharedTrashTask($owner,$pid,$trashed['id'],['expectedRevision'=>$trashed['revision']]);
 noticeExpect(!noticeRows($assignee,$trashed['id']),'Deleted task remained visible through notification history');noticeReject(fn()=>genesisNotificationDestination($assignee,$trashEvent));
 $destination=genesisSharedCreateProject($owner,$space['id'],['title'=>'Moved notification destination']);
 $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$destination['id'],$watcher,genesisNow()]);
 $movedTask=genesisSharedTask($owner,$pid,['title'=>'Moved unread fixture','statusId'=>$open,'assigneeId'=>$watcher]);
 $shownComment=genesisSharedAddComment($owner,$pid,$movedTask['id'],['body'=>'@Synthetic visible before move','mentionIds'=>[$watcher]]);
 $shownEvent=noticeKind($watcher,'mentions',$movedTask['id'])[0]['id'];
 $destinationStatus=genesisSharedProjectSnapshot($owner,$destination['id'])['statuses'][0]['id'];
 genesisSharedMoveTask($owner,$pid,$movedTask['id'],['requestId'=>genesisUuid(),'destinationProjectId'=>$destination['id'],'statusId'=>$destinationStatus,'position'=>0,'expectedRevision'=>$movedTask['revision']]);
 $unshownComment=genesisSharedAddComment($owner,$destination['id'],$movedTask['id'],['body'=>'@Synthetic not displayed yet','mentionIds'=>[$watcher]]);
 genesisSharedReadTaskUpdates($watcher,$destination['id'],$movedTask['id'],['commentIds'=>[$shownComment['id']]]);
 $unread=genesisNotificationInbox($watcher,'',true)['notifications'];
 noticeExpect(!in_array($shownEvent,array_column($unread,'id'),true),'Read comment from the previous project reappeared after move');
 noticeExpect(in_array($unshownComment['id'],array_column($unread,'commentId'),true),'Reading moved task acknowledged an unseen comment');
 $preferences=genesisNotificationPreferences($watcher);$settings=$preferences['settings'];$settings['types']['mentions']=false;genesisNotificationSavePreferences($watcher,['settings'=>$settings,'expectedRevision'=>$preferences['revision']]);noticeExpect(!noticeKind($watcher,'mentions',$id),'Type opt-out was ignored');
 noticeReject(fn()=>genesisNotificationSavePreferences($watcher,['settings'=>$settings,'expectedRevision'=>0]));$settings['types']['mentions']=true;
 genesisNotificationSavePreferences($watcher,['settings'=>$settings,'expectedRevision'=>1]);
 $capabilities=genesisNotificationCapabilities();foreach(['push','email']as$channel)if(!$capabilities[$channel]['available']){$bad=$settings;$bad['channels'][$channel]=true;noticeReject(fn()=>genesisNotificationSavePreferences($watcher,['settings'=>$bad,'expectedRevision'=>2]));}
 $settings['timeZone']='Europe/Berlin';$settings['quiet']=['enabled'=>true,'start'=>'22:00','end'=>'08:00'];
 noticeExpect(genesisNotificationQuietUntil($settings,'2026-10-24T21:00:00Z')==='2026-10-25T07:00:00Z','DST fall-back quiet hours changed duration/end');
 noticeExpect(genesisNotificationQuietUntil($settings,'2026-03-28T22:00:00Z')==='2026-03-29T06:00:00Z','DST spring quiet hours changed end');
 noticeExpect(genesisNotificationQuietUntil($settings,'2026-10-25T09:00:00Z')===null,'Daytime suppressed');$settings['frequency']='hourly';noticeExpect(genesisNotificationScheduleAt($settings,'2026-10-25T09:15:00Z')==='2026-10-25T10:00:00Z','Hourly schedule drifted');
 $settings['frequency']='daily';$settings['digestTime']='09:00';noticeExpect(genesisNotificationScheduleAt($settings,'2026-10-24T10:00:00Z')==='2026-10-25T08:00:00Z','Daily digest ignored recipient DST');
 $task=genesisSharedTask($owner,$pid,['expectedRevision'=>$task['revision'],'approvalRequired'=>true,'approverIds'=>[$watcher]],$id);
 $requests=noticeKind($watcher,'approvalRequest',$id);noticeExpect(count($requests)===1,'Approval request was not targeted');
 genesisSharedApproveTask($watcher,$pid,$id);noticeExpect(!noticeKind($watcher,'approvalRequest',$id),'Completed approval request remains actionable');noticeExpect(count(noticeKind($owner,'approvalResult',$id))===1,'Approval result missing for task author');
 $task=genesisSharedGetTask($owner,$pid,$id);$task=genesisSharedTask($owner,$pid,['expectedRevision'=>$task['revision'],'statusId'=>$open],$id);noticeExpect(count(noticeKind($watcher,'approvalRequest',$id))===1,'Reopened task did not replace its obsolete approval request');
 $today=(new DateTimeImmutable('now',new DateTimeZone('UTC')))->format('Y-m-d');$due=genesisSharedTask($owner,$pid,['title'=>'Reminder synthetic','statusId'=>$open,'assigneeId'=>$assignee,'dueDate'=>$today]);$dueId=$due['id'];
 $as=genesisNotificationPreferences($assignee);$as['settings']['timeZone']='Pacific/Kiritimati';genesisNotificationSavePreferences($assignee,['settings'=>$as['settings'],'expectedRevision'=>$as['revision']]);
 for($i=0;$i<5;$i++)genesisNotificationScan();$reminders=[...noticeKind($assignee,'dueSoon',$dueId),...noticeKind($assignee,'overdue',$dueId)];noticeExpect(count($reminders)===1,'Reminder missing or duplicated across scanner runs');
 $due=genesisSharedTask($owner,$pid,['expectedRevision'=>$due['revision'],'dueDate'=>null],$dueId);noticeExpect(!noticeKind($assignee,'dueSoon',$dueId)&&!noticeKind($assignee,'overdue',$dueId),'Cleared due date left stale reminder');
 $imported=genesisSharedTask($owner,$pid,['title'=>'Imported reminder fixture','statusId'=>$open,'dueDate'=>$today]);$db->prepare('UPDATE shared_notification_task_state SET imported=1 WHERE task_id=?')->execute([$imported['id']]);noticeExpect(!genesisSharedTaskWatch($owner,$pid,$imported['id'])['watching'],'Imported task implicitly enabled watching');for($i=0;$i<5;$i++)genesisNotificationScan();noticeExpect(!noticeKind($owner,'dueSoon',$imported['id'])&&!noticeKind($owner,'overdue',$imported['id']),'Imported task enabled reminders without a choice');genesisSharedTaskWatch($owner,$pid,$imported['id'],['watching'=>true]);for($i=0;$i<5;$i++)genesisNotificationScan();noticeExpect(count(noticeKind($owner,'dueSoon',$imported['id']))+count(noticeKind($owner,'overdue',$imported['id']))===1,'Explicit watch did not enable imported task reminders');
 // Controlled transport; no HTTP request or real recipient is used.
 $subscription=genesisUuid();$rfc=['endpoint'=>'https://fcm.googleapis.com/example','keys'=>['p256dh'=>'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4','auth'=>'BTBZMqHH6r4Tts7J_aSIgg']];
 $db->prepare('INSERT INTO shared_push_subscriptions(id,user_id,endpoint_hash,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$subscription,$watcher,hash('sha256',$subscription),genesisSharedContentEncrypt(json_encode($rfc)),genesisNow(),genesisNow()]);
 $preferences=genesisNotificationPreferences($watcher);$testSettings=$preferences['settings'];$testSettings['channels']['push']=true;$db->prepare('UPDATE shared_notification_preferences SET settings_json=? WHERE user_id=?')->execute([json_encode($testSettings),$watcher]);
 genesisSharedTaskWatch($watcher,$pid,$id,['watching'=>true]);$task=genesisSharedGetTask($owner,$pid,$id);$task=genesisSharedTask($owner,$pid,['expectedRevision'=>$task['revision'],'priority'=>1],$id);$changes=noticeKind($watcher,'changes',$id);$event=$changes[0]['id'];
 $delivery=noticeDelivery($watcher,$event,$subscription);$sent=[];$job=genesisBackgroundClaim(null,'notification:'.$delivery['id']);
 $result=genesisBackgroundPerform($job,static function($kind,$payload)use(&$sent){return genesisNotificationDeliver($payload,static function($channel,$target,$message)use(&$sent){$sent[]=$message;return'accepted';});});
 noticeExpect($result==='succeeded'&&count($sent)===1,'Controlled delivery did not acknowledge atomically');noticeExpect(!str_contains(json_encode($sent),'Private synthetic task'),'Private task title leaked into push payload');
 noticeExpect(genesisBackgroundPerform($job)==='superseded','Old delivery lease performed twice');
 $newDelivery=static function()use($owner,$pid,$id,$watcher,$subscription):array{$event=genesisSharedAudit($pid,$owner,'task.updated',$id,['changes'=>['priority'=>['from'=>2,'to'=>1]]]);return noticeDelivery($watcher,$event,$subscription);};
 $readJob=static function($delivery)use($db):array{$q=$db->prepare('SELECT * FROM background_jobs WHERE unique_key=?');$q->execute(['notification:'.$delivery['id']]);$row=$q->fetch();$q->closeCursor();return$row;};
 $dueNow=static function($delivery)use($db):void{$db->prepare('UPDATE background_jobs SET available_at=? WHERE unique_key=?')->execute([genesisNow(),'notification:'.$delivery['id']]);};
 $networkDelivery=$newDelivery();$job=genesisBackgroundClaim(null,'notification:'.$networkDelivery['id']);
 genesisUpdateAccountPreferences($watcher,['language'=>'el','calendarMode'=>'sacred']);
 noticeExpect(genesisNotificationPerformLeased($job,static function($channel,$target,$message)use($db){noticeExpect(!$db->inTransaction(),'Network transport held the SQLite writer');noticeExpect($message['lang']==='el'&&$message['context']['calendarMode']==='sacred'&&$message['body']===genesisNotificationCopy('Есть новые уведомления в общих делах GENESIS.','el'),'Delivery used actor or capture-time language/calendar');return'accepted';})==='succeeded','Unblocked-network worker failed');
 $quietDelivery=$newDelivery();$quietSettings=$testSettings;$quietSettings['timeZone']='UTC';$quietSettings['quiet']=['enabled'=>true,'start'=>gmdate('H:i',time()-3600),'end'=>gmdate('H:i',time()+3600)];$db->prepare('UPDATE shared_notification_preferences SET settings_json=? WHERE user_id=?')->execute([json_encode($quietSettings),$watcher]);
 $job=genesisBackgroundClaim(null,'notification:'.$quietDelivery['id']);noticeExpect(genesisNotificationPerformLeased($job,static function(){throw new RuntimeException('Quiet hours reached transport');})==='pending','Quiet hours did not defer');noticeExpect((int)$readJob($quietDelivery)['attempts']===0,'Quiet deferral consumed a retry');
 $db->prepare('UPDATE shared_notification_preferences SET settings_json=? WHERE user_id=?')->execute([json_encode($testSettings),$watcher]);
 $lastLease=null;for($attempt=1;$attempt<=5;$attempt++){$dueNow($quietDelivery);$lastLease=genesisBackgroundClaim(null,'notification:'.$quietDelivery['id']);$result=genesisNotificationPerformLeased($lastLease,static function(){throw new RuntimeException('PUSH_RETRY');});noticeExpect($result===($attempt===5?'failed':'pending'),'Retry bound/backoff did not terminate');}
 $q=$db->prepare('SELECT state FROM shared_notification_outbox WHERE id=?');$q->execute([$quietDelivery['id']]);noticeExpect($q->fetchColumn()==='failed','Terminal delivery failure not visible');$q->closeCursor();
 noticeExpect(genesisNotificationRetry($watcher)['resumed']===0,'Unconfigured external channel falsely resumed');$testCaps=genesisNotificationCapabilities();$testCaps['push']=['available'=>true];noticeExpect(genesisNotificationRetry($watcher,$testCaps)['resumed']===1,'Explicit retry did not preserve the failed receipt');
 noticeExpect(genesisNotificationPerformLeased($lastLease,static fn()=>'accepted')==='superseded','Old terminal lease changed resumed operation');$job=genesisBackgroundClaim(null,'notification:'.$quietDelivery['id']);noticeExpect(genesisNotificationPerformLeased($job,static fn()=>'accepted')==='succeeded','Resumed delivery failed');
 $lateDelivery=$newDelivery();$oldLease=genesisBackgroundClaim(null,'notification:'.$lateDelivery['id']);$transportIds=[];
 $result=genesisNotificationPerformLeased($oldLease,static function($channel,$target,$message)use($db,$oldLease,&$transportIds){$transportIds[]=$message['deliveryId'];$db->prepare('UPDATE background_jobs SET lease_token=?,attempts=attempts+1 WHERE id=?')->execute([genesisUuid(),$oldLease['id']]);return'accepted';});
 noticeExpect($result==='superseded','Late network result acknowledged a replaced lease');$currentLease=$readJob($lateDelivery);noticeExpect(genesisNotificationPerformLeased($currentLease,static function($channel,$target,$message)use(&$transportIds){$transportIds[]=$message['deliveryId'];return'accepted';})==='succeeded','Replacement lease did not recover');noticeExpect(count(array_unique($transportIds))===1,'Lost acknowledgement changed browser deduplication identity');
 $expiredDelivery=$newDelivery();$expiredLease=genesisBackgroundClaim(null,'notification:'.$expiredDelivery['id']);$db->prepare("UPDATE background_jobs SET attempts=5,lease_until='2000-01-01T00:00:00Z' WHERE id=?")->execute([$expiredLease['id']]);noticeExpect(genesisBackgroundClaim(null,'notification:'.$expiredDelivery['id'])===null,'Exhausted expired lease reclaimed');$q=$db->prepare('SELECT state FROM shared_notification_outbox WHERE id=?');$q->execute([$expiredDelivery['id']]);noticeExpect($q->fetchColumn()==='failed','Expired final lease left notification pending forever');$q->closeCursor();
 $delivery=noticeDelivery($watcher,$mention[0]['id'],$subscription);$db->prepare('DELETE FROM shared_project_members WHERE project_id IN (?,?) AND user_id=?')->execute([$pid,$destination['id'],$watcher]);
 $job=genesisBackgroundClaim(null,'notification:'.$delivery['id']);$result=genesisBackgroundPerform($job,static function($kind,$payload){return genesisNotificationDeliver($payload,static function(){throw new RuntimeException('Revoked recipient reached transport');});});
 noticeExpect($result==='cancelled'&&!noticeRows($watcher),'Revoked membership left readable/deliverable events');noticeReject(fn()=>genesisNotificationDestination($watcher,$event));noticeReject(fn()=>genesisNotificationDeliveryAccess($watcher,$delivery['id']));
 noticeExpect(!str_contains($db->query("SELECT payload FROM shared_push_subscriptions WHERE id=".$db->quote($subscription))->fetchColumn(),'fcm.googleapis.com'),'Push endpoint stored in plaintext');
 noticeExpect(!$db->query('PRAGMA foreign_key_check')->fetch(),'Notification foreign keys broken');
 $noticePassMessage="Shared notifications: watch/ACL, legacy project/member and pre-migration task history, trash exclusion, assignment/mentions, one event/read identity, unread/deep links, preferences/conflicts, unavailable channels, DST/frequency, approval/reopen, reminder dedup/staleness, quiet deferral, bounded retries/resume, final expired/old/replaced leases, network without SQLite writer, controlled delivery/revocation and encrypted subscriptions passed. No external messages sent.\n";
}finally{
 if($space){$db->prepare('UPDATE shared_tasks SET parent_task_id=NULL WHERE project_id IN (SELECT id FROM shared_projects WHERE space_id=?)')->execute([$space['id']]);$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);}
 foreach($users as$user)$db->prepare('DELETE FROM users WHERE id=?')->execute([$user]);
}
$noticeSuiteFinished=true;echo $noticePassMessage;
