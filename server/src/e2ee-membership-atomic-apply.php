<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-membership-atomic-stage.php';

/** One immutable page at a time; missing, duplicate, extra or substituted
 * originals fail before the containing writer can commit. */
function genesisMembershipAtomicReadPages(PDO $db,string $actor,string $intent,string $phase,array $refs):Generator
{
    $q=$db->prepare('SELECT page_index,kind,item_count,page_hash,payload_json FROM e2ee_membership_atomic_pages WHERE actor_id=? AND intent_id=? AND phase=? ORDER BY page_index');
    $q->execute([$actor,$intent,$phase]);$index=0;
    try{
        while($row=$q->fetch()){
            if(!isset($refs[$index])||(int)$row['page_index']!==$index)throw new DomainException('E2EE_MEMBERSHIP_PAGE_INCOMPLETE');
            $page=genesisMembershipAtomicPage(json_decode($row['payload_json'],true,64,JSON_THROW_ON_ERROR));$ref=genesisMembershipAtomicPageRef($index,$page);
            if($row['page_hash']!==$ref['pageHash']||$row['kind']!==$ref['kind']||(int)$row['item_count']!==$ref['count']
                ||!hash_equals(genesisMembershipAtomicDigest($ref),genesisMembershipAtomicDigest($refs[$index])))throw new DomainException('E2EE_CONTEXT_MISMATCH');
            yield $index=>$page;$index++;
        }
        if($index!==count($refs))throw new DomainException('E2EE_MEMBERSHIP_PAGE_INCOMPLETE');
    }finally{$q->closeCursor();}
}
function genesisMembershipAtomicPlanOperation(PDO $db,string $actor,array $plan):array
{
    $operation=null;$grants=[];
    foreach(genesisMembershipAtomicReadPages($db,$actor,$plan['intentId'],'plan',$plan['pages'])as $page){
        if($page['kind']==='operation'){
            if($operation!==null||count($page['items'])!==1)throw new DomainException('E2EE_MEMBERSHIP_OPERATION_INVALID');$operation=genesisMembershipOperation($page['items'][0],true);
        }elseif($page['kind']==='operation-grants')foreach($page['items'] as $grant){if(count($grants)>=5000)throw new DomainException('E2EE_MEMBERSHIP_OPERATION_INVALID');$grants[]=$grant;}
    }
    if($operation===null||$operation['kind']!=='project-grants'&&$grants)throw new DomainException('E2EE_MEMBERSHIP_OPERATION_INVALID');
    if($operation['kind']==='project-grants')$operation['grants']=$grants;return genesisMembershipOperation($operation);
}
/** Recompute normal semantics and every affected scope from current technical
 * rows/normal root heads. Client hashes never substitute for that calculation.
 * Product bodies remain opaque: their exact immutable versions are bound to
 * the owners' full effects review and checked by normal repositories. */
