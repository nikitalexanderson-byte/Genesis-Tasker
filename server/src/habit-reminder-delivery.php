<?php
declare(strict_types=1);

function genesisHabitReminderDelivery(string $id,?string $userId=null): ?array
{
    $q=genesisDb()->prepare('SELECT * FROM habit_reminder_deliveries WHERE id=?'.($userId===null?'':' AND user_id=?'));
    $q->execute($userId===null?[$id]:[$id,$userId]);$row=$q->fetch();$q->closeCursor();return $row?:null;
}

function genesisHabitReminderDevice(string $id): ?array
{
    $q=genesisDb()->prepare('SELECT * FROM habit_reminder_devices WHERE id=? AND enabled=1');
    $q->execute([$id]);$row=$q->fetch();$q->closeCursor();return $row?:null;
}

/** Recheck the current projection after every lease, and again before the browser shows a push. */
function genesisHabitReminderCurrent(array $delivery,string $now): ?array
{
    $device=genesisHabitReminderDevice($delivery['device_id']);$profile=genesisHabitReminderProfile($delivery['user_id']);
    if(!$device||!$profile||$profile['needs_refresh']||!$profile['encrypted_plan']||strtotime($profile['expires_at'])<=strtotime($now)
        ||strtotime($delivery['expires_at'])<=strtotime($now))return null;
    $plan=json_decode(genesisSharedContentDecrypt($profile['encrypted_plan']),true,32,JSON_THROW_ON_ERROR);
    $target=json_decode(genesisSharedContentDecrypt($delivery['encrypted_target']),true,16,JSON_THROW_ON_ERROR);
    $found=false;
    foreach($plan['rows'] as $row) if($row['id']===$target['id'] && ($row['ruleId']??null)===($target['ruleId']??null)
        && ($row['intervalTime']??null)===($target['intervalTime']??null) && ($row['action']??null)===($target['action']??null)){$found=true;break;}
    if(!$found)return null;
    $instant=new DateTimeImmutable($now);
    if(!$target['allowDuringQuietHours']&&genesisHabitReminderQuiet($instant,$device['time_zone'],$plan['quietHoursStart'],$plan['quietHoursEnd']))return null;
    return ['device'=>$device,'plan'=>$plan,'target'=>$target];
}

function genesisHabitReminderMessage(array $delivery,array $context): array
{
    $user=genesisFindUser($delivery['user_id']);$language=$user['language']??'ru';$target=$context['target'];$tone=$context['plan']['tone'];
    $copy=$target['kind']==='goal' ? match($tone){
        'heroic'=>'Каждый шаг приближает к дневной цели. Откройте привычки и продолжайте!',
        'ironic'=>'Дневная цель сама себя не выполнит. Заглянем в привычки?',
        default=>'Пора проверить дневную цель. Откройте привычки, когда будет удобно.',
    } : match($tone){
        'heroic'=>'Время действовать! Сделайте следующий шаг к своей привычке.',
        'ironic'=>'Привычка ждёт. Обещаем: начинать обычно сложнее, чем продолжать.',
        default=>'Время для привычки. Откройте GENESIS, чтобы отметить результат.',
    };
    return ['deliveryId'=>$delivery['id'],'title'=>'GENESIS','body'=>genesisNotificationCopy($copy,$language),'lang'=>$language,
        'url'=>rtrim(genesisConfig()['app_url'],'/').'/?habitNotice='.rawurlencode($delivery['id']).'#habits',
        'primaryLabel'=>genesisNotificationCopy(($target['action']??'input')==='complete'||($target['action']??'')==='interval'?'Выполнено':'Добавить значение',$language),
        'snoozeLabel'=>genesisNotificationCopy('Отложить',$language),'kind'=>$target['kind']];
}

