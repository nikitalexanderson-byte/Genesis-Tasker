<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-policy.php';
require_once __DIR__.'/shared-content-storage.php';

/** Invalid private job data needs investigation, not a legacy-content fallback. */
final class GenesisE2eeJobReviewRequired extends RuntimeException {}

function genesisE2eeBackgroundPayload(string $encrypted): array
{
    // A missing/misconfigured server key is an infrastructure failure. Do not
    // quarantine otherwise valid work because the worker cannot open any job.
    $key=base64_decode((string)genesisConfig()['crypto_key'],true);
    if(!is_string($key)||strlen($key)!==SODIUM_CRYPTO_SECRETBOX_KEYBYTES)throw new RuntimeException('Invalid encryption key.');
    try {
        $payload=json_decode(genesisSharedContentDecrypt($encrypted),true,32,JSON_THROW_ON_ERROR);
    }catch(JsonException|SodiumException $error) {
        throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED',0,$error);
    }catch(RuntimeException $error) {
        if($error->getMessage()!=='Shared content authentication failed.')throw $error;
        throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED',0,$error);
    }
    if(!is_array($payload))throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED');
    return $payload;
}

/** Read-only resolution of existing legacy jobs. No E2EE key/decrypt API exists.
 * Pending work is retained for migration/reconciliation, never called succeeded. */
function genesisE2eeBackgroundBlocked(array $job): bool
{
    $kind=$job['kind'];
    if(!in_array($kind,['shared-series','shared-automation','shared-bulk','shared-notification','habit-notification','advice-notification'],true))return false;
    $payload=genesisE2eeBackgroundPayload($job['payload']);$db=genesisDb();$scope='project';
    switch($kind) {
        case 'shared-series':$sql='SELECT project_id FROM shared_task_series WHERE id=?';$id=$payload['seriesId']??'';break;
        case 'shared-automation':$sql='SELECT r.project_id FROM shared_automation_runs run JOIN shared_automation_rules r ON r.id=run.rule_id WHERE run.id=?';$id=$payload['runId']??'';break;
        case 'shared-bulk':$sql='SELECT DISTINCT project_id FROM shared_bulk_items WHERE operation_id=?';$id=$payload['operationId']??'';break;
        case 'shared-notification':$sql='SELECT DISTINCT e.project_id FROM shared_notification_delivery_items i JOIN shared_audit_events e ON e.id=i.event_id WHERE i.delivery_id=?';$id=$payload['deliveryId']??'';break;
        case 'habit-notification':$sql='SELECT user_id FROM habit_reminder_deliveries WHERE id=?';$id=$payload['deliveryId']??'';$scope='personal';break;
        default:$sql='SELECT user_id FROM advice_notification_deliveries WHERE id=?';$id=$payload['deliveryId']??'';$scope='personal';break;
    }
    if(!is_string($id)||$id===''||strlen($id)>512)throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED');
    $q=$db->prepare($sql);$q->execute([$id]);$resources=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
    // A bulk move may target a different scope from every captured source item.
    if($kind==='shared-bulk') {
        $q=$db->prepare('SELECT payload FROM shared_bulk_operations WHERE id=?');$q->execute([$id]);$definition=$q->fetchColumn();$q->closeCursor();
        if($definition!==false) {
            $definition=genesisE2eeBackgroundPayload($definition);
            if(($definition['action']['kind']??null)==='move')$resources[]=$definition['action']['projectId']??null;
        }
    }
    if(!$resources)throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED');
    foreach($resources as $resource)if(!is_string($resource)||$resource==='')throw new GenesisE2eeJobReviewRequired('E2EE_JOB_REVIEW_REQUIRED');
    foreach(array_unique($resources) as $resource)if(genesisE2eeLegacyScopeBlocked($scope,$resource))return true;
    return false;
}

/** Only queue metadata changes. Keep the encrypted payload and all source rows;
 * do not call legacy terminal-failure handlers with an unverified binding. */
function genesisE2eeBackgroundQuarantine(array $job,?string $now=null): void
{
    $db=genesisDb();if(!$db->inTransaction())throw new LogicException('E2EE background quarantine requires writer');
    $db->prepare("UPDATE background_jobs SET state='failed',lease_token=NULL,lease_until=NULL,error_code='E2EE_JOB_REVIEW_REQUIRED',updated_at=? WHERE id=?")
        ->execute([$now??genesisNow(),$job['id']]);
}

/** Caller has the writer and current lease; return a retained queue state. */
function genesisE2eeBackgroundHold(array $job,?string $now=null,bool $refundUnstarted=false): ?string
{
    try {
        if(!genesisE2eeBackgroundBlocked($job))return null;
    }catch(GenesisE2eeJobReviewRequired) {
        genesisE2eeBackgroundQuarantine($job,$now);return 'failed';
    }
    genesisE2eeBackgroundDefer($job,$now,$refundUnstarted);return 'pending';
}
/** Caller owns SQLite's writer and has checked the current job lease. Only job
 * scheduling metadata changes; source/delivery content, receipts and payload stay. */
function genesisE2eeBackgroundDefer(array $job,?string $now=null,bool $refundUnstarted=false): void
{
    $db=genesisDb();if(!$db->inTransaction())throw new LogicException('E2EE background deferral requires writer');
    $now??=genesisNow();$after=max(time(),strtotime($now),strtotime($job['available_at']??$now));
    $db->prepare("UPDATE background_jobs SET state='pending',available_at=?,lease_token=NULL,lease_until=NULL,attempts=MAX(0,attempts-?),error_code='E2EE_CLIENT_REQUIRED',updated_at=? WHERE id=?")
        ->execute([gmdate('Y-m-d\TH:i:s\Z',$after+900),$refundUnstarted?1:0,$now,$job['id']]);
}
