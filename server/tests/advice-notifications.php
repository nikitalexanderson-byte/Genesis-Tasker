<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated'&&!getenv('GENESIS_SMOKE_ROOT'))throw new RuntimeException('Isolated environment required.');
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/shared-projects.php';

function anAssert(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
function anReject(callable $action):void {try{$action();}catch(InvalidArgumentException|DomainException){return;}throw new RuntimeException('Invalid advice notification input accepted');}
function anEntry(string $name,array $extra=[]):array {return [...['id'=>'advice-'.substr(hash('sha256',$name),0,24),'title'=>'Synthetic advice','body'=>'Synthetic public advice: '.$name,'language'=>'en','categories'=>['aretology'],'sources'=>[]],...$extra];}

// A runtime backup preserves the old schema; rollback code can still parse and write the original JSON.
$legacy=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
genesisRegisterSharedContentFunctions($legacy);
foreach(glob(dirname(__DIR__).'/migrations/*.sql')as$file)if(strcmp(basename($file),'097_advice_notifications.sql')<0)$legacy->exec(file_get_contents($file));
$legacy->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES('legacy-advice-notify','legacy-advice-notify','legacy@example.invalid','created','updated')");
$backupPath=tempnam(sys_get_temp_dir(),'genesis-advice-97-');
try{
    $legacy->exec('VACUUM INTO '.$legacy->quote($backupPath));
    $legacy->beginTransaction();$legacy->exec(file_get_contents(dirname(__DIR__).'/migrations/097_advice_notifications.sql'));$legacy->commit();
    $legacy->exec("UPDATE users SET advice_notifications_json='{\"enabled\":true,\"time\":\"11:20\",\"timeZone\":\"UTC\"}' WHERE id='legacy-advice-notify'");
    $legacy->exec("UPDATE users SET advice_preferences_json='{\"enabled\":true,\"smart\":true}' WHERE id='legacy-advice-notify'");
    $row=$legacy->query('SELECT * FROM users')->fetch();
    anAssert(!array_diff(array_keys(json_decode($row['advice_preferences_json'],true)),['enabled','smart','categories','aphrodisiaAdult']),'Legacy parser would reject the new preference JSON');
    anAssert(genesisUserAdvicePreferences($row)['notifications']['time']==='11:20','Legacy writer erased new notification choice');
    $backup=new PDO('sqlite:'.$backupPath);
    anAssert($backup->query('PRAGMA integrity_check')->fetchColumn()==='ok','Migration backup is inconsistent');
    anAssert(!in_array('advice_notifications_json',array_column($backup->query('PRAGMA table_info(users)')->fetchAll(PDO::FETCH_ASSOC),'name'),true),'Backup contains post-migration columns');
    anAssert($backup->query("SELECT email FROM users WHERE id='legacy-advice-notify'")->fetchColumn()==='legacy@example.invalid','Backup lost the original account');
}finally{$backup=null;if(is_file($backupPath))unlink($backupPath);}

anAssert(genesisAdvicePreferences([])['notifications']['enabled']===false,'Notifications defaulted on');
foreach([['enabled'=>'true'],['enabled'=>null],['time'=>null],['time'=>'24:00'],['time'=>'9:00'],['timeZone'=>null],['timeZone'=>'invalid'],['unknown'=>true]]as$bad)anReject(fn()=>genesisAdviceNotificationPreferences($bad));
anReject(fn()=>genesisAdvicePreferences(['notifications'=>null]));

$db=genesisDb();$ids=['test-advice-notify','test-advice-notify-other','test-advice-notify-zone','test-advice-notify-dst'];$now='2026-11-01T06:00:00Z';
$entry=anEntry('first');$second=anEntry('second');$cap=['available'=>true];
// Public P-256 base point: a validation fixture, with no private push credential.
$point=hex2bin('046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');
$subscription=['endpoint'=>'https://fcm.googleapis.com/synthetic-advice-only','keys'=>['p256dh'=>genesisPushBase64($point),'auth'=>genesisPushBase64(random_bytes(16))]];
$setting=static function(string $user,array $notifications)use($db):void{genesisUpdateAccountPreferences($user,['advicePreferences'=>['notifications'=>$notifications]]);};
$count=static fn(string $table,string $user):int=>(int)$db->query('SELECT COUNT(*) FROM '.$table.' WHERE user_id='.$db->quote($user))->fetchColumn();
try{
    foreach($ids as$id)$db->prepare('INSERT INTO users(id,google_sub,email,language,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','en',genesisNow(),genesisNow()]);
    [$user,$other,$zoneUser,$dstUser]=$ids;
    $setting($user,['enabled'=>true,'time'=>'09:00','timeZone'=>'Europe/Moscow']);
    $setting($user,['enabled'=>false]);
    $settings=genesisUserAdvicePreferences(genesisFindUser($user))['notifications'];
    anAssert($settings===['enabled'=>false,'time'=>'09:00','timeZone'=>'Europe/Moscow'],'Partial preference patch erased time or timezone');
    $setting($user,['enabled'=>true]);
    anAssert(!array_key_exists('notifications',json_decode(genesisFindUser($user)['advice_preferences_json'],true)),'Notification keys leaked into strict legacy JSON');
    anReject(fn()=>genesisAdviceNotificationRegister($user,['subscription'=>$subscription],$cap));
    anReject(fn()=>genesisAdviceNotificationRegister($user,['subscription'=>$subscription,'consent'=>true],['available'=>false]));
    $device=genesisAdviceNotificationRegister($user,['subscription'=>$subscription,'consent'=>true],$cap)['id'];
    anAssert(genesisAdviceNotificationRegister($user,['subscription'=>$subscription,'consent'=>true],$cap)['id']===$device,'Repeated device connection duplicated the endpoint');
    anAssert(!str_contains($db->query('SELECT encrypted_subscription FROM advice_notification_devices')->fetchColumn(),'fcm.googleapis.com'),'Push endpoint is stored in plaintext');
    genesisAdviceNotificationDelete($other,$device);anAssert(count(genesisAdviceNotificationStatus($user)['devices'])===1,'Another account disconnected the device');
    anAssert(genesisAdviceNotificationScan(100,'2026-11-01T05:59:59Z',[$entry],$cap)===0&&$count('daily_advice_entries',$user)===0,'Advice was drawn before its scheduled time');
    anAssert(genesisAdviceNotificationScan(100,$now,[$entry],['available'=>false])===0&&$count('daily_advice_entries',$user)===0,'Unavailable push spent advice allowance');
    anAssert(genesisAdviceNotificationScan(100,$now,[$entry],$cap)===1,'Scheduled advice was not queued');
    anAssert(genesisAdviceNotificationScan(100,$now,[$second],$cap)===0&&$count('daily_advice_entries',$user)===1,'Repeated scan drew or delivered again');
    $target=['id'=>$entry['id'],'dayKey'=>'2026-11-01','collection'=>'aurora'];
    for($i=0;$i<4;$i++){ $saved=genesisSavedAdvice($user,$target);anAssert($saved['advice']['body']===$entry['body']&&$saved['sequence']===$saved['advice']['sequence']&&!$saved['canNext'],'Saved advice identity changed');}
    anAssert($count('daily_advice_entries',$user)===1,'Opening a saved advice spent allowance');
    anAssert($db->query('SELECT viewed_at FROM daily_advice_entries WHERE user_id='.$db->quote($user))->fetchColumn()===null,'Background selection or saved GET marked advice viewed');
    anAssert(genesisSavedAdvice($other,$target)['advice']===null,'Saved advice crossed accounts');
    anAssert(genesisSavedAdvice($user,[...$target,'collection'=>'philosophers'])['advice']===null,'Saved advice ignored the collection target');
    anReject(fn()=>genesisSavedAdvice($user,[...$target,'dayKey'=>'2026-02-30']));
    // An explicit later draw must not change an already queued notification's target.
    $db->prepare('INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES(?,?,?,?,?,?)')->execute([$user,$target['dayKey'],2,$second['id'],json_encode($second),$now]);
    $db->prepare('UPDATE daily_advice_days SET advice_id=?,entry_json=? WHERE user_id=? AND day_key=?')->execute([$second['id'],json_encode($second),$user,$target['dayKey']]);
    $savedSecond=genesisSavedAdvice($user,[...$target,'id'=>$second['id']]);
    anAssert($savedSecond['sequence']===2&&$savedSecond['advice']['sequence']===2,'Saved response rejected history slot 2');
    $delivery=$db->query('SELECT id FROM advice_notification_deliveries WHERE user_id='.$db->quote($user))->fetchColumn();
    $job=genesisBackgroundClaim($now,'advice-notification:'.$delivery);anAssert($job!==null,'Advice background job was not claimable');
    $sent=[];
    $result=genesisAdviceNotificationPerformLeased($job,static function($destination,$message)use(&$sent,$subscription,$db){
        anAssert(!$db->inTransaction(),'Push held a SQLite writer during network I/O');
        anAssert($destination===$subscription,'Push used another device');$sent[]=$message;return 'accepted';
    },$now);
    anAssert($result==='succeeded'&&$sent===[['channel'=>'advice','deliveryId'=>$delivery]],'Transport leaked content or sent twice');
    anAssert(genesisAdviceNotificationPerformLeased($job,static fn()=>'accepted',$now)==='superseded','Old lease delivered again');
    $message=genesisAdviceNotificationAccess($user,$delivery,$now);
    anAssert($message['displayAllowed']&&$message['message']['body']===$entry['body']&&str_contains($message['message']['url'],'advice='.$entry['id']),'Push did not open the frozen snapshot');
    anAssert(!genesisAdviceNotificationAccess($other,$delivery,$now)['displayAllowed'],'Delivery content crossed accounts');
    genesisUpdateAccountPreferences($user,['advicePreferences'=>['collections'=>['philosophers']]]);
    anAssert(genesisSavedAdvice($user,$target)['advice']===null&&!genesisAdviceNotificationAccess($user,$delivery,$now)['displayAllowed'],'Disabled source still appeared');
    genesisUpdateAccountPreferences($user,['advicePreferences'=>['collections'=>['aurora']]]);
    genesisRecordAdvice($user,$target,true);
    anAssert(genesisSavedAdvice($user,$target)['advice']===null&&!genesisAdviceNotificationAccess($user,$delivery,$now)['displayAllowed'],'Dismissed advice reappeared from notification');
    $adult=anEntry('adult',['categories'=>['aphrodisia'],'requiresAdult'=>true,'aphrodisiaTheme'=>'love']);
    $db->prepare('INSERT INTO daily_advice_entries(user_id,day_key,slot,advice_id,entry_json,created_at) VALUES(?,?,?,?,?,?)')->execute([$other,$target['dayKey'],1,$adult['id'],json_encode($adult),$now]);
    anAssert(genesisSavedAdvice($other,[...$target,'id'=>$adult['id']])['advice']===null,'Unconsented adult snapshot leaked');
    genesisUpdateAccountPreferences($other,['advicePreferences'=>['enabled'=>false]]);
    anAssert(genesisSavedAdvice($other,[...$target,'id'=>$adult['id']])['state']==='disabled','Disabled main advice ignored');

    // Device-zone civil days and the repeated DST hour retain one notification identity.
    foreach([[$zoneUser,'Pacific/Kiritimati','09:00','2026-10-31T20:00:00Z'],[$dstUser,'America/New_York','01:30','2026-11-01T05:30:00Z']]as[$id,$zone,$time,$instant]){
        $setting($id,['enabled'=>true,'time'=>$time,'timeZone'=>$zone]);
        $sub=[...$subscription,'endpoint'=>$subscription['endpoint'].'-'.$id];
        genesisAdviceNotificationRegister($id,['subscription'=>$sub,'consent'=>true],$cap);
        anAssert(genesisAdviceNotificationScan(100,$instant,[$entry],$cap)===1,'Local scheduled time/day was ignored');
        anAssert($db->query('SELECT day_key FROM advice_notification_days WHERE user_id='.$db->quote($id))->fetchColumn()==='2026-11-01','Account zone used UTC day');
    }
    anAssert(genesisAdviceNotificationScan(100,'2026-11-01T06:30:00Z',[$second],$cap)===0,'Repeated DST hour created another delivery');
    anAssert(genesisAdviceNotificationScan(100,'2026-11-02T20:00:00Z',[$entry],$cap)===1,'Next local day did not get its own notification');
    $zoneDelivery=$db->query("SELECT id FROM advice_notification_deliveries WHERE user_id=".$db->quote($zoneUser)." AND day_key='2026-11-01'")->fetchColumn();
    $expired=genesisBackgroundClaim('2026-11-01T23:00:00Z','advice-notification:'.$zoneDelivery);
    anAssert(genesisAdviceNotificationPerformLeased($expired,static function(){throw new RuntimeException('Expired advice reached network');},'2026-11-01T23:00:00Z')==='cancelled','Expired day notification was delivered late');
    $dstDelivery=$db->query('SELECT id FROM advice_notification_deliveries WHERE user_id='.$db->quote($dstUser))->fetchColumn();
    $retryJob=genesisBackgroundClaim('2026-11-01T05:30:00Z','advice-notification:'.$dstDelivery);
    anAssert(genesisAdviceNotificationPerformLeased($retryJob,static function(){throw new RuntimeException('Synthetic provider detail must not be logged');},'2026-11-01T05:30:00Z')==='pending','Retryable delivery did not back off');
    $q=$db->prepare('SELECT error_code FROM background_jobs WHERE id=?');$q->execute([$retryJob['id']]);anAssert($q->fetchColumn()==='ADVICE_NOTIFICATION_RETRY','Provider details leaked into diagnostics');$q->closeCursor();
    $db->prepare("UPDATE background_jobs SET available_at=?,attempts=4 WHERE id=?")->execute(['2026-11-01T05:31:00Z',$retryJob['id']]);
    $finalJob=genesisBackgroundClaim('2026-11-01T05:31:00Z','advice-notification:'.$dstDelivery);
    anAssert(genesisAdviceNotificationPerformLeased($finalJob,static fn()=>'retry','2026-11-01T05:31:00Z')==='failed','Delivery retries were unbounded');
    anAssert(genesisAdviceNotificationPerformLeased($retryJob,static fn()=>'accepted','2026-11-01T05:31:00Z')==='superseded','Replaced lease acknowledged a later result');
    $secondDevice=genesisAdviceNotificationRegister($dstUser,['subscription'=>[...$subscription,'endpoint'=>$subscription['endpoint'].'-dst-second'],'consent'=>true],$cap)['id'];
    anAssert(genesisAdviceNotificationScan(100,'2026-11-01T05:40:00Z',[$second],$cap)===1,'New explicit device could not reuse the frozen day');
    $q=$db->prepare('SELECT id FROM advice_notification_deliveries WHERE device_id=?');$q->execute([$secondDevice]);$pendingId=$q->fetchColumn();$q->closeCursor();
    $setting($dstUser,['enabled'=>false]);$disabledJob=genesisBackgroundClaim('2026-11-01T05:40:00Z','advice-notification:'.$pendingId);
    anAssert(genesisAdviceNotificationPerformLeased($disabledJob,static function(){throw new RuntimeException('Opted-out advice reached network');},'2026-11-01T05:40:00Z')==='cancelled','Queued delivery ignored opt-out');
    anAssert($count('daily_advice_entries',$dstUser)===1,'A new device or opt-out consumed another advice');
    echo "Advice notifications: migration backup/legacy rollback, opt-in/defaults/validation, encrypted self-only devices, local-day/DST scheduling, one draw and delivery, frozen snapshot/read-only replay, source/age/main/dismissal revocation, opaque transport, network outside writer, expiry and bounded leases passed. No external messages sent.\n";
}finally{
    foreach($ids as$id){
        $q=$db->prepare('SELECT id FROM advice_notification_deliveries WHERE user_id=?');$q->execute([$id]);$deliveries=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
        foreach($deliveries as$delivery)$db->prepare('DELETE FROM background_jobs WHERE unique_key=?')->execute(['advice-notification:'.$delivery]);
        $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
    }
}
