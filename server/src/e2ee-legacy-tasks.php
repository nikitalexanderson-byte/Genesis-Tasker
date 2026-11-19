<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Exact personal legacy task content and operation history, under the current
 * signed device/owner/lease/source token. No provider bootstrap, task recovery,
 * receipt acknowledgement or external mutation occurs during this read. Old
 * external-operation identities are history, never restored execution grants.
 */
function genesisE2eeLegacyTasks(PDO $db,string $actor,array $scope,array $c): array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'tasks'=>[],'deletions'=>[],'links'=>[],'recovered'=>[],'recoveredDeletions'=>[],
        'creations'=>[],'creationTargets'=>[]];
    // Table/column/order identifiers are compile-time constants, not payload data.
    // The users row, sessions, provider tokens, billing and ACL are not content.
    $queries=[
        'tasks'=>['tasks','id,project_id,category_id,sacred_year,month_index,sacred_day,due_date,title,description,time_value,project_label,tags_json,done,completed_at,reminder_minutes,recurrence,recurrence_interval,sync_to_google,google_event_id,created_at,updated_at',
            ['sacred_year','month_index','sacred_day','done','reminder_minutes','recurrence_interval','sync_to_google'],'id'],
        'deletions'=>['task_deletions','task_id,deleted_at',[],'task_id'],
        // Actor-owned references are retained even if their old target is gone.
        // No parent join may accidentally select another owner's task content.
        'links'=>['task_links','task_id,depends_on_task_id,created_at',[],'task_id,depends_on_task_id'],
        'recovered'=>['personal_recovered_tasks','id,revision,iv,ciphertext,updated_at',['revision'],'id'],
        'recoveredDeletions'=>['personal_recovered_task_deletions','id,revision,updated_at',['revision'],'id'],
        'creations'=>['personal_task_creations','task_id,state',[],'task_id'],
        'creationTargets'=>['personal_task_creation_targets','task_id,target_key,recovery_token,attempted,provider_id,provider_key',['attempted'],'task_id'],
    ];
    $bytes=strlen(genesisE2eeJson($result));$count=0;
    foreach($queries as $name=>[$table,$columns,$integers,$order]) {
        $q=$db->prepare('SELECT '.$columns.' FROM '.$table.' WHERE user_id=? ORDER BY '.$order);$q->execute([$actor]);
        try {
            while($row=$q->fetch()) {
                if(++$count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                foreach($integers as $field)if($row[$field]!==null)$row[$field]=(int)$row[$field];
                $bytes+=strlen(genesisE2eeJson($row))+1;
                if($bytes>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $result[$name][]=$row;
            }
        }finally{$q->closeCursor();}
    }
    // Only encrypted recovered records need the pre-existing server-known key.
    // A missing/corrupt key cannot turn those records into an empty history.
    $result['legacyKey']=$result['recovered']?genesisE2eeLegacyAccountKey($context['user'],true):['keyMode'=>'empty','key'=>null];
    require_once __DIR__.'/e2ee-provider-cache.php';
    $result['providerCaches']=genesisE2eeReadProviderCaches($db,$actor);
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
