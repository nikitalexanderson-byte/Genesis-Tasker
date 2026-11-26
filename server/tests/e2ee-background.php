<?php
declare(strict_types=1);
require __DIR__.'/e2ee-shared-store.php';
require_once dirname(__DIR__).'/src/background-jobs.php';

function jobRow(string $key): array {
    return genesisE2eeRow(genesisDb(),'SELECT * FROM background_jobs WHERE unique_key=?',[$key]) ?: throw new RuntimeException('Missing synthetic job');
}
function jobScope(string $kind,string $resource,string $scope): void {
    global $owner,$scopeId,$kit,$device,$authority,$public;
    $scopeId=$scope;
    $command=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scope,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis','securityEpoch'=>1,
      'operationId'=>'bootstrap-'.$scope,'payload'=>['kind'=>$kind,'resourceId'=>$resource,'keyId'=>'job-root','generation'=>1,'recoveryKit'=>$kit,
      'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>$public($device),'deviceCapsule'=>storeCapsule($device)]];
    $command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
    genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
}
storeCheck(genesisE2eeLegacyScopeBlocked('project',$project));
storeCheck(genesisE2eeLegacyScopeBlocked('personal','synthetic-e2ee-owner'));
storeCheck(!genesisE2eeLegacyScopeBlocked('project','missing-project'));
storeReject(fn()=>genesisE2eeLegacyAvailableSql('project','x.id OR 1=1'),'E2EE_INVALID_SCOPE_FILTER');
// Invalid legacy rules in an active scope must not even reach legacy parsers.
$protectedRule=genesisE2eeRow($db,"SELECT checked_at FROM shared_automation_rules WHERE id='rule-e2ee'",[]);
$protectedSeries=genesisE2eeRow($db,"SELECT checked_at,last_error FROM shared_task_series WHERE id='series-e2ee'",[]);
$legacyProject='legacy-job-project';
$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$legacyProject,$space,'Legacy',$owner,$now,$now]);
$db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'owner',?)")->execute([$legacyProject,$owner,$now]);
$db->prepare('INSERT INTO shared_automation_rules(id,project_id,owner_id,title,definition_json,checked_at,created_at,updated_at,enabled) VALUES(?,?,?,?,?,?,?,?,1)')
    ->execute(['rule-legacy',$legacyProject,$owner,'Legacy',genesisAutomationEncode(['trigger'=>['type'=>'created']]),'2000-01-01T00:00:00Z',$now,$now]);
