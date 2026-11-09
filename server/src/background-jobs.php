<?php
declare(strict_types=1);
require_once __DIR__.'/billing-settlement.php';

/** Payloads are server-encrypted. No user content appears in job diagnostics. */
function genesisBackgroundEnqueue(string $kind,string $key,array $payload,?string $availableAt=null): void
{
    $now=genesisNow();
    genesisDb()->prepare('INSERT OR IGNORE INTO background_jobs(id,kind,unique_key,payload,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        ->execute([genesisUuid(),$kind,$key,genesisSharedContentEncrypt(json_encode($payload,JSON_THROW_ON_ERROR)),$availableAt??$now,$now,$now]);
}

function genesisBackgroundClaim(?string $now=null,?string $uniqueKey=null): ?array
{
    $db=genesisDb(); $now??=genesisNow(); genesisBeginWriteTransaction($db);
    try {
        $scope=$uniqueKey===null?'':' AND unique_key=?';$keyValues=$uniqueKey===null?[]:[$uniqueKey];
        $q=$db->prepare("SELECT kind,unique_key,payload FROM background_jobs WHERE state='running' AND lease_until<=? AND attempts>=5".$scope);
        $q->execute([$now,...$keyValues]);$expired=$q->fetchAll();$q->closeCursor();
        $db->prepare("UPDATE background_jobs SET state='failed',lease_token=NULL,lease_until=NULL,error_code='BACKGROUND_LEASE_EXPIRED',updated_at=? WHERE state='running' AND lease_until<=? AND attempts>=5".$scope)->execute([$now,$now,...$keyValues]);
        foreach($expired as$ended)if($ended['kind']==='shared-bulk')genesisSharedBulkJobFailed($ended,'BACKGROUND_LEASE_EXPIRED');
        foreach($expired as$ended)if($ended['kind']==='shared-notification')genesisNotificationJobFailed($ended,'BACKGROUND_LEASE_EXPIRED');
        foreach($expired as$ended)if($ended['kind']==='habit-notification')genesisHabitReminderJobFailed($ended,'BACKGROUND_LEASE_EXPIRED');
        foreach($expired as$ended)if($ended['kind']==='advice-notification')genesisAdviceNotificationJobFailed($ended,'BACKGROUND_LEASE_EXPIRED');
        foreach($expired as$ended)if($ended['kind']==='billing-settlement')genesisBillingSettlementJobFailed($ended,'BACKGROUND_LEASE_EXPIRED');
        foreach($expired as$ended)if($ended['kind']==='shared-automation')genesisAutomationJobError($ended,'BACKGROUND_LEASE_EXPIRED',true);
        $q=$db->prepare("SELECT * FROM background_jobs WHERE ((state='pending' AND available_at<=?) OR (state='running' AND lease_until<=?))".$scope." ORDER BY available_at,id LIMIT 1");
        $q->execute([$now,$now,...$keyValues]);$job=$q->fetch();$q->closeCursor();
        if(!$job){$db->commit();return null;}
        $token=genesisUuid();$lease=gmdate('Y-m-d\TH:i:s\Z',strtotime($now)+120);
        $db->prepare("UPDATE background_jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?")->execute([$token,$lease,$now,$job['id']]);
        $db->commit();return array_merge($job,['lease_token'=>$token,'attempts'=>(int)$job['attempts']+1]);
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** A result and its acknowledgement share one transaction; an expired lease is safely retried. */
function genesisBackgroundPerform(array $job,?callable $handler=null): string
{
    if($job['kind']==='shared-notification'&&$handler===null)return genesisNotificationPerformLeased($job);
    if($job['kind']==='habit-notification'&&$handler===null)return genesisHabitReminderPerformLeased($job);
    if($job['kind']==='advice-notification'&&$handler===null)return genesisAdviceNotificationPerformLeased($job);
    if($job['kind']==='billing-settlement'&&$handler===null)return genesisBillingSettlementPerformLeased($job);
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare("SELECT state,lease_token FROM background_jobs WHERE id=?");$q->execute([$job['id']]);$current=$q->fetch();$q->closeCursor();
        if(!$current||$current['state']!=='running'||$current['lease_token']!==$job['lease_token']){$db->commit();return 'superseded';}
        $payload=json_decode(genesisSharedContentDecrypt($job['payload']),true,32,JSON_THROW_ON_ERROR);
        $state=$handler ? $handler($job['kind'],$payload) : match($job['kind']) {
            'shared-series'=>genesisSharedSeriesGenerate($payload),
            'shared-bulk'=>genesisSharedBulkBatch($payload),
            'shared-automation'=>genesisAutomationPerform($payload),
            'shared-notification'=>genesisNotificationDeliver($payload),
            default=>throw new RuntimeException('BACKGROUND_KIND_UNSUPPORTED'),
        };
        if($state==='deferred'&&$job['kind']==='shared-notification'){
            $q=$db->prepare('SELECT available_at FROM shared_notification_outbox WHERE id=?');$q->execute([$payload['deliveryId']]);$available=$q->fetchColumn();$q->closeCursor();
            $db->prepare("UPDATE background_jobs SET state='pending',attempts=MAX(0,attempts-1),available_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE id=?")->execute([$available,genesisNow(),$job['id']]);$db->commit();return'pending';
        }
        $state=$state==='cancelled'?'cancelled':'succeeded';
        $db->prepare('UPDATE background_jobs SET state=?,lease_until=NULL,lease_token=NULL,error_code=NULL,updated_at=? WHERE id=?')
            ->execute([$state,genesisNow(),$job['id']]);
        $db->commit();return $state;
    } catch(Throwable $e) {
        if($db->inTransaction())$db->rollBack();
        $code=in_array($e->getMessage(),['SHARED_PROJECT_NOT_FOUND','SHARED_PROJECT_FORBIDDEN','INVALID_ASSIGNEE','INVALID_TASK_APPROVER','SERIES_SOURCE_UNAVAILABLE','SERIES_INVALID','SERIES_TEMPLATE_UNAVAILABLE','BACKGROUND_KIND_UNSUPPORTED'],true)?$e->getMessage():'BACKGROUND_RETRY';
        $state=(int)$job['attempts']>=5?'failed':'pending';
        $delay=min(3600,30*(2**min(7,(int)$job['attempts'])));
        genesisBeginWriteTransaction($db);
        try{
            $update=$db->prepare("UPDATE background_jobs SET state=?,available_at=?,lease_until=NULL,lease_token=NULL,error_code=?,updated_at=? WHERE id=? AND state='running' AND lease_token=?");
            $update->execute([$state,gmdate('Y-m-d\TH:i:s\Z',time()+$delay),$code,genesisNow(),$job['id'],$job['lease_token']]);
            if(!$update->rowCount()){$db->commit();return 'superseded';}
            if($job['kind']==='shared-series' && isset($payload['seriesId'],$payload['revision'])) $db->prepare('UPDATE shared_task_series SET last_error=? WHERE id=? AND revision=?')->execute([$code,$payload['seriesId'],$payload['revision']]);
            if($job['kind']==='shared-bulk'&&$state==='failed')genesisSharedBulkJobFailed($job,$code);
            if($job['kind']==='shared-notification'&&$state==='failed')genesisNotificationJobFailed($job,$code);
            if($job['kind']==='shared-automation')genesisAutomationJobError($job,$code,$state==='failed');
            $db->commit();return $state;
        }catch(Throwable $failure){if($db->inTransaction())$db->rollBack();throw $failure;}
    }
}

function genesisBackgroundRun(int $limit=20): array
{
    require_once __DIR__.'/billing-yookassa.php';
    genesisBillingYooScan();
    $db=genesisDb();$db->exec("UPDATE background_worker_state SET started_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=1");
    genesisSharedSeriesEnqueue();
    genesisAutomationScan();
    genesisHabitReminderMaintenance();
    genesisAdviceNotificationScan();
    genesisBillingSettlementScan();
    genesisNotificationScan();
    $counts=['succeeded'=>0,'cancelled'=>0,'pending'=>0,'failed'=>0,'superseded'=>0];$deadline=microtime(true)+25;
    for($i=0;$i<max(1,min(50,$limit))&&microtime(true)<$deadline;$i++){
        $job=genesisBackgroundClaim();if(!$job)break;$counts[genesisBackgroundPerform($job)]++;
    }
    $db->prepare('UPDATE background_worker_state SET completed_at=? WHERE id=1')->execute([genesisNow()]);
    return $counts;
}
