<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Historical private selections/preferences, not the public catalogue. This
 * read never calls the ordinary publication/selection helpers or grants quota.
 * Plaintext legacy rows are returned only to the signed current personal lease;
 * the client must validate and encrypt them with its independently held root.
 */
function genesisE2eeLegacyAdvice(PDO $db,string $actor,array $scope,array $c): array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $preferences=genesisE2eeRow($db,'SELECT advice_preferences_json FROM users WHERE id=?',[$actor]);
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'preferencesJson'=>$preferences['advice_preferences_json'],'days'=>[],'entries'=>[],'extraEntries'=>[],'metrics'=>null];
    $size=strlen(genesisE2eeJson($result));$count=0;
    $fields=['day_key'=>'dayKey','advice_id'=>'adviceId','entry_json'=>'entryJson','created_at'=>'createdAt','viewed_at'=>'viewedAt','dismissed_at'=>'dismissedAt'];
    foreach([
        'days'=>['daily_advice_days',$fields+['selection_json'=>'selectionJson']],
        'entries'=>['daily_advice_entries',$fields+['slot'=>'slot']],
        'extraEntries'=>['daily_advice_extra_entries',$fields+['slot'=>'slot']],
    ]as $name=>[$table,$columns]) {
        // Both identifiers are literal allowlisted constants, never request data.
        $q=$db->prepare('SELECT '.implode(',',array_keys($columns)).' FROM '.$table.' WHERE user_id=? ORDER BY day_key'.($name==='days'?'':',slot'));
        $q->execute([$actor]);
        try {
            while($row=$q->fetch()) {
                if(++$count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $copy=[];foreach($columns as $from=>$to)$copy[$to]=$to==='slot'?(int)$row[$from]:$row[$from];
                $size+=strlen(genesisE2eeJson($copy))+1;if($size>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $result[$name][]=$copy;
            }
        }finally{$q->closeCursor();}
    }
    $metrics=genesisE2eeRow($db,'SELECT project_count,task_count,open_task_count,completed_task_count,google_synced_count,habit_count,updated_at FROM user_metrics WHERE user_id=?',[$actor]);
    if($metrics){$copy=[];foreach(['project_count'=>'projects','task_count'=>'tasks','open_task_count'=>'openTasks','completed_task_count'=>'completedTasks','google_synced_count'=>'googleSynced','habit_count'=>'habits']as $from=>$to)$copy[$to]=(int)$metrics[$from];
        $copy['updatedAt']=$metrics['updated_at'];$result['metrics']=$copy;}
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
