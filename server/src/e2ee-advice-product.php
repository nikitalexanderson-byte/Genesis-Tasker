<?php
declare(strict_types=1);

function genesisE2eeAdvicePolicy(PDO $db,string $actor,array $scope): array
{
    if($scope['kind']!=='personal'||$scope['owner_id']!==$actor||$scope['resource_id']!==$actor||$scope['state']!=='active')throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
    $user=genesisFindUser($actor);if(!$user)throw new DomainException('E2EE_SCOPE_FORBIDDEN');$access=genesisFeatureAccessForUser($user);$day=genesisAdviceDayKey();
    $q=$db->prepare('SELECT slot,entry_json FROM daily_advice_all_entries WHERE user_id=? AND day_key=? ORDER BY slot');$q->execute([$actor,$day]);$legacy=[];
    foreach($q->fetchAll() as $row){$entry=json_decode($row['entry_json'],true,32,JSON_THROW_ON_ERROR);$legacy[]=['slot'=>(int)$row['slot'],'collection'=>$entry['collection']??'aurora'];}$q->closeCursor();
    $q=$db->prepare('SELECT slot,collection,object_id AS objectId,payload_hash AS payloadHash FROM e2ee_advice_issues WHERE scope_id=? AND day_key=? ORDER BY slot');$q->execute([$scope['scope_id'],$day]);$issues=$q->fetchAll();$q->closeCursor();
    return ['dayKey'=>$day,'serverNow'=>genesisNow(),'auroraLimit'=>$access['enforcementEnabled']?($access['adviceDailyLimit']??6):6,
        'restricted'=>$access['enforcementEnabled']&&$access['adviceDailyLimit']!==null,'settingsAllowed'=>!$access['enforcementEnabled']||in_array('advice-settings',$access['allowedFeatures'],true),
        'legacy'=>$legacy,'issues'=>$issues,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
function genesisE2eeAdviceIssue(PDO $db,string $actor,array $scope,array $payload): array
{
    genesisE2eeExactFields($payload,['intentId','dayKey','collection','expectedCount','objectId','payloadHash']);$id=genesisE2eeIdentifier($payload['intentId']);
    $hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $old=genesisE2eeRow($db,"SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action='advice-issue' AND intent_id=?",[$scope['scope_id'],$actor,$id]);
    if($old){if($old['payload_hash']!==$hash)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($old['result_json'],true,32,JSON_THROW_ON_ERROR);}
    $policy=genesisE2eeAdvicePolicy($db,$actor,$scope);$count=count($policy['legacy'])+count($policy['issues']);$collection=$payload['collection'];
    if(!in_array($collection,['aurora','philosophers'],true)||$payload['dayKey']!==$policy['dayKey']||genesisE2eeInteger($payload['expectedCount'])!==$count)throw new DomainException('E2EE_ADVICE_STALE');
    $used=count(array_filter([...$policy['legacy'],...$policy['issues']],static fn(array $row):bool=>$row['collection']===$collection));$limit=$collection==='philosophers'?3:$policy['auroraLimit'];
    if($count>=9||$used>=$limit)throw new DomainException('E2EE_ADVICE_LIMIT');
    if($payload['objectId']!=='advice-live:'.$id)throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');genesisE2eeDecode($payload['payloadHash'],32);
    $object=genesisE2eeRow($db,"SELECT revision,payload_hash FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain='workspace' AND object_id=?",[$scope['scope_id'],$scope['generation'],$payload['objectId']]);
    if(!$object||(int)$object['revision']!==1||$object['payload_hash']!==$payload['payloadHash'])throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');
    $slot=$count+1;$db->prepare('INSERT INTO e2ee_advice_issues VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$policy['dayKey'],$slot,$collection,$payload['objectId'],$payload['payloadHash']]);
    $result=['intentId'=>$id,'dayKey'=>$policy['dayKey'],'slot'=>$slot,'collection'=>$collection,'objectId'=>$payload['objectId'],'payloadHash'=>$payload['payloadHash']];
    $db->prepare("INSERT INTO e2ee_service_intents VALUES(?,?,'advice-issue',?,?,?)")->execute([$scope['scope_id'],$actor,$id,$hash,genesisE2eeJson($result)]);return$result;
}
