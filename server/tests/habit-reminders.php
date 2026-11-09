<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated'&&!getenv('GENESIS_SMOKE_ROOT'))throw new RuntimeException('Isolated environment required.');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/shared-projects.php';
$db=genesisDb();$user='test-habit-reminders';$other='test-habit-reminders-other';$now=genesisNow();
function hrAssert(bool $ok,string $message): void{if(!$ok)throw new RuntimeException($message);}
function hrReject(callable $action,string $code): void{try{$action();}catch(InvalidArgumentException|DomainException $e){hrAssert($e->getMessage()===$code,'Unexpected rejection: '.$e->getMessage());return;}throw new RuntimeException('Missing rejection: '.$code);}
// Positive snooze/retry fixtures need room before their local day ends. Production
// correctly rejects a ten-minute snooze at 23:55; CI must not assume otherwise.
function hrFixtureZone(string $at): string { $hour=(int)gmdate('G',strtotime($at));return $hour>=2&&$hour<22?'UTC':'Pacific/Honolulu'; }
$testZone=hrFixtureZone($now);
foreach(['2026-10-23T23:55:00Z','2026-10-24T00:00:00Z','2026-10-24T01:59:59Z','2026-10-24T12:00:00Z','2026-10-24T21:59:59Z'] as $fixtureAt){
 $local=(new DateTimeImmutable($fixtureAt))->setTimezone(new DateTimeZone(hrFixtureZone($fixtureAt)));
 hrAssert($local->format('Y-m-d')===$local->modify('+15 minutes')->format('Y-m-d'),'Positive fixture crosses its local day');
}
function hrPlan(int $count=1): array{
 global $testZone;$now=new DateTimeImmutable(genesisNow());$date=$now->setTimezone(new DateTimeZone($testZone))->format('Y-m-d');$rows=[];
 for($i=0;$i<$count;$i++)$rows[]=['id'=>'event-'.$i,'kind'=>'habit','date'=>$date,'at'=>$now->modify('-5 seconds')->format('Y-m-d\TH:i:s.v\Z'),'timeZone'=>$testZone,'allowDuringQuietHours'=>false,'habitId'=>'opaque-'.$i,'ruleId'=>'rule-1','action'=>'complete'];
 return ['version'=>1,'generatedAt'=>$now->modify('-1 minute')->format('Y-m-d\TH:i:s.v\Z'),'expiresAt'=>$now->modify('+2 days')->format('Y-m-d\TH:i:s.v\Z'),'timeZone'=>$testZone,'tone'=>'heroic','quietHoursStart'=>'00:00','quietHoursEnd'=>'00:00','rows'=>$rows];
}
foreach([$user,$other] as $id)$db->prepare('INSERT INTO users(id,google_sub,email,language,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','en',$now,$now]);
// This scenario tests legacy reminder/writer interoperability for existing members.
foreach([$user,$other] as $id)$db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$id]);
$key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);$ec=openssl_pkey_get_details($key)['ec'];
$registration=['deviceKey'=>'synthetic-device-1234','requestId'=>'synthetic-request-1234','consent'=>true,'expectedRevision'=>0,'timeZone'=>$testZone,'maxPerDay'=>128,'snoozeMinutes'=>10,
 'subscription'=>['endpoint'=>'https://fcm.googleapis.com/synthetic-habit','keys'=>['p256dh'=>genesisPushBase64("\x04".$ec['x'].$ec['y']),'auth'=>genesisPushBase64(random_bytes(16))]]];