function genesisHabitReminderAccess(string $userId,string $id,?string $now=null): array
{
    $now??=genesisNow();$delivery=genesisHabitReminderDelivery($id,$userId);
    if(!$delivery||!in_array($delivery['state'],['sending','sent'],true)||!genesisHabitReminderDevice($delivery['device_id']))
        throw new DomainException('HABIT_REMINDER_UNAVAILABLE');
    $context=genesisHabitReminderCurrent($delivery,$now);
    $target=json_decode(genesisSharedContentDecrypt($delivery['encrypted_target']),true,16,JSON_THROW_ON_ERROR);
    $profile=genesisHabitReminderProfile($userId);
    $plan=$profile&&$profile['encrypted_plan']?json_decode(genesisSharedContentDecrypt($profile['encrypted_plan']),true,32,JSON_THROW_ON_ERROR):['tone'=>'calm'];
    return ['displayAllowed'=>$context!==null,'message'=>genesisHabitReminderMessage($delivery,$context??['target'=>$target,'plan'=>$plan]),
        'target'=>$target,'userId'=>$userId,'deviceId'=>$delivery['device_id'],'receiptKey'=>$delivery['event_key']];
}

/** Idempotent snooze retains the original practice date, rule and occurrence, with its own receipt. */
function genesisHabitReminderSnooze(string $userId,string $id,?string $now=null): array
{
    $now??=genesisNow();$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $parent=genesisHabitReminderDelivery($id,$userId);
        if(!$parent||!in_array($parent['state'],['sending','sent'],true)||!($context=genesisHabitReminderCurrent($parent,$now))||$context['target']['kind']!=='habit')
            throw new DomainException('HABIT_REMINDER_SNOOZE_UNAVAILABLE');
        $device=$context['device'];$target=$context['target'];$plan=$context['plan'];
        $key=hash('sha256','snooze:'.$id);
        $q=$db->prepare('SELECT id,scheduled_at FROM habit_reminder_deliveries WHERE device_id=? AND event_key=?');$q->execute([$device['id'],$key]);$existing=$q->fetch();$q->closeCursor();
        if($existing){$db->commit();return ['ok'=>true,'deliveryId'=>$existing['id'],'scheduledAt'=>$existing['scheduled_at']];}
        $at=(new DateTimeImmutable($now))->modify('+'.$device['snooze_minutes'].' minutes');
        $end=(new DateTimeImmutable($target['date'].' 00:00',new DateTimeZone($target['timeZone'])))->modify('+1 day');
        $expiry=min($end->getTimestamp(),strtotime($plan['expiresAt']),$at->getTimestamp()+7200);
        if($at->getTimestamp()>=$expiry||(!$target['allowDuringQuietHours']&&genesisHabitReminderQuiet($at,$device['time_zone'],$plan['quietHoursStart'],$plan['quietHoursEnd']))
            ||!genesisHabitReminderBudget($device,$at->format('Y-m-d\TH:i:s\Z')))
            throw new DomainException('HABIT_REMINDER_SNOOZE_UNAVAILABLE');
        $child=genesisUuid();$scheduled=$at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        $db->prepare('INSERT INTO habit_reminder_deliveries(id,user_id,device_id,profile_revision,event_key,encrypted_target,scheduled_at,expires_at,snooze_of,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$child,$userId,$device['id'],$parent['profile_revision'],$key,$parent['encrypted_target'],$scheduled,gmdate('Y-m-d\TH:i:s\Z',$expiry),$id,$now,$now]);
        genesisBackgroundEnqueue('habit-notification','habit-notification:'.$child,['deliveryId'=>$child],$scheduled);
        $db->commit();return ['ok'=>true,'deliveryId'=>$child,'scheduledAt'=>$scheduled];
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** Reservations count across concurrent workers, retries and ambiguous transport timeouts. */
function genesisHabitReminderBudget(array $device,string $now,?string $exclude=null): bool
{
    $local=(new DateTimeImmutable($now))->setTimezone(new DateTimeZone($device['time_zone']));$start=$local->setTime(0,0);$end=$start->modify('+1 day');
    $q=genesisDb()->prepare("SELECT COUNT(*) FROM habit_reminder_deliveries WHERE device_id=? AND reserved_at>=? AND reserved_at<? AND state<>'cancelled' AND id<>?");
    $q->execute([$device['id'],$start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z'),$end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z'),$exclude??'']);
    $count=(int)$q->fetchColumn();$q->closeCursor();return $count<(int)$device['max_per_day'];
}

/** Push network calls run without a SQLite writer; stale leases cannot acknowledge a result. */
function genesisHabitReminderPerformLeased(array $job,?callable $testTransport=null,?string $now=null): string
{
    $now??=genesisNow();$db=genesisDb();$delivery=null;
    $owns=static function()use($db,$job):bool{$q=$db->prepare('SELECT state,lease_token FROM background_jobs WHERE id=?');$q->execute([$job['id']]);$row=$q->fetch();$q->closeCursor();return $row&&$row['state']==='running'&&$row['lease_token']===$job['lease_token'];};
    genesisBeginWriteTransaction($db);
    try{
        if(!$owns()){$db->commit();return 'superseded';}
        $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
        $delivery=genesisHabitReminderDelivery($payload['deliveryId']??'');
        $context=$delivery&&in_array($delivery['state'],['pending','sending'],true)?genesisHabitReminderCurrent($delivery,$now):null;
        if(!$context||strtotime($delivery['scheduled_at'])>strtotime($now)||!genesisHabitReminderBudget($context['device'],$now,$delivery['id'])){
            if($delivery&&$delivery['state']!=='sent')$db->prepare("UPDATE habit_reminder_deliveries SET state='cancelled',updated_at=? WHERE id=?")->execute([$now,$delivery['id']]);
            $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?")->execute([$now,$job['id']]);$db->commit();return 'cancelled';
        }
        if($testTransport===null&&!genesisPushConfiguration()['available'])throw new RuntimeException('PUSH_RUNTIME_UNAVAILABLE');
        $db->prepare("UPDATE habit_reminder_deliveries SET state='sending',reserved_at=COALESCE(reserved_at,?),updated_at=? WHERE id=?")->execute([$now,$now,$delivery['id']]);
        $subscription=json_decode(genesisSharedContentDecrypt($context['device']['encrypted_subscription']),true,16,JSON_THROW_ON_ERROR);
        $message=['channel'=>'habit','deliveryId'=>$delivery['id']];
        $db->commit();$failure=null;$result=null;
        try{$result=$testTransport!==null?$testTransport($subscription,$message):genesisPushSend($subscription,$message);}catch(Throwable $e){$failure=$e;}
        genesisBeginWriteTransaction($db);
        if(!$owns()){$db->commit();return 'superseded';}
        if($failure!==null)throw $failure;
        if($result==='expired'){
            genesisHabitReminderCancelDeliveries($delivery['user_id'],$delivery['device_id']);
            $db->prepare('UPDATE habit_reminder_devices SET enabled=0,encrypted_subscription=NULL,revision=revision+1,updated_at=? WHERE id=?')->execute([$now,$delivery['device_id']]);
            $db->commit();return 'cancelled';
        }
        if($result!=='accepted')throw new RuntimeException('PUSH_RETRY');
        $db->prepare("UPDATE habit_reminder_deliveries SET state='sent',sent_at=?,error_code=NULL,updated_at=? WHERE id=? AND state='sending'")->execute([$now,$now,$delivery['id']]);
        $db->prepare("UPDATE background_jobs SET state='succeeded',lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=?")->execute([$now,$job['id']]);
        $db->commit();return 'succeeded';
    }catch(Throwable $e){
        if($db->inTransaction())$db->rollBack();genesisBeginWriteTransaction($db);
        try{
            if(!$owns()){$db->commit();return 'superseded';}
            $state=(int)$job['attempts']>=5||$e->getMessage()==='PUSH_REJECTED'?'failed':'pending';
            $code=in_array($e->getMessage(),['PUSH_RETRY','PUSH_REJECTED','PUSH_CRYPTO_FAILED','PUSH_RUNTIME_UNAVAILABLE'],true)?$e->getMessage():'HABIT_REMINDER_RETRY';
            $retry=gmdate('Y-m-d\TH:i:s\Z',strtotime($now)+min(3600,30*(2**min(7,(int)$job['attempts']))));
            $db->prepare('UPDATE background_jobs SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=? WHERE id=?')->execute([$state,$retry,$code,$now,$job['id']]);
            if($delivery)$db->prepare("UPDATE habit_reminder_deliveries SET state=?,error_code=?,updated_at=? WHERE id=? AND state='sending'")->execute([$state,$code,$now,$delivery['id']]);
            $db->commit();return $state;
        }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    }
}

function genesisHabitReminderJobFailed(array $job,string $code): void
{
    $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
    genesisDb()->prepare("UPDATE habit_reminder_deliveries SET state='failed',error_code=?,updated_at=? WHERE id=? AND state IN ('pending','sending')")->execute([$code,genesisNow(),$payload['deliveryId']??'']);
}