$settings=['limit'=>10,'timing'=>'schedule','recurrence'=>['calendarContext'=>['timeZone'=>'UTC']]];
$db->prepare('INSERT INTO shared_task_series(id,project_id,owner_id,rule_json,template_json,cursor_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    ->execute(['series-legacy',$legacyProject,$owner,json_encode($settings,JSON_THROW_ON_ERROR),'{}',gmdate('Y-m-d'),$now,$now]);
genesisAutomationScan();genesisSharedSeriesEnqueue();genesisNotificationScan();genesisHabitReminderMaintenance();
storeCheck(genesisE2eeRow($db,"SELECT checked_at FROM shared_automation_rules WHERE id='rule-e2ee'",[])===$protectedRule);
storeCheck(genesisE2eeRow($db,"SELECT checked_at,last_error FROM shared_task_series WHERE id='series-e2ee'",[])===$protectedSeries);
storeCheck((int)genesisE2eeRow($db,"SELECT needs_refresh FROM habit_reminder_profiles WHERE user_id='synthetic-e2ee-owner'",[])['needs_refresh']===0);
storeCheck(genesisE2eeRow($db,"SELECT id FROM habit_reminder_deliveries WHERE id='e2ee-habit-delivery'",[])!==false);
// Direct leased entrypoints also defer, including a caller holding an old claim.
storeCheck(genesisAdviceNotificationScan(100,$now,[],['available'=>true])===0);
foreach(['habit'=>'genesisHabitReminderPerformLeased','advice'=>'genesisAdviceNotificationPerformLeased'] as $channel=>$perform) {
    $key=$channel.'-protected';genesisBackgroundEnqueue($channel.'-notification',$key,['deliveryId'=>'e2ee-'.$channel.'-delivery']);$job=jobRow($key);
    $db->prepare("UPDATE background_jobs SET state='running',lease_token='stale-claim',attempts=1 WHERE id=?")->execute([$job['id']]);$job=jobRow($key);$sends=0;
    storeCheck($perform($job,static function()use(&$sends):string{$sends++;return 'accepted';})==='pending');storeCheck($sends===0);
    storeCheck(jobRow($key)['payload']===$job['payload']);
}
storeCheck(genesisE2eeRow($db,"SELECT checked_at FROM shared_automation_rules WHERE id='rule-legacy'",[])['checked_at']!=='2000-01-01T00:00:00Z');
// A protected pending/expired job is retained, not retried until failure or acknowledged.
genesisBackgroundEnqueue('shared-series','blocked-series-job',['seriesId'=>'series-e2ee','revision'=>1]);
$initial=jobRow('blocked-series-job');storeCheck(genesisBackgroundClaim(null,'blocked-series-job')===null);
$held=jobRow('blocked-series-job');storeCheck($held===$initial);
$db->prepare("UPDATE background_jobs SET state='running',attempts=5,lease_token='expired',lease_until='2000-01-01T00:00:00Z' WHERE id=?")->execute([$held['id']]);
$future=gmdate('Y-m-d\TH:i:s\Z',time()+86400);storeCheck(genesisBackgroundClaim($future,'blocked-series-job')===null);
$held=jobRow('blocked-series-job');storeCheck($held['state']==='pending'&&(int)$held['attempts']===5&&$held['available_at']>$future);
storeCheck(genesisE2eeRow($db,"SELECT checked_at,last_error FROM shared_task_series WHERE id='series-e2ee'",[])===$protectedSeries);
// A new migration between claim and execution is rechecked under the writer lock.
genesisBackgroundEnqueue('shared-series','race-series-job',['seriesId'=>'series-legacy','revision'=>1]);
$db->prepare('UPDATE background_jobs SET attempts=4 WHERE unique_key=?')->execute(['race-series-job']);
$job=genesisBackgroundClaim(null,'race-series-job');storeCheck($job!==null);
jobScope('project',$legacyProject,'project:job-race');
$source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'job-race','sourceHash'=>$source]),$session);
$attempted=0;storeCheck(genesisBackgroundPerform($job,static function()use(&$attempted):string{$attempted++;return 'succeeded';})==='pending');storeCheck($attempted===0);
storeCheck((int)jobRow('race-series-job')['attempts']===4);
storeCheck(jobRow('race-series-job')['payload']===$job['payload']);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'job-race','fence'=>1]),$session);
$ready=genesisBackgroundClaim($future,'race-series-job');storeCheck($ready!==null);storeCheck(genesisBackgroundPerform($ready,static fn():string=>'succeeded')==='succeeded');
// An active/migrating parent space also gates legacy child work; cancellation restores legacy availability.
jobScope('space',$space,'space:job-parent');$source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'parent-race','sourceHash'=>$source]),$session);
storeCheck(genesisE2eeLegacyScopeBlocked('project',$legacyProject));
genesisAutomationScan();genesisSharedSeriesEnqueue();
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'parent-race','fence'=>1]),$session);
storeCheck(!genesisE2eeLegacyScopeBlocked('project',$legacyProject));
// More than a full old inspection batch must not starve an unrelated due job.
for($i=0;$i<120;$i++)genesisBackgroundEnqueue('shared-series','many-protected-'.$i,['seriesId'=>'series-e2ee','revision'=>1],'2000-01-01T00:00:00Z');
genesisBackgroundEnqueue('synthetic-public','unrelated-ready',[],'2001-01-01T00:00:00Z');
$ready=genesisBackgroundClaim();storeCheck($ready!==null&&$ready['unique_key']==='unrelated-ready');
// Poisoned private bindings are isolated without calling source failure hooks.
// In the same claim, valid work behind them remains runnable. All original bytes
// are retained and a repeated claim cannot repeatedly fail on the poison.
$poisons=['json'=>genesisSharedContentEncrypt('{broken'),'auth'=>GENESIS_SHARED_CONTENT_PREFIX.base64_encode(random_bytes(80)),
    'shape'=>genesisSharedContentEncrypt('null'),'binding'=>genesisSharedContentEncrypt('{"seriesId":"missing-source"}')];
