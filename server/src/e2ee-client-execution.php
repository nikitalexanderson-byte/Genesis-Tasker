<?php
declare(strict_types=1);

/** Only technical authorization is visible here. Rules, conditions, effects,
 * dates, recipients and task contents execute on the unlocked client. The
 * normal signed product transaction commits its effects and receipt together. */
function genesisE2eeClientExecutionOperation(PDO $db,string $actor,array $scope,array $operation,array|false $old,array $project,array $operations):void
{
    $kind=$operation['kind'];$metadata=$operation['metadata'];
    if($kind==='automation'){
        if(($metadata['protocol']??null)!==2)throw new DomainException('E2EE_AUTOMATION_OWNER_REQUIRED');
        genesisSharedRequireEnabled($metadata['ownerId']);genesisSharedProjectAccess($scope['resource_id'],$metadata['ownerId'],'write',true);
        return;
    }
    if(!in_array($kind,['automation-run','series-instance'],true))return;
    $run=$kind==='automation-run';
    if($scope['kind']!=='project'||$run&&$metadata['executorId']!==$actor||!in_array($operation['action'],['create','update'],true))throw new DomainException('E2EE_EXECUTION_ACTOR_REQUIRED');
    $parentId=$run?'automation:'.$metadata['ruleId']:$operation['parentId'];
    if(!is_string($parentId)||!str_starts_with($parentId,$run?'automation:':'series:'))throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $parent=genesisE2eeProductRow($db,$scope,$parentId);
    if(!$parent||$parent['deleted']||$operation['parentId']!==$parentId||$run&&(int)$parent['revision']!==$metadata['ruleRevision'])throw new DomainException('AUTOMATION_STALE');
    if($run){
        $authority=json_decode($parent['metadata_json'],true,512,JSON_THROW_ON_ERROR);
        if(($authority['protocol']??null)!==2||($authority['ownerId']??null)!==$actor)throw new DomainException('E2EE_EXECUTION_ACTOR_REQUIRED');
        if($old||$operation['action']!=='create')throw new DomainException('E2EE_EXECUTION_RECEIPT_IMMUTABLE');
        $q=$db->prepare("SELECT COUNT(*) FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND kind='automation-run' AND parent_id=? AND updated_at>=?");
        $q->execute([$scope['scope_id'],$scope['generation'],$parentId,gmdate('Y-m-d\TH:i:s\Z',time()-3600)]);$count=(int)$q->fetchColumn();$q->closeCursor();
        if($count>=100)throw new GenesisResourceLimitException(429,'AUTOMATION_RATE_LIMIT');
    }else{
        genesisSharedProjectAccess($scope['resource_id'],$actor,'organize',true);
        $updates=array_filter($operations,static fn(array $item):bool=>$item['entityId']===$parentId&&$item['kind']==='series'&&in_array($item['action'],['create','update'],true));
        if(count($updates)!==1)throw new DomainException('E2EE_EXECUTION_SERIES_CAS_REQUIRED');
        if($old||$operation['action']!=='create')throw new DomainException('E2EE_EXECUTION_RECEIPT_IMMUTABLE');
    }
}
