<?php
declare(strict_types=1);
require_once __DIR__.'/daily-advice.php';
require_once __DIR__.'/web-push.php';
require_once __DIR__.'/shared-content-storage.php';
require_once __DIR__.'/background-jobs.php';

function genesisAdviceNotificationStatus(string $userId): array
{
    $q=genesisDb()->prepare('SELECT id FROM advice_notification_devices WHERE user_id=? ORDER BY created_at,id');
    $q->execute([$userId]);$devices=$q->fetchAll();$q->closeCursor();
    return ['capabilities'=>array_intersect_key(genesisPushConfiguration(),array_flip(['available','blocker','publicKey'])),'devices'=>$devices];
}

/** Reuses the existing encrypted Web Push transport, with separate, explicit advice consent. */
function genesisAdviceNotificationRegister(string $userId,array $input,?array $testCapabilities=null): array
{
    if (array_diff(array_keys($input),['subscription','consent']) || ($input['consent']??null)!==true)
        throw new InvalidArgumentException('ADVICE_NOTIFICATION_CONSENT_REQUIRED');
    if (!genesisFindUser($userId)) throw new DomainException('AUTH_REQUIRED');
    if (!($testCapabilities??genesisPushConfiguration())['available']) throw new DomainException('ADVICE_PUSH_UNAVAILABLE');
    $subscription=genesisPushSubscription(is_array($input['subscription']??null)?$input['subscription']:[]);
    $hash=hash('sha256',$subscription['endpoint']);$db=genesisDb();$now=genesisNow();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT id,user_id FROM advice_notification_devices WHERE endpoint_hash=?');
        $q->execute([$hash]);$old=$q->fetch();$q->closeCursor();
        if ($old&&$old['user_id']!==$userId) {$db->prepare('DELETE FROM advice_notification_devices WHERE id=?')->execute([$old['id']]);$old=false;}
        if (!$old) {
            $q=$db->prepare('SELECT COUNT(*) FROM advice_notification_devices WHERE user_id=?');$q->execute([$userId]);$count=(int)$q->fetchColumn();$q->closeCursor();
            if ($count>=20) throw new DomainException('ADVICE_DEVICE_LIMIT');
        }
        $id=$old['id']??genesisUuid();
        $db->prepare('INSERT INTO advice_notification_devices(id,user_id,endpoint_hash,encrypted_subscription,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_subscription=excluded.encrypted_subscription,updated_at=excluded.updated_at')
            ->execute([$id,$userId,$hash,genesisSharedContentEncrypt(json_encode($subscription,JSON_THROW_ON_ERROR)),$now,$now]);
        $db->commit();return ['id'=>$id];
    } catch(Throwable $e) {if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisAdviceNotificationDelete(string $userId,string $id): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE kind='advice-notification' AND state IN ('pending','running') AND unique_key IN (SELECT 'advice-notification:'||id FROM advice_notification_deliveries WHERE user_id=? AND device_id=?)")->execute([genesisNow(),$userId,$id]);
        $db->prepare('DELETE FROM advice_notification_devices WHERE id=? AND user_id=?')->execute([$id,$userId]);$db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** One snapshot per account/local day, then one idempotent delivery per explicitly connected browser. */
function genesisAdviceNotificationScan(int $limit=100,?string $now=null,?array $catalogFixture=null,?array $testCapabilities=null): int
{
    if (!($testCapabilities??genesisPushConfiguration())['available']) return 0;
    $now??=genesisNow();$instant=new DateTimeImmutable($now);$db=genesisDb();$count=0;
    $q=$db->query("SELECT id,advice_notifications_json FROM users WHERE json_extract(advice_notifications_json,'$.enabled')=1 AND EXISTS(SELECT 1 FROM advice_notification_devices d WHERE d.user_id=users.id) ORDER BY id");
    $users=$q->fetchAll();$q->closeCursor();
    foreach ($users as $candidate) {
        if ($count>=max(1,min(500,$limit))) break;
        $user=genesisFindUser($candidate['id']);if(!$user)continue;$preferences=genesisUserAdvicePreferences($user);$settings=$preferences['notifications'];
        if (!$preferences['enabled']||!$settings['enabled']) continue;
        $local=$instant->setTimezone(new DateTimeZone($settings['timeZone']));$day=$local->format('Y-m-d');
        $at=genesisCalendarWallDateTime($day,$settings['time'],$settings['timeZone']);
        // A delayed cron never sends yesterday's content or a burst of missed daily notifications.
        $expiry=min($local->setTime(0,0)->modify('+1 day')->getTimestamp(),$at->getTimestamp()+7200);
        if ($instant<$at||$instant->getTimestamp()>=$expiry) continue;
        $q=$db->prepare('SELECT * FROM advice_notification_days WHERE user_id=? AND day_key=?');$q->execute([$user['id'],$day]);$snapshot=$q->fetch();$q->closeCursor();
        if (!$snapshot) {
            $q=$db->prepare('SELECT advice_id,entry_json FROM daily_advice_days WHERE user_id=? AND day_key=?');$q->execute([$user['id'],$day]);$current=$q->fetch();$q->closeCursor();
            if (!$current) {
                // No personal documents are read for scheduled selection. Existing snapshots are never rerolled.
                $safeItems=array_values(array_filter($catalogFixture??genesisAdviceCatalog(),'genesisAdviceNotificationSafe'));
                genesisDailyAdvice($user['id'],[],$safeItems,false,$local);
                $q->execute([$user['id'],$day]);$current=$q->fetch();$q->closeCursor();
            }
            if (!$current) continue;
            $entry=json_decode($current['entry_json'],true,32,JSON_THROW_ON_ERROR);
            if (!genesisAdviceNotificationSafe($entry)) continue;
            $target=['id'=>$current['advice_id'],'dayKey'=>$day,'collection'=>$entry['collection']??'aurora'];
            if (!genesisSavedAdvice($user['id'],$target)['advice']) continue;
            $db->prepare('INSERT OR IGNORE INTO advice_notification_days(user_id,day_key,advice_id,collection,scheduled_time,time_zone,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
                ->execute([$user['id'],$day,$target['id'],$target['collection'],$settings['time'],$settings['timeZone'],gmdate('Y-m-d\TH:i:s\Z',$expiry),$now]);
        }
        genesisBeginWriteTransaction($db);
        try {
            $q=$db->prepare('SELECT id FROM advice_notification_devices WHERE user_id=?');$q->execute([$user['id']]);$devices=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
            foreach ($devices as $device) {
                $id=genesisUuid();$insert=$db->prepare('INSERT OR IGNORE INTO advice_notification_deliveries(id,user_id,device_id,day_key,created_at,updated_at) VALUES(?,?,?,?,?,?)');
                $insert->execute([$id,$user['id'],$device,$day,$now,$now]);
                if ($insert->rowCount()) {genesisBackgroundEnqueue('advice-notification','advice-notification:'.$id,['deliveryId'=>$id],$now);$count++;}
            }
            $db->commit();
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    }
    return $count;
}

function genesisAdviceNotificationDelivery(string $id,?string $userId=null): ?array
{
    $q=genesisDb()->prepare('SELECT d.*,n.advice_id,n.collection,n.scheduled_time,n.time_zone,n.expires_at,v.encrypted_subscription FROM advice_notification_deliveries d JOIN advice_notification_days n ON n.user_id=d.user_id AND n.day_key=d.day_key JOIN advice_notification_devices v ON v.id=d.device_id AND v.user_id=d.user_id WHERE d.id=?'.($userId===null?'':' AND d.user_id=?'));
    $q->execute($userId===null?[$id]:[$id,$userId]);$row=$q->fetch();$q->closeCursor();return $row?:null;
}

function genesisAdviceNotificationCurrent(array $delivery,string $now): ?array
{
    $user=genesisFindUser($delivery['user_id']);if(!$user)return null;$preferences=genesisUserAdvicePreferences($user);$settings=$preferences['notifications'];
    if (!$preferences['enabled']||!$settings['enabled']||$settings['time']!==$delivery['scheduled_time']||$settings['timeZone']!==$delivery['time_zone']
        ||strtotime($delivery['expires_at'])<=strtotime($now))return null;
    if ((new DateTimeImmutable($now))->setTimezone(new DateTimeZone($settings['timeZone']))->format('Y-m-d')!==$delivery['day_key'])return null;
    $advice=genesisSavedAdvice($user['id'],['id'=>$delivery['advice_id'],'dayKey'=>$delivery['day_key'],'collection'=>$delivery['collection']])['advice'];
    return $advice&&genesisAdviceNotificationSafe($advice)?$advice:null;
}

function genesisAdviceNotificationMessage(array $delivery,array $advice): array
{
    return ['deliveryId'=>$delivery['id'],'title'=>$advice['title']??'GENESIS','body'=>$advice['body'],'lang'=>$advice['language'],
        'url'=>rtrim(genesisConfig()['app_url'],'/').'/?'.http_build_query(['advice'=>$advice['id'],'adviceDay'=>$advice['dayKey'],'adviceCollection'=>$advice['collection']]).'#today'];
}

/** The push contains an opaque ID; cookies and current visibility are checked again before OS display. */
function genesisAdviceNotificationAccess(string $userId,string $id,?string $now=null): array
{
    $delivery=genesisAdviceNotificationDelivery($id,$userId);$advice=$delivery&&in_array($delivery['state'],['sending','sent'],true)?genesisAdviceNotificationCurrent($delivery,$now??genesisNow()):null;
    return ['displayAllowed'=>$advice!==null,'userId'=>$userId,'message'=>$advice?genesisAdviceNotificationMessage($delivery,$advice):null];
}

/** Network I/O runs without a SQLite writer. Only the current lease can acknowledge a result. */
function genesisAdviceNotificationPerformLeased(array $job,?callable $testTransport=null,?string $now=null): string
{
    $now??=genesisNow();$db=genesisDb();$delivery=null;
    $owns=static function()use($db,$job):bool{$q=$db->prepare('SELECT state,lease_token FROM background_jobs WHERE id=?');$q->execute([$job['id']]);$row=$q->fetch();$q->closeCursor();return $row&&$row['state']==='running'&&$row['lease_token']===$job['lease_token'];};
    genesisBeginWriteTransaction($db);
    try {
        if(!$owns()){$db->commit();return 'superseded';}
        $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
        $delivery=genesisAdviceNotificationDelivery($payload['deliveryId']??'');
        $advice=$delivery&&in_array($delivery['state'],['pending','sending'],true)?genesisAdviceNotificationCurrent($delivery,$now):null;
        if(!$advice) {
            if($delivery&&$delivery['state']!=='sent')$db->prepare("UPDATE advice_notification_deliveries SET state='cancelled',updated_at=? WHERE id=?")->execute([$now,$delivery['id']]);
            $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?")->execute([$now,$job['id']]);$db->commit();return 'cancelled';
        }
        if($testTransport===null&&!genesisPushConfiguration()['available'])throw new RuntimeException('PUSH_RUNTIME_UNAVAILABLE');
        $db->prepare("UPDATE advice_notification_deliveries SET state='sending',updated_at=? WHERE id=?")->execute([$now,$delivery['id']]);
        $subscription=json_decode(genesisSharedContentDecrypt($delivery['encrypted_subscription']),true,16,JSON_THROW_ON_ERROR);
        $message=['channel'=>'advice','deliveryId'=>$delivery['id']];
        $db->commit();$failure=null;$result=null;
        try{$result=$testTransport!==null?$testTransport($subscription,$message):genesisPushSend($subscription,$message);}catch(Throwable $e){$failure=$e;}
        genesisBeginWriteTransaction($db);
        if(!$owns()){$db->commit();return 'superseded';}
        if($failure!==null)throw $failure;
        if($result==='expired') {
            $db->prepare('DELETE FROM advice_notification_devices WHERE id=? AND user_id=?')->execute([$delivery['device_id'],$delivery['user_id']]);
            $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?")->execute([$now,$job['id']]);$db->commit();return 'cancelled';
        }
        if($result!=='accepted')throw new RuntimeException('PUSH_RETRY');
        $db->prepare("UPDATE advice_notification_deliveries SET state='sent',sent_at=?,error_code=NULL,updated_at=? WHERE id=? AND state='sending'")->execute([$now,$now,$delivery['id']]);
        $db->prepare("UPDATE background_jobs SET state='succeeded',lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=?")->execute([$now,$job['id']]);$db->commit();return 'succeeded';
    } catch(Throwable $e) {
        if($db->inTransaction())$db->rollBack();genesisBeginWriteTransaction($db);
        try {
            if(!$owns()){$db->commit();return 'superseded';}
            $state=(int)$job['attempts']>=5||$e->getMessage()==='PUSH_REJECTED'?'failed':'pending';
            $code=in_array($e->getMessage(),['PUSH_RETRY','PUSH_REJECTED','PUSH_CRYPTO_FAILED','PUSH_RUNTIME_UNAVAILABLE'],true)?$e->getMessage():'ADVICE_NOTIFICATION_RETRY';
            $retry=gmdate('Y-m-d\TH:i:s\Z',strtotime($now)+min(3600,30*(2**min(7,(int)$job['attempts']))));
            $db->prepare('UPDATE background_jobs SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=? WHERE id=?')->execute([$state,$retry,$code,$now,$job['id']]);
            if($delivery)$db->prepare("UPDATE advice_notification_deliveries SET state=?,error_code=?,updated_at=? WHERE id=? AND state<>'sent'")->execute([$state==='failed'?'failed':'pending',$code,$now,$delivery['id']]);
            $db->commit();return $state;
        }catch(Throwable $failure){if($db->inTransaction())$db->rollBack();throw $failure;}
    }
}

function genesisAdviceNotificationJobFailed(array $job,string $code): void
{
    $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
    genesisDb()->prepare("UPDATE advice_notification_deliveries SET state='failed',error_code=?,updated_at=? WHERE id=? AND state<>'sent'")->execute([$code,genesisNow(),$payload['deliveryId']??'']);
}