foreach($poisons as $name=>$payload) {
    genesisBackgroundEnqueue('shared-series','poison-'.$name,[],'1990-01-01T00:00:00Z');
    $db->prepare('UPDATE background_jobs SET payload=? WHERE unique_key=?')->execute([$payload,'poison-'.$name]);
}
genesisBackgroundEnqueue('synthetic-public','after-poison',[],'1991-01-01T00:00:00Z');
$ready=genesisBackgroundClaim();storeCheck($ready!==null&&$ready['unique_key']==='after-poison');
foreach($poisons as $name=>$payload) {
    $poison=jobRow('poison-'.$name);
    storeCheck($poison['state']==='failed'&&$poison['error_code']==='E2EE_JOB_REVIEW_REQUIRED'&&(int)$poison['attempts']===0&&$poison['payload']===$payload);
    storeCheck(genesisBackgroundClaim(null,'poison-'.$name)===null);
}
storeCheck(genesisE2eeRow($db,"SELECT checked_at,last_error FROM shared_task_series WHERE id='series-e2ee'",[])===$protectedSeries);
genesisBackgroundEnqueue('shared-series','expired-poison',[]);
$db->prepare("UPDATE background_jobs SET payload=?,state='running',attempts=5,lease_token='poison',lease_until='1990-01-01T00:00:00Z' WHERE unique_key='expired-poison'")->execute([$poisons['json']]);
storeCheck(genesisBackgroundClaim(null,'expired-poison')===null);
storeCheck(jobRow('expired-poison')['state']==='failed'&&jobRow('expired-poison')['payload']===$poisons['json']);
// A direct entrypoint with an old/corrupt claim also retains the job safely.
genesisBackgroundEnqueue('advice-notification','direct-poison',[]);
$db->prepare("UPDATE background_jobs SET payload=?,state='running',attempts=1,lease_token='poison' WHERE unique_key='direct-poison'")->execute([$poisons['json']]);
$poison=jobRow('direct-poison');$sends=0;
storeCheck(genesisAdviceNotificationPerformLeased($poison,static function()use(&$sends){$sends++;return 'accepted';})==='failed');
storeCheck($sends===0&&jobRow('direct-poison')['payload']===$poison['payload']);

// Selection and notification planning have separate transactions. A migration
// winning between them must prevent the day snapshot, deliveries AND jobs.
$raceOwner='advice-plan-race';
$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$raceOwner,$raceOwner,$raceOwner.'@example.invalid',$now,$now]);
$db->prepare('INSERT INTO advice_notification_devices VALUES(?,?,?,?,?,?)')->execute(['advice-race-device',$raceOwner,'advice-race-hash',genesisSharedContentEncrypt('{}'),$now,$now]);
$staged=['synthetic-public-advice','aurora','09:00','UTC',gmdate('Y-m-d\TH:i:s\Z',time()+3600)];
$owner=$raceOwner;$kit['ownerId']=$owner;$kit['protectedKeys']['ownerId']=$owner;
jobScope('personal',$raceOwner,'personal:advice-plan-race');$source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'advice-planning','sourceHash'=>$source]),$session);
storeCheck(genesisAdviceNotificationPlan($raceOwner,'2026-11-18',$staged,$now)===0);
foreach(['advice_notification_days','advice_notification_deliveries'] as $table)storeCheck((int)genesisE2eeRow($db,'SELECT COUNT(*) n FROM '.$table.' WHERE user_id=?',[$raceOwner])['n']===0);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>'advice-planning','fence'=>1]),$session);
storeCheck(genesisAdviceNotificationPlan($raceOwner,'2026-11-18',$staged,$now)===1);
storeCheck(genesisAdviceNotificationPlan($raceOwner,'2026-11-18',$staged,$now)===0);

echo 'PASS e2ee-background '.$checks.' cumulative assertions (mixed scopes/scans/preserved jobs/expiry/claim-cutover race/parent scope/poison quarantine/staged planning)'.PHP_EOL;