$cap=['available'=>true];$body=['ciphertext'=>base64_encode('opaque personal content'),'iv'=>base64_encode(random_bytes(12))];
try{
 $vectors=json_decode(file_get_contents(dirname(__DIR__,2).'/tests/fixtures/habit-reminders-vectors.json'),true,32,JSON_THROW_ON_ERROR);
 foreach($vectors as $vector){
  $valid=genesisHabitReminderPlan($vector['plan'],$vector['now']);hrAssert(count($valid['rows'])===count($vector['plan']['rows']),'Shared projection validation mismatch');
  foreach($valid['rows'] as $row)if($row['kind']==='goal')hrAssert(genesisCalendarWallDateTime($row['date'],$row['localTime'],$row['timeZone'])->getTimestamp()===strtotime($row['at']),'Goal wall time differs');
 }
 hrAssert(genesisCalendarWallDateTime('2026-10-25','02:30','Europe/Berlin')->format('P')==='+02:00','Goal overlap used second occurrence');
 hrAssert(!genesisHabitReminderStatus($user)['hasDevices'],'Fresh account auto-enabled');
 hrReject(fn()=>genesisHabitReminderRegister($user,[...$registration,'consent'=>false],$cap),'HABIT_REMINDER_CONSENT_REQUIRED');
 hrReject(fn()=>genesisHabitReminderRegister($user,$registration,['available'=>false]),'HABIT_REMINDER_PUSH_UNAVAILABLE');
 $device=genesisHabitReminderRegister($user,$registration,$cap);hrAssert($device===genesisHabitReminderRegister($user,$registration,$cap),'Registration retry changed revision');
 hrAssert(!str_contains($db->query("SELECT encrypted_subscription FROM habit_reminder_devices WHERE user_id='$user'")->fetchColumn(),'fcm.googleapis.com'),'Subscription plaintext');
 $plan=hrPlan();hrReject(fn()=>genesisHabitReminderPlan([...$plan,'title'=>'private']),'INVALID_HABIT_REMINDER_PLAN');
 $bad=$plan;$bad['rows'][0]['notes']='private';hrReject(fn()=>genesisHabitReminderPlan($bad),'INVALID_HABIT_REMINDER_PLAN');
 $bad=$plan;$bad['rows'][0]['date']='2026-02-31';hrReject(fn()=>genesisHabitReminderPlan($bad),'INVALID_HABIT_REMINDER_DATE');
 $saved=genesisSaveWorkspaceEnvelope($user,[...$body,'habitReminderPlan'=>$plan]);hrAssert($saved['version']===1,'Workspace save failed');
 try{genesisHabitReminderRefresh($user,['workspaceVersion'=>0,'plan'=>$plan]);throw new RuntimeException('Stale projection accepted');}catch(GenesisWorkspaceConflictException){}
 $delivery=$db->query("SELECT * FROM habit_reminder_deliveries WHERE user_id='$user'")->fetch();
 hrAssert(!str_contains($delivery['encrypted_target'],'opaque-0'),'Target plaintext');
 $job=genesisBackgroundClaim($now,'habit-notification:'.$delivery['id']);hrAssert((bool)$job,'Missing due job');
 $calls=0;$transport=function($subscription,$message)use($db,&$calls,$delivery):string{
  hrAssert(!$db->inTransaction(),'Network holds SQLite transaction');hrAssert($message===['channel'=>'habit','deliveryId'=>$delivery['id']],'Push leaked private data');
  $second=new PDO('sqlite:'.genesisConfig()['db_path']);$second->exec('PRAGMA busy_timeout=100');$second->exec('BEGIN IMMEDIATE');$second->exec('ROLLBACK');$calls++;return 'accepted';
 };
 hrAssert(genesisHabitReminderPerformLeased($job,$transport,$now)==='succeeded','Delivery failed');
 hrAssert(genesisHabitReminderPerformLeased($job,$transport,$now)==='superseded'&&$calls===1,'Repeated lease sent twice');
 $access=genesisHabitReminderAccess($user,$delivery['id'],$now);hrAssert($access['displayAllowed']&&$access['target']['habitId']==='opaque-0','Scoped access failed');
 hrAssert($access['message']['body']!=='Время действовать! Сделайте следующий шаг к своей привычке.','English copy absent');
 hrReject(fn()=>genesisHabitReminderAccess($other,$delivery['id'],$now),'HABIT_REMINDER_UNAVAILABLE');
 $snooze=genesisHabitReminderSnooze($user,$delivery['id'],$now);hrAssert($snooze===genesisHabitReminderSnooze($user,$delivery['id'],$now),'Snooze retry duplicated');
 $child=genesisHabitReminderDelivery($snooze['deliveryId']);hrAssert($child['encrypted_target']===$delivery['encrypted_target'],'Snooze changed original target');
 $again=hrPlan();genesisHabitReminderRefresh($user,['workspaceVersion'=>1,'plan'=>$again]);
 hrAssert(genesisHabitReminderDelivery($delivery['id'])['state']==='sent','Refresh forgot receipt');
 hrAssert(genesisHabitReminderDelivery($child['id'])['state']==='pending','Refresh cancelled valid snooze');
 // Older and malformed writers save personal data, invalidate metadata, and cancel stale jobs.
 $saved=genesisSaveWorkspaceEnvelope($user,[...$body,'expectedVersion'=>1]);hrAssert($saved['version']===2&&genesisHabitReminderStatus($user)['profile']['needsRefresh'],'Old writer lost personal save or used stale schedule');
 hrAssert(genesisHabitReminderDelivery($child['id'])['state']==='cancelled','Old writer left snooze');
 $saved=genesisSaveWorkspaceEnvelope($user,[...$body,'expectedVersion'=>2,'habitReminderPlan'=>['private'=>'forbidden']]);hrAssert($saved['version']===3,'Invalid optional projection blocked personal save');
 genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>hrPlan()]);
 // Cancelled events can revive, but sent events never resend.
 $new=hrPlan(2);genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$new]);$second=$db->query("SELECT * FROM habit_reminder_deliveries WHERE user_id='$user' AND event_key='".hash('sha256','event-1')."'")->fetch();
 genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>hrPlan()]);hrAssert(genesisHabitReminderDelivery($second['id'])['state']==='cancelled','Removed event retained');
 genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$new]);hrAssert(genesisHabitReminderDelivery($second['id'])['state']==='pending','Cancelled event failed revival');
 hrAssert((bool)genesisBackgroundClaim(genesisNow(),'habit-notification:'.$second['id']),'Revived job is still dead');
 // Device goals are ordered and rescheduled by their actual device instant.
 $goals=hrPlan(0);$tomorrow=(new DateTimeImmutable($now))->modify('+1 day')->format('Y-m-d');$goals['rows'][]=['id'=>'goal-fixture','kind'=>'goal','date'=>$tomorrow,'at'=>$tomorrow.'T12:00:00.000Z','timeZone'=>'UTC','allowDuringQuietHours'=>false,'localTime'=>'12:00'];
 genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$goals]);$goal=$db->query("SELECT * FROM habit_reminder_deliveries WHERE user_id='$user' AND event_key='".hash('sha256','goal-fixture')."'")->fetch();
 $changed=genesisHabitReminderRegister($user,[...$registration,'expectedRevision'=>$device['revision'],'requestId'=>'synthetic-zone-change','timeZone'=>'Asia/Tokyo'],$cap);
 $q=$db->prepare('SELECT available_at FROM background_jobs WHERE unique_key=?');$q->execute(['habit-notification:'.$goal['id']]);hrAssert($q->fetchColumn()===$tomorrow.'T03:00:00Z','Timezone change did not reschedule pending goal');$q->closeCursor();
 genesisHabitReminderDelete($user,$device['id'],$changed['revision']);
 hrReject(fn()=>genesisHabitReminderRegister($user,$registration,$cap),'HABIT_REMINDER_DEVICE_CONFLICT');
 hrAssert(!genesisHabitReminderStatus($user)['hasDevices'],'Disable left active device');
 $rev=(int)genesisHabitReminderStatus($user,$registration['deviceKey'])['device']['revision'];
 $device=genesisHabitReminderRegister($user,[...$registration,'expectedRevision'=>$rev,'requestId'=>'synthetic-reenable'],$cap);
 hrAssert(genesisHabitReminderStatus($user)['profile']['needsRefresh'],'Reenable used erased schedule');
 // Five due events, four/day: a fifth worker cannot exceed a reservation held outside SQLite.
 $budget=hrPlan(6);foreach($budget['rows'] as &$row)$row['id']='budget-'.$row['id'];unset($row);
 genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$budget]);$db->prepare('UPDATE habit_reminder_devices SET max_per_day=4 WHERE id=?')->execute([$device['id']]);
 $q=$db->prepare("SELECT id FROM habit_reminder_deliveries WHERE device_id=? AND state='pending' AND snooze_of IS NULL ORDER BY event_key");$q->execute([$device['id']]);$ids=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
 // Clear earlier test-day budget only in this synthetic fixture.
 $db->prepare('UPDATE habit_reminder_deliveries SET reserved_at=NULL WHERE device_id=?')->execute([$device['id']]);
 for($i=0;$i<3;$i++)hrAssert(genesisHabitReminderPerformLeased(genesisBackgroundClaim(genesisNow(),'habit-notification:'.$ids[$i]),fn()=>'accepted')==='succeeded','Budget setup');
 $fourth=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$ids[3]);$fifth=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$ids[4]);
 hrAssert(genesisHabitReminderPerformLeased($fourth,function()use($fifth){hrAssert(genesisHabitReminderPerformLeased($fifth,fn()=>throw new RuntimeException('Budget exceeded'))==='cancelled','Concurrent budget not reserved');return 'accepted';})==='succeeded','Fourth delivery failed');
 // Reclaimed lease after a transport timeout uses the same delivery ID and durable receipt.
 $db->prepare('UPDATE habit_reminder_devices SET max_per_day=128 WHERE id=?')->execute([$device['id']]);$job=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$ids[5]);
 hrAssert(genesisHabitReminderPerformLeased($job,fn()=>throw new RuntimeException('PUSH_RETRY'))==='pending','Transport failure destroyed job');
 $retry=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',time()+180),'habit-notification:'.$ids[5]);
 hrAssert(genesisHabitReminderPerformLeased($retry,fn()=>'accepted')==='succeeded','Transport retry failed');
 hrAssert(!genesisHabitReminderAccess($user,$ids[5],gmdate('Y-m-d\TH:i:s\Z',time()+86400))['displayAllowed'],'Next-day notification displayed');
 $leases=hrPlan();$leases['rows'][0]['id']='lease-reclaim';genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$leases]);
 $q=$db->prepare('SELECT id FROM habit_reminder_deliveries WHERE device_id=? AND event_key=?');$q->execute([$device['id'],hash('sha256','lease-reclaim')]);$reclaimedId=$q->fetchColumn();$q->closeCursor();
 $oldLease=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$reclaimedId);
 hrAssert(genesisHabitReminderPerformLeased($oldLease,function()use($db,$oldLease){
  $db->prepare('UPDATE background_jobs SET lease_token=?,lease_until=? WHERE id=?')->execute(['synthetic-reclaimed-lease',gmdate('Y-m-d\TH:i:s\Z',time()-1),$oldLease['id']]);return 'accepted';
 })==='superseded','Replaced lease acknowledged a result');
 $newLease=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$reclaimedId);
 hrAssert(genesisHabitReminderPerformLeased($newLease,fn()=>'accepted')==='succeeded','Reclaimed lease failed stable receipt retry');
 $leases['rows'][0]['id']='invalidate-during-network';genesisHabitReminderRefresh($user,['workspaceVersion'=>3,'plan'=>$leases]);
 $q=$db->prepare('SELECT id FROM habit_reminder_deliveries WHERE device_id=? AND event_key=?');$q->execute([$device['id'],hash('sha256','invalidate-during-network')]);$invalidId=$q->fetchColumn();$q->closeCursor();
 $leased=genesisBackgroundClaim(genesisNow(),'habit-notification:'.$invalidId);
 hrAssert(genesisHabitReminderPerformLeased($leased,function()use($user,$body){genesisSaveWorkspaceEnvelope($user,[...$body,'expectedVersion'=>3]);return 'accepted';})==='superseded','A revoked plan survived a network wait');
 hrReject(fn()=>genesisHabitReminderAccess($user,$invalidId),'HABIT_REMINDER_UNAVAILABLE');
 genesisHabitReminderRefresh($user,['workspaceVersion'=>4,'plan'=>hrPlan()]);
 $db->prepare('UPDATE habit_reminder_profiles SET expires_at=? WHERE user_id=?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-1),$user]);
 $db->prepare('UPDATE habit_reminder_deliveries SET expires_at=? WHERE id=?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-8*86400),$reclaimedId]);
 genesisHabitReminderMaintenance();
 hrAssert(genesisHabitReminderStatus($user)['profile']['needsRefresh']&&!genesisHabitReminderProfile($user)['encrypted_plan'],'Expired metadata remained active');
 hrAssert(genesisHabitReminderDelivery($reclaimedId)===null&&genesisHabitReminderDelivery($delivery['id'])['state']==='sent','Receipt retention lost recent state or retained expired metadata');
 hrAssert(genesisHabitReminderQuiet(new DateTimeImmutable('2026-03-29T00:30:00Z'),'Europe/Berlin','22:00','08:00'),'DST quiet hours failed');
 echo "Habit reminders: consent/revision races, encryption/privacy, writer compatibility, leases without SQLite lock, access, receipt retry, snooze, timezone reschedule, revival, frequency reservations and stale-day checks passed.\n";
}finally{
 $db->prepare("DELETE FROM background_jobs WHERE kind='habit-notification' AND unique_key IN (SELECT 'habit-notification:'||id FROM habit_reminder_deliveries WHERE user_id IN (?,?))")->execute([$user,$other]);
 $db->prepare('DELETE FROM users WHERE id IN (?,?)')->execute([$user,$other]);
}
