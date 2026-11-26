<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-page.php';
require_once __DIR__.'/shared-content-storage.php';

/** All retained owner rows, including disabled devices and expired/failed jobs.
 * No ordinary scheduling/status helper, pruning, acknowledgement or push grant.
 * OLD server-at-rest content is opened only within the signed migration lease;
 * raw JSON remains intact for the client's duplicate-name/schema validation.
 * Push endpoint ciphertext is inert history and is never opened by this read. */
function genesisE2eeLegacyReminders(PDO $db,string $actor,array $scope,array $c):array
{
    $queries=[
        'habitProfiles'=>['habit_reminder_profiles','encrypted_plan,plan_hash,workspace_version,revision,expires_at,needs_refresh,updated_at',['workspace_version','revision','needs_refresh'],'user_id'],
        'habitDevices'=>['habit_reminder_devices','id,device_key,encrypted_subscription,enabled,request_id,request_hash,time_zone,max_per_day,snooze_minutes,revision,created_at,updated_at',['enabled','max_per_day','snooze_minutes','revision'],'id'],
        'habitDeliveries'=>['habit_reminder_deliveries','id,device_id,profile_revision,event_key,encrypted_target,scheduled_at,expires_at,state,sent_at,reserved_at,snooze_of,error_code,created_at,updated_at',['profile_revision'],'id'],
        'adviceDays'=>['advice_notification_days','day_key,advice_id,collection,scheduled_time,time_zone,expires_at,created_at',[],'day_key'],
        'adviceDeliveries'=>['advice_notification_deliveries','id,device_id,day_key,state,sent_at,error_code,created_at,updated_at',[],'id'],
        'sharedPreferences'=>['shared_notification_preferences','settings_json,revision,updated_at',['revision'],'user_id'],
    ];
    [$result]=genesisE2eeLegacyPersonalPage($db,$actor,$scope,$c,$queries,'user_id',static function(string $table,array $row):array{
        $fields=['habitProfiles'=>['encrypted_plan','plan_json'],'habitDeliveries'=>['encrypted_target','target_json']];
        if(isset($fields[$table])){
            [$stored,$plain]=$fields[$table];
            try{$row[$plain]=genesisSharedContentDecrypt($row[$stored]);}
            catch(Throwable){throw new DomainException('E2EE_REMINDER_SOURCE_CORRUPT');}
        }
        return$row;
    });
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return$result;
}
