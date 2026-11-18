<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-legacy-personal.php';

/** Read-only historical content under the signed current migration lease. Seeds,
 * saved cards and reveal history are content; attempts, entitlement, payment and
 * live reroll permissions are deliberately absent. Import cannot grant rights.
 */
function genesisE2eeLegacyStoicheion(PDO $db,string $actor,array $scope,array $c): array
{
    $context=genesisE2eeLegacyPersonalContext($db,$actor,$scope,$c);
    $workspace=genesisE2eeRow($db,'SELECT revision,iv,ciphertext,updated_at FROM stoicheion_workspaces WHERE user_id=?',[$actor]);
    $result=genesisE2eeLegacyPersonalHeader($actor,$scope,$context)+[
        'workspace'=>$workspace?['revision'=>(int)$workspace['revision'],'iv'=>$workspace['iv'],'ciphertext'=>$workspace['ciphertext'],'updatedAt'=>$workspace['updated_at']]:null,
        'draws'=>[],'spreadCards'=>[],'timelineSessions'=>[],'timelineWindows'=>[]];
    $size=strlen(genesisE2eeJson($result));$count=0;
    $queries=[
        'draws'=>["SELECT day_key,draw_kind,seed_value,first_draw_at,updated_at FROM stoicheion_draws WHERE user_id=?
            UNION ALL SELECT day_key,draw_kind,seed_value,first_draw_at,updated_at FROM stoicheion_timeline_draws WHERE user_id=? ORDER BY day_key,draw_kind",[$actor,$actor],
            ['day_key'=>'dayKey','draw_kind'=>'kind','seed_value'=>'seed','first_draw_at'=>'firstDrawAt','updated_at'=>'updatedAt'],['seed']],
        'spreadCards'=>['SELECT day_key,source_seed,revision,cards_json,updated_at FROM stoicheion_spread_cards WHERE user_id=? ORDER BY day_key',[$actor],
            ['day_key'=>'dayKey','source_seed'=>'sourceSeed','revision'=>'revision','cards_json'=>'cardsJson','updated_at'=>'updatedAt'],['sourceSeed','revision']],
        'timelineSessions'=>['SELECT period_key,source_day_key,seed_value,revision,created_at,updated_at FROM stoicheion_timeline_sessions WHERE user_id=? ORDER BY period_key',[$actor],
            ['period_key'=>'periodKey','source_day_key'=>'dayKey','seed_value'=>'seed','revision'=>'revision','created_at'=>'createdAt','updated_at'=>'updatedAt'],['seed','revision']],
        'timelineWindows'=>['SELECT period_key,position,first_revealed_at,rerolled_at FROM stoicheion_timeline_card_windows WHERE user_id=? ORDER BY period_key,position',[$actor],
            ['period_key'=>'periodKey','position'=>'position','first_revealed_at'=>'firstRevealedAt','rerolled_at'=>'lastRerolledAt'],['position']],
    ];
    foreach($queries as $key=>[$sql,$parameters,$fields,$integers]) {
        $q=$db->prepare($sql);$q->execute($parameters);
        try {
            while($row=$q->fetch()) {
                if(++$count>10000)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $copy=[];foreach($fields as $from=>$to)$copy[$to]=in_array($to,$integers,true)?(int)$row[$from]:$row[$from];
                $size+=strlen(genesisE2eeJson($copy))+1;if($size>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
                $result[$key][]=$copy;
            }
        } finally {$q->closeCursor();}
    }
    $result['legacyKey']=genesisE2eeLegacyAccountKey($context['user'],$result['workspace']!==null);
    if(strlen(genesisE2eeJson($result))>16*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_SOURCE_TOO_LARGE');
    return $result;
}
