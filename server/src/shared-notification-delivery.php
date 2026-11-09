<?php
declare(strict_types=1);

function genesisNotificationCopy(string $key,string $language): string
{
    static$copy;if($copy===null){$path=dirname(__DIR__).'/resources/shared-notification-copy.json';$copy=is_file($path)?json_decode(file_get_contents($path),true,16,JSON_THROW_ON_ERROR):[];}
    return$copy[$language][$key]??$copy['ru'][$key]??$key;
}

/** Bounded, resumable scan. Watch and assignee audiences are deduplicated before scheduling. */
function genesisNotificationScan(int $limit=200,?string $now=null): int
{
    $db=genesisDb();$now??=genesisNow();$limit=max(1,min(1000,$limit));genesisBeginWriteTransaction($db);
    try{
        $cursor=$db->query('SELECT task_cursor,user_cursor FROM shared_notification_scan_state WHERE id=1')->fetch();
        $q=$db->prepare("SELECT t.id,t.project_id,c.user_id FROM (SELECT task_id,user_id FROM shared_task_watchers WHERE watching=1 UNION SELECT id,assignee_id FROM shared_tasks WHERE assignee_id IS NOT NULL UNION SELECT st.id,st.created_by FROM shared_tasks st WHERE st.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shared_task_watchers w WHERE w.task_id=st.id AND w.user_id=st.created_by AND w.watching=0)) c
            JOIN shared_tasks_read t ON t.id=c.task_id AND t.completed_at IS NULL AND t.due_date IS NOT NULL
            JOIN shared_projects p ON p.id=t.project_id AND p.archived_at IS NULL
            JOIN shared_project_members pm ON pm.project_id=p.id AND pm.user_id=c.user_id
            JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=c.user_id
            JOIN users u ON u.id=c.user_id AND u.shared_projects_enabled=1
            LEFT JOIN shared_notification_task_state ns ON ns.task_id=t.id
            WHERE (COALESCE(ns.imported,0)=0 OR EXISTS(SELECT 1 FROM shared_task_watchers w WHERE w.task_id=t.id AND w.user_id=c.user_id AND w.watching=1))
            AND (t.id>? OR (t.id=? AND c.user_id>?)) ORDER BY t.id,c.user_id LIMIT ".$limit);
        $q->execute([$cursor['task_cursor'],$cursor['task_cursor'],$cursor['user_cursor']]);$pairs=$q->fetchAll();$q->closeCursor();$count=0;
        foreach($pairs as$pair){
            if(!genesisNotificationEligible($pair['user_id'],$pair['project_id']))continue;
            $task=genesisNotificationTask($pair['id']);if(!$task)continue;$settings=genesisNotificationPreferences($pair['user_id'])['settings'];
            $local=(new DateTimeImmutable($now))->setTimezone(new DateTimeZone($settings['timeZone']));$today=$local->format('Y-m-d');
            $kind=$task['due_date']<$today?'overdue':($task['due_date']<=$local->modify('+'.$settings['reminderDays'].' days')->format('Y-m-d')?'dueSoon':null);
            if($kind===null||empty($settings['types'][$kind]))continue;
            $q=$db->prepare('SELECT due_date,due_version FROM shared_notification_task_state WHERE task_id=?');$q->execute([$task['id']]);$state=$q->fetch();$q->closeCursor();
            $version=(int)($state['due_version']??1)+($state&&$state['due_date']!==$task['due_date']?1:0);
            $db->prepare('INSERT INTO shared_notification_task_state(task_id,due_date,due_version) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET due_date=excluded.due_date,due_version=excluded.due_version')->execute([$task['id'],$task['due_date'],$version]);
            $db->prepare('INSERT OR IGNORE INTO shared_notification_receipts(task_id,user_id,kind,version,created_at) VALUES(?,?,?,?,?)')->execute([$task['id'],$pair['user_id'],$kind,$version,$now]);
            if(!$db->query('SELECT changes()')->fetchColumn())continue;
            $eventId=genesisSharedAudit($task['project_id'],$task['created_by']?:$pair['user_id'],$kind==='overdue'?'task.overdue':'task.due_soon',$task['id']);
            genesisNotificationRecipient($eventId,$pair['user_id'],$kind,$task,$version);
            $db->prepare('UPDATE shared_notification_receipts SET event_id=? WHERE task_id=? AND user_id=? AND kind=? AND version=?')->execute([$eventId,$task['id'],$pair['user_id'],$kind,$version]);$count++;
        }
        $last=count($pairs)===$limit?end($pairs):null;$db->prepare('UPDATE shared_notification_scan_state SET task_cursor=?,user_cursor=? WHERE id=1')->execute([$last['id']??'',$last['user_id']??'']);
        $db->commit();return$count;
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}

function genesisNotificationDeliveryItems(array $delivery): array
{
    $sql=genesisNotificationInboxSql($delivery['user_id'],null,true,false,$delivery['channel']);
    $q=genesisDb()->prepare('SELECT COUNT(*) AS count,MAX(e.id) AS anyEvent'.$sql['from'].$sql['where'].' AND EXISTS(SELECT 1 FROM shared_notification_delivery_items di WHERE di.delivery_id=:delivery AND di.event_id=e.id AND di.user_id=:user)');
    $q->execute($sql['values']+['delivery'=>$delivery['id']]);$result=$q->fetch();$q->closeCursor();return['count'=>(int)$result['count'],'eventId'=>$result['anyEvent']];
}

function genesisNotificationDeliveryMessage(array $delivery,int $count): array
{
    $user=genesisFindUser($delivery['user_id']);$settings=genesisNotificationPreferences($delivery['user_id'])['settings'];$language=$user['language']??'ru';
    return['deliveryId'=>$delivery['id'],'title'=>'GENESIS','body'=>genesisNotificationCopy('Есть новые уведомления в общих делах GENESIS.',$language),
        'url'=>rtrim(genesisConfig()['app_url'],'/').'/?notice='.rawurlencode($delivery['id']).'#projects','lang'=>$language,'count'=>$count,
        'context'=>['timeZone'=>$settings['timeZone'],'calendarMode'=>$user['calendar_mode']??'profane','gregorianYearStart'=>$user['gregorian_year_start']??'january']];
}

/** Fetch before displaying a push and once more when opening its link. No private titles in payloads. */
function genesisNotificationDeliveryAccess(string $userId,string $deliveryId): array
{
    genesisSharedRequireEnabled($userId);$q=genesisDb()->prepare('SELECT * FROM shared_notification_outbox WHERE id=? AND user_id=?');$q->execute([$deliveryId,$userId]);$delivery=$q->fetch();$q->closeCursor();
    if(!$delivery||!in_array($delivery['state'],['pending','accepted'],true))throw new GenesisSharedAccessException();
    $settings=genesisNotificationPreferences($userId)['settings'];if(!$settings['channels'][$delivery['channel']])throw new GenesisSharedAccessException();
    $items=genesisNotificationDeliveryItems($delivery);if(!$items['count'])throw new GenesisSharedAccessException();
    // Destination is resolved under the same live membership and type checks, even with inbox disabled.
    $sql=genesisNotificationInboxSql($userId,null,true,false,$delivery['channel']);$q=genesisDb()->prepare('SELECT p.space_id AS spaceId,p.id AS projectId,t.id AS taskId,c.id AS commentId'.$sql['from'].$sql['where'].' AND e.id=:event');$q->execute($sql['values']+['event'=>$items['eventId']]);$destination=$q->fetch();$q->closeCursor();
    if(!$destination)throw new GenesisSharedAccessException();if(!$destination['taskId'])unset($destination['taskId']);if($destination['commentId'])$destination['taskAction']='comments';else unset($destination['commentId']);
    return['message'=>genesisNotificationDeliveryMessage($delivery,$items['count']),'destination'=>$destination,'displayAllowed'=>genesisNotificationQuietUntil($settings)===null];
}

/** Called under the existing job lease and transaction; injected transports are confined to PHP tests. */
function genesisNotificationDeliver(array $payload,?callable $transport=null,?string $now=null,bool $requireConfigured=false): string
{
    $db=genesisDb();$now??=genesisNow();$q=$db->prepare('SELECT * FROM shared_notification_outbox WHERE id=?');$q->execute([$payload['deliveryId']??'']);$delivery=$q->fetch();$q->closeCursor();
    if(!$delivery||$delivery['state']!=='pending')return'cancelled';$user=genesisFindUser($delivery['user_id']);$settings=genesisNotificationPreferences($delivery['user_id'])['settings'];
    $cancel=static function(string $state='cancelled',?string $code=null)use($db,$delivery,$now):string{$db->prepare('UPDATE shared_notification_outbox SET state=?,error_code=?,updated_at=? WHERE id=?')->execute([$state,$code,$now,$delivery['id']]);return'cancelled';};
    if(!$user||empty($user['shared_projects_enabled'])||!genesisSharedEligible($user)||!$settings['channels'][$delivery['channel']])return$cancel();
    $items=genesisNotificationDeliveryItems($delivery);if(!$items['count'])return$cancel();
    $until=genesisNotificationQuietUntil($settings,$now);if($until!==null){$db->prepare('UPDATE shared_notification_outbox SET available_at=?,updated_at=? WHERE id=?')->execute([$until,$now,$delivery['id']]);return'deferred';}
    $capabilities=genesisNotificationCapabilities();if(($transport===null||$requireConfigured)&&!$capabilities[$delivery['channel']]['available'])return$cancel('failed',$capabilities[$delivery['channel']]['blocker']);
    $target=null;
    if($delivery['channel']==='push'){
        $q=$db->prepare('SELECT payload FROM shared_push_subscriptions WHERE id=? AND user_id=?');$q->execute([$delivery['target_id'],$delivery['user_id']]);$encrypted=$q->fetchColumn();$q->closeCursor();if($encrypted===false)return$cancel();$target=json_decode(genesisSharedContentDecrypt($encrypted),true,16,JSON_THROW_ON_ERROR);
    }else{if(!filter_var($user['email'],FILTER_VALIDATE_EMAIL))return$cancel('failed','EMAIL_ADDRESS_UNAVAILABLE');$target=$user['email'];}
    $message=genesisNotificationDeliveryMessage($delivery,$items['count']);
    try{
        $result=$transport!==null?$transport($delivery['channel'],$target,$message):genesisNotificationSend($delivery['channel'],$target,$message);
    }catch(Throwable$e){if($e->getMessage()==='PUSH_REJECTED')return$cancel('failed','PUSH_REJECTED');throw$e;}
    if($result==='expired'){$db->prepare('DELETE FROM shared_push_subscriptions WHERE id=? AND user_id=?')->execute([$delivery['target_id'],$delivery['user_id']]);return$cancel('cancelled','PUSH_SUBSCRIPTION_EXPIRED');}
    if($result!=='accepted')throw new RuntimeException('NOTIFICATION_RETRY');
    $db->prepare("UPDATE shared_notification_outbox SET state='accepted',error_code=NULL,updated_at=? WHERE id=?")->execute([$now,$delivery['id']]);return'succeeded';
}

function genesisNotificationSend(string $channel,mixed $target,array $message): string
{
    if($channel==='push')return genesisPushSend($target,['deliveryId'=>$message['deliveryId']]);
    $text=genesisNotificationCopy('Откройте GENESIS, чтобы посмотреть обновления.',$message['lang']);
    $footer=genesisNotificationCopy('Настройки писем доступны в личном кабинете GENESIS.',$message['lang']);
    return genesisEmailSend($target,'GENESIS — '.$message['body'],$text."\n\n".$message['url']."\n\n".$footer,$message['deliveryId'],
        genesisEmailHtml($message['body'],$text,$message['url'],genesisNotificationCopy('Открыть GENESIS',$message['lang']),$footer));
}

/** Network waits never hold SQLite's writer. A fresh lease gates the result/ack transaction. */
function genesisNotificationPerformLeased(array $job,?callable $testTransport=null): string
{
    $db=genesisDb();$owns=static function()use($db,$job):bool{$q=$db->prepare('SELECT state,lease_token FROM background_jobs WHERE id=?');$q->execute([$job['id']]);$row=$q->fetch();$q->closeCursor();return$row&&$row['state']==='running'&&$row['lease_token']===$job['lease_token'];};
    genesisBeginWriteTransaction($db);
    try{
        if(!$owns()){$db->commit();return'superseded';}
        $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
        $network=static function($channel,$target,$message)use($db,$owns,$testTransport):string{
            $db->commit();$failure=null;$result=null;
            try{$result=$testTransport!==null?$testTransport($channel,$target,$message):genesisNotificationSend($channel,$target,$message);}catch(Throwable$e){$failure=$e;}
            genesisBeginWriteTransaction($db);if(!$owns())throw new RuntimeException('NOTIFICATION_LEASE_SUPERSEDED');if($failure!==null)throw$failure;return$result;
        };
        $state=genesisNotificationDeliver($payload,$network,null,$testTransport===null);
        if($state==='deferred'){
            $q=$db->prepare('SELECT available_at FROM shared_notification_outbox WHERE id=?');$q->execute([$payload['deliveryId']]);$available=$q->fetchColumn();$q->closeCursor();
            $db->prepare("UPDATE background_jobs SET state='pending',attempts=MAX(0,attempts-1),available_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE id=?")->execute([$available,genesisNow(),$job['id']]);$db->commit();return'pending';
        }
        $state=$state==='cancelled'?'cancelled':'succeeded';$db->prepare('UPDATE background_jobs SET state=?,lease_until=NULL,lease_token=NULL,error_code=NULL,updated_at=? WHERE id=?')->execute([$state,genesisNow(),$job['id']]);$db->commit();return$state;
    }catch(Throwable$e){
        if($db->inTransaction())$db->rollBack();genesisBeginWriteTransaction($db);
        try{
            if(!$owns()){$db->commit();return'superseded';}$state=(int)$job['attempts']>=5?'failed':'pending';$code=in_array($e->getMessage(),['PUSH_RETRY','EMAIL_RETRY','PUSH_CRYPTO_FAILED'],true)?$e->getMessage():'NOTIFICATION_RETRY';
            $available=gmdate('Y-m-d\TH:i:s\Z',time()+min(3600,30*(2**min(7,(int)$job['attempts']))));
            $db->prepare('UPDATE background_jobs SET state=?,available_at=?,lease_until=NULL,lease_token=NULL,error_code=?,updated_at=? WHERE id=?')->execute([$state,$available,$code,genesisNow(),$job['id']]);
            if($state==='failed')genesisNotificationJobFailed($job,$code);$db->commit();return$state;
        }catch(Throwable$failure){if($db->inTransaction())$db->rollBack();throw$failure;}
    }
}

function genesisNotificationJobFailed(array $job,string $code): void
{
    $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,16,JSON_THROW_ON_ERROR);
    genesisDb()->prepare("UPDATE shared_notification_outbox SET state='failed',error_code=?,updated_at=? WHERE id=? AND state='pending'")->execute([$code,genesisNow(),$payload['deliveryId']??'']);
}

function genesisNotificationRetry(string $userId,?array $testCapabilities=null): array
{
    if(!genesisFindUser($userId))throw new GenesisSharedAccessException();$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare("SELECT id FROM shared_notification_outbox WHERE user_id=? AND state='failed' ORDER BY created_at,id LIMIT 20");$q->execute([$userId]);$ids=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();$resumed=0;$settings=genesisNotificationPreferences($userId)['settings'];$capabilities=$testCapabilities??genesisNotificationCapabilities();
        foreach($ids as$id){
            $q=$db->prepare('SELECT * FROM shared_notification_outbox WHERE id=? AND user_id=?');$q->execute([$id,$userId]);$delivery=$q->fetch();$q->closeCursor();
            if(!$settings['channels'][$delivery['channel']]||!$capabilities[$delivery['channel']]['available']||!genesisNotificationDeliveryItems($delivery)['count'])continue;
            $available=genesisNotificationScheduleAt($settings);$db->prepare("UPDATE shared_notification_outbox SET state='pending',error_code=NULL,available_at=?,updated_at=? WHERE id=?")->execute([$available,genesisNow(),$id]);
            $db->prepare("UPDATE background_jobs SET state='pending',attempts=0,error_code=NULL,available_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE unique_key=? AND state IN ('failed','succeeded','cancelled')")->execute([$available,genesisNow(),'notification:'.$id]);$resumed++;
        }
        if($capabilities['email']['available']){
            $q=$db->prepare("SELECT * FROM account_email_outbox WHERE user_id=? AND state='failed' ORDER BY created_at,id LIMIT 20");$q->execute([$userId]);$jobs=$q->fetchAll();$q->closeCursor();
            foreach($jobs as$job)if(genesisAccountEmailMessage($job)!==null){
                $available=$job['kind']==='registration'?genesisNow():genesisNotificationScheduleAt($settings);
                $db->prepare("UPDATE account_email_outbox SET state='pending',attempts=0,error_code=NULL,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE id=? AND user_id=? AND state='failed'")->execute([$available,genesisNow(),$job['id'],$userId]);$resumed++;
            }
        }
        $db->commit();return['resumed'=>$resumed];
    }catch(Throwable$e){if($db->inTransaction())$db->rollBack();throw$e;}
}