function genesisMembershipAtomicPreflight(PDO $db,string $actor,array $plan):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');
    $operation=genesisMembershipAtomicPlanOperation($db,$actor,$plan);
    $snapshot=genesisMembershipOperationSnapshot($db,$actor,$plan['spaceId'],$operation);
    if(!hash_equals(genesisMembershipOperationFingerprint($snapshot,$operation),$plan['reviewFingerprint']))throw new DomainException('E2EE_MEMBERSHIP_STALE');
    $expected=genesisMembershipOperationPlan($snapshot,$operation);if($expected['scopeIds']!==$plan['scopeIds'])throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
    $anchors=[];$scopes=[];foreach($expected['requiredScopes'] as $scope){$root=$scope['root'];$kind=str_starts_with($root['entityId'],'space:')?'space':'project';$resource=substr($root['entityId'],strpos($root['entityId'],':')+1);
        $anchors[]=['scopeId'=>$scope['scopeId'],'ownerId'=>$scope['ownerId'],'kind'=>$kind,'resourceId'=>$resource,'generation'=>$root['generation'],'directoryRevision'=>$root['directoryRevision'],
            'checkpointHash'=>$root['checkpointHash'],'entityId'=>$root['entityId'],'revision'=>$root['revision'],'payloadHash'=>$root['payloadHash'],'productIndexHash'=>$root['productIndexHash']];
        $current=genesisE2eeRow($db,'SELECT * FROM e2ee_scopes WHERE scope_id=?',[$scope['scopeId']]);if(!$current)throw new DomainException('E2EE_MEMBERSHIP_STALE');$scopes[$scope['scopeId']]=$current;
    }
    $sections=['acl'=>$expected['changes'],'anchors'=>$anchors,'clear-assignments'=>$expected['clearAssignments'],'revoke-invitations'=>$expected['revokeInvitations'],'role-events'=>$expected['roleEvents']];
    $offsets=array_fill_keys(array_keys($sections),0);$products=[];
    foreach(genesisMembershipAtomicReadPages($db,$actor,$plan['intentId'],'plan',$plan['pages'])as $page){
        $kind=$page['kind'];if(array_key_exists($kind,$sections))foreach($page['items'] as $item){
            $index=$offsets[$kind]++;if(!isset($sections[$kind][$index]))throw new DomainException('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');$wanted=$sections[$kind][$index];
            $left=$kind==='acl'?genesisE2eeMembershipChangesProjection([$item]):$item;$right=$kind==='acl'?genesisE2eeMembershipChangesProjection([$wanted]):$wanted;
            if(!hash_equals(genesisMembershipAtomicDigest($left),genesisMembershipAtomicDigest($right)))throw new DomainException('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
        }elseif($kind==='product-operations')foreach($page['items'] as $row){
            $key=$row['scopeId']."\0".$row['intentId'];if(isset($products[$key])||!isset($scopes[$row['scopeId']]))throw new DomainException('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');$products[$key]=$row;
        }
    }
    foreach($sections as $kind=>$items)if($offsets[$kind]!==count($items))throw new DomainException('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
    $prepared=[];foreach(array_chunk($expected['changes'],200)as $page)$prepared=[...$prepared,...genesisE2eeAclChanges($db,$actor,$page)['rows']];
    return ['operation'=>$operation,'effects'=>$expected,'scopes'=>$scopes,'aclRows'=>$prepared,'products'=>$products];
}
/** Simulate only the exact verified ACL rows, obtain bounded technical owner
 * review pages, and always roll back. This never grants access or rotates keys. */
function genesisMembershipAtomicPreview(string $actor,array $input):array
{
    genesisE2eeExactFields($input,['intentId','planHash','after','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];genesisE2eeDecode($hash,32);$after=genesisMembershipAtomicInteger($input['after']);
    if($after>5001)throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-preview',['intentId'=>$intent,'planHash'=>$hash,'after'=>$after]);
        genesisMembershipAtomicNotCancelled($db,$actor,$intent);$stored=genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);
        if($stored['state']!=='staged')throw new DomainException('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');$plan=genesisMembershipAtomicPlan(json_decode($stored['manifest_json'],true,64,JSON_THROW_ON_ERROR));
        if($after>count($plan['scopeIds']))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ATOMIC_INVALID');
        $prepared=genesisMembershipAtomicPreflight($db,$actor,$plan);genesisE2eeApplyAclRows($db,$prepared['aclRows']);$plans=[];$next=null;
        for($at=$after;$at<count($plan['scopeIds'])&&count($plans)<200;$at++){
            $id=$plan['scopeIds'][$at];$scope=$prepared['scopes'][$id];genesisE2eeAccess($scope['owner_id'],$scope['kind'],$scope['resource_id'],'manage');
            $q=$db->prepare('SELECT device_id,user_id FROM e2ee_devices WHERE scope_id=? AND revoked=0 ORDER BY device_id');$q->execute([$id]);$devices=$q->fetchAll();$q->closeCursor();$roles=[];
            foreach($devices as $device){$role=null;try{$role=genesisE2eeDeviceRole($device['user_id'],$scope);}catch(GenesisSharedAccessException|GenesisResourceLimitException $error){if(!in_array($error->status,[403,404],true))throw $error;}
                $roles[]=['deviceId'=>$device['device_id'],'userId'=>$device['user_id'],'role'=>$role];
            }
            $row=['scopeId'=>$id,'ownerId'=>$scope['owner_id'],'kind'=>$scope['kind'],'resourceId'=>$scope['resource_id'],'generation'=>(int)$scope['generation'],
                'directoryRevision'=>(int)$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash'],'cryptoEpoch'=>(int)$scope['crypto_epoch'],'securityEpoch'=>(int)$scope['security_epoch'],
                'roles'=>$roles,'manifest'=>genesisE2eeManifest($db,$scope)];$plans[]=$row;
            if(strlen(genesisE2eeCanonical($plans))>512*1024){array_pop($plans);if(!$plans)throw new GenesisResourceLimitException(413,'E2EE_MEMBERSHIP_PAGE_TOO_LARGE');break;}
        }
        if($after+count($plans)<count($plan['scopeIds']))$next=$after+count($plans);
        return ['intentId'=>$intent,'planHash'=>$hash,'changeHash'=>genesisMembershipAtomicChangeHash($plan),'scopePlans'=>$plans,'next'=>$next];
    }finally{if($db->inTransaction())$db->rollBack();}
}
function genesisMembershipAtomicPacket(PDO $db,array $scope,array $packet,string $action,string $changeHash):array
{
    genesisE2eeExactFields($packet,['command','signature']);$command=genesisE2eeCommand($packet['command']);
    if($command['scopeId']!==$scope['scope_id']||$command['ownerId']!==$scope['owner_id']||$command['action']!==$action||($command['payload']['membershipHash']??null)!==$changeHash)throw new DomainException('E2EE_CONTEXT_MISMATCH');
    $device=genesisE2eeRow($db,'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$scope['scope_id'],$command['deviceId']]);
    if(!$device||$device['revoked']||!in_array($device['role'],['owner','writer'],true)||$action==='rotate-membership'&&($device['role']!=='owner'||$device['user_id']!==$scope['owner_id']))throw new DomainException('E2EE_REVOKED_DEVICE');
    genesisE2eeVerifyCommand($packet,$device['signing_key']);
    if($command['expectedRevision']!==(int)$scope['directory_revision']||$command['checkpointHash']!==$scope['checkpoint_hash']||$command['securityEpoch']!==(int)$scope['security_epoch'])throw new DomainException('E2EE_MEMBERSHIP_STALE');
    return ['command'=>$command,'actorId'=>$device['user_id']];
}
function genesisMembershipAtomicReceiptPage(string $kind,array $items):array
{
    if(!in_array($kind,['scopes','products'],true)||!$items||count($items)>200)throw new LogicException('E2EE_MEMBERSHIP_RECEIPT_INVALID');
    $page=['format'=>'genesis-membership-receipt-page-v2','kind'=>$kind,'items'=>$items];
    if(strlen(genesisE2eeCanonical($page))>512*1024)throw new LengthException('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');return $page;
}
/** Append bounded immutable receipt pages inside the containing writer. */
function genesisMembershipAtomicStoreReceiptPages(PDO $db,string $actor,string $intent,string $kind,array $items,array &$refs):void
{
    $offset=0;$size=min(200,count($items));while($offset<count($items)){
        try{$page=genesisMembershipAtomicReceiptPage($kind,array_slice($items,$offset,$size));}
        catch(LengthException $error){if($size<=1)throw $error;$size=max(1,intdiv($size,2));continue;}
        $index=count($refs);if($index>=10000)throw new GenesisResourceLimitException(413,'E2EE_MEMBERSHIP_RECEIPT_TOO_LARGE');
        $ref=['index'=>$index,'kind'=>$kind,'count'=>count($page['items']),'pageHash'=>genesisMembershipAtomicDigest($page)];
        $db->prepare('INSERT INTO e2ee_membership_atomic_receipt_pages(actor_id,intent_id,page_index,kind,item_count,page_hash,payload_json) VALUES(?,?,?,?,?,?,?)')
            ->execute([$actor,$intent,$index,$kind,$ref['count'],$ref['pageHash'],genesisE2eeJson($page)]);$refs[]=$ref;$offset+=$size;$size=min(200,count($items)-$offset);
    }
}
/** One atomic writer covers products, exact ACL rows, invitation/projection
 * revocations, every owner's rotation and the immutable paged receipt. A lost
 * response can only return this same result for the same saved authorization. */
function genesisMembershipAtomicCommit(string $actor,array $input,string $sessionBinding):array
{
    genesisE2eeExactFields($input,['intentId','planHash','batchHash','authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];$batch=$input['batchHash'];genesisE2eeDecode($hash,32);genesisE2eeDecode($batch,32);
    $payload=['intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch];$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        // Historical anchors are permitted only for returning the exact prior
        // receipt. The signer must still be a current non-revoked personal owner.
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-commit',$payload,false);
        $stored=genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);$requestHash=genesisMembershipAtomicDigest(['payload'=>$payload,'authorization'=>$input['authorization']]);
        if($stored['state']==='committed'){
            if(!is_string($stored['commit_hash'])||!hash_equals($stored['commit_hash'],$requestHash)||$stored['batch_hash']!==$batch)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
            $result=json_decode($stored['result_json'],true,64,JSON_THROW_ON_ERROR);$db->commit();return $result;
        }
        genesisMembershipAtomicNotCancelled($db,$actor,$intent);if($stored['state']!=='staged')throw new DomainException('E2EE_MEMBERSHIP_PLAN_LOCKED');
        genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],'membership-atomic-commit',$payload);
        $sealed=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_packet_manifests WHERE actor_id=? AND intent_id=?',[$actor,$intent]);
        if(!$sealed||$sealed['plan_hash']!==$hash||$sealed['batch_hash']!==$batch)throw new DomainException('E2EE_MEMBERSHIP_PACKET_MANIFEST_REQUIRED');
        $plan=genesisMembershipAtomicPlan(json_decode($stored['manifest_json'],true,64,JSON_THROW_ON_ERROR));$refs=genesisMembershipAtomicRefs(json_decode($sealed['manifest_json'],true,64,JSON_THROW_ON_ERROR),true);
        if(genesisMembershipAtomicBatchHash($plan,$refs)!==$batch)throw new DomainException('E2EE_CONTEXT_MISMATCH');$changeHash=genesisMembershipAtomicChangeHash($plan);
        $prepared=genesisMembershipAtomicPreflight($db,$actor,$plan);$rotations=[];$products=[];
        foreach(genesisMembershipAtomicReadPages($db,$actor,$intent,'packets',$refs)as $pageIndex=>$page)foreach($page['items'] as $itemIndex=>$packet){
            $command=genesisE2eeCommand($packet['command']);$id=$command['scopeId'];if(!isset($prepared['scopes'][$id]))throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
            $checked=genesisMembershipAtomicPacket($db,$prepared['scopes'][$id],$packet,$page['kind']==='rotation-packets'?'rotate-membership':'product-commit-bound',$changeHash);
            if($page['kind']==='rotation-packets'){
                if(isset($rotations[$id]))throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');$rotations[$id]=[$pageIndex,$itemIndex];
            }else{
                $p=genesisE2eeExactFields($command['payload'],['intentId','membershipHash','operations']);$key=$id."\0".$p['intentId'];
                if(isset($products[$key])||!isset($prepared['products'][$key])||!hash_equals(genesisMembershipAtomicDigest($p['operations']),genesisMembershipAtomicDigest($prepared['products'][$key]['operations'])))throw new DomainException('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
                $products[$key]=['page'=>$pageIndex,'index'=>$itemIndex,'actorId'=>$checked['actorId']];
            }
        }
        $scopeIds=array_keys($rotations);sort($scopeIds,SORT_STRING);if($scopeIds!==$plan['scopeIds']||count($products)!==count($prepared['products']))throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
        $loadPacket=static function(int $pageIndex,int $itemIndex)use($db,$actor,$intent,$refs):array{
            $row=genesisE2eeRow($db,"SELECT payload_json FROM e2ee_membership_atomic_pages WHERE actor_id=? AND intent_id=? AND phase='packets' AND page_index=?",[$actor,$intent,$pageIndex]);
            if(!$row)throw new DomainException('E2EE_MEMBERSHIP_PAGE_INCOMPLETE');$page=genesisMembershipAtomicPage(json_decode($row['payload_json'],true,64,JSON_THROW_ON_ERROR));
            if(!hash_equals(genesisMembershipAtomicDigest(genesisMembershipAtomicPageRef($pageIndex,$page)),genesisMembershipAtomicDigest($refs[$pageIndex]))||!isset($page['items'][$itemIndex]))throw new DomainException('E2EE_CONTEXT_MISMATCH');return $page['items'][$itemIndex];
        };
        $receiptRefs=[];$productResults=[];
        foreach($products as $row){$packet=$loadPacket($row['page'],$row['index']);$result=genesisE2eeExecuteLocked($row['actorId'],$packet,$sessionBinding,$changeHash);
            $productResults[]=['scopeId'=>$packet['command']['scopeId'],'intentId'=>$packet['command']['payload']['intentId'],'actorId'=>$row['actorId'],'result'=>$result];
            if(count($productResults)===200){genesisMembershipAtomicStoreReceiptPages($db,$actor,$intent,'products',$productResults,$receiptRefs);$productResults=[];}
        }
        genesisMembershipAtomicStoreReceiptPages($db,$actor,$intent,'products',$productResults,$receiptRefs);
        genesisE2eeApplyAclRows($db,$prepared['aclRows']);
        foreach($prepared['effects']['revokeInvitations'] as $row)genesisSharedRevokeInvitationsByMember($row['userId'],$row['kind']==='project'?$row['resourceId']:null,$row['kind']==='space'?$row['resourceId']:null);
        foreach($prepared['effects']['clearAssignments'] as $row){
            // Technical routing IDs only; never rewrite a retired plaintext task
            // or invoke a provider. New private bodies were committed above.
            $db->prepare('DELETE FROM shared_google_projection_links WHERE user_id=? AND task_id IN (SELECT id FROM shared_tasks WHERE project_id=?)')->execute([$row['userId'],$row['projectId']]);
        }
        $scopeResults=[];foreach($prepared['scopes'] as $id=>$scope){$coordinate=$rotations[$id];$packet=$loadPacket($coordinate[0],$coordinate[1]);$result=genesisE2eeExecuteLocked($scope['owner_id'],$packet,$sessionBinding,$changeHash);
            $scopeResults[]=['scopeId'=>$id,'ownerId'=>$scope['owner_id'],'result'=>$result];if(count($scopeResults)===200){genesisMembershipAtomicStoreReceiptPages($db,$actor,$intent,'scopes',$scopeResults,$receiptRefs);$scopeResults=[];}
        }
        genesisMembershipAtomicStoreReceiptPages($db,$actor,$intent,'scopes',$scopeResults,$receiptRefs);
        if($prepared['operation']['kind']==='invitation-admit'){require_once __DIR__.'/e2ee-invitation-responses.php';genesisE2eeInvitationAdmissionCommit($db,$prepared['operation']);}
        $result=['format'=>'genesis-membership-atomic-receipt-v2','actorId'=>$actor,'intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch,'changeHash'=>$changeHash,'pages'=>$receiptRefs,'signInRequired'=>true];
        $db->prepare("UPDATE e2ee_membership_atomic_plans SET state='committed',batch_hash=?,commit_hash=?,result_json=?,updated_at=? WHERE actor_id=? AND intent_id=? AND state='staged'")
            ->execute([$batch,$requestHash,genesisE2eeJson($result),genesisNow(),$actor,$intent]);$db->commit();return $result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
/** Read a known immutable outcome with a live non-revoked personal device.
 * A historical read signature never applies or renews the original operation. */
function genesisMembershipAtomicReceipt(string $actor,array $input,bool $page=false):array
{
    genesisE2eeExactFields($input,['intentId','planHash','batchHash',...($page?['index']:[]),'authorization']);$intent=genesisE2eeIdentifier($input['intentId']);$hash=$input['planHash'];$batch=$input['batchHash'];genesisE2eeDecode($hash,32);genesisE2eeDecode($batch,32);
    $payload=['intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch];if($page){$index=genesisMembershipAtomicInteger($input['index']);if($index>=10000)throw new InvalidArgumentException('E2EE_MEMBERSHIP_RECEIPT_INVALID');$payload['index']=$index;}
    $db=genesisDb();$db->beginTransaction();
    try{
        $authorized=genesisMembershipAtomicAuthorization($db,$actor,$input['authorization'],$page?'membership-atomic-receipt-page':'membership-atomic-receipt',$payload,false);
        $stored=genesisMembershipAtomicStoredPlan($db,$actor,$intent,$hash,$authorized['scope']['scope_id']);
        if($stored['state']!=='committed')throw new DomainException('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');if($stored['batch_hash']!==$batch)throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        $header=json_decode($stored['result_json'],true,64,JSON_THROW_ON_ERROR);
        if(!$page){$db->commit();return $header;}
        $row=genesisE2eeRow($db,'SELECT * FROM e2ee_membership_atomic_receipt_pages WHERE actor_id=? AND intent_id=? AND page_index=?',[$actor,$intent,$index]);
        if(!$row||!isset($header['pages'][$index]))throw new DomainException('E2EE_MEMBERSHIP_RECEIPT_INCOMPLETE');
        $body=json_decode($row['payload_json'],true,64,JSON_THROW_ON_ERROR);genesisE2eeExactFields($body,['format','kind','items']);
        if($body['format']!=='genesis-membership-receipt-page-v2'||$body['kind']!==$row['kind']||!is_array($body['items'])||!array_is_list($body['items']))throw new DomainException('E2EE_MEMBERSHIP_RECEIPT_INVALID');
        genesisMembershipAtomicReceiptPage($body['kind'],$body['items']);$ref=['index'=>$index,'kind'=>$body['kind'],'count'=>count($body['items']),'pageHash'=>genesisMembershipAtomicDigest($body)];
        if($row['page_hash']!==$ref['pageHash']||(int)$row['item_count']!==$ref['count']||!hash_equals(genesisMembershipAtomicDigest($ref),genesisMembershipAtomicDigest($header['pages'][$index])))throw new DomainException('E2EE_CONTEXT_MISMATCH');
        $db->commit();return ['intentId'=>$intent,'planHash'=>$hash,'batchHash'=>$batch,'index'=>$index,'page'=>$body];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
