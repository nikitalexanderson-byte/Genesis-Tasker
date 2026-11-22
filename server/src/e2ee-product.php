<?php
declare(strict_types=1);

const GENESIS_E2EE_PRODUCT_KINDS=['project','space','task','comment','project-comment','status','category','label','mindmap','file','workflow','review-policy','planning','sprint','series','series-instance','automation','automation-run','template','custom-field','custom-field-value','view','history','trash','import'];
/** Live authorization/profile metadata only. Private titles, task bodies,
 * custom-field definitions, file names and policy documents are never projected
 * through this read. It is a display context, not a device/group trust grant. */
function genesisE2eeProductContext(PDO $db,string $actor,array $scope):array
{
    genesisSharedRequireEnabled($actor);if(!in_array($scope['kind'],['project','space'],true)||$scope['state']!=='active')throw new DomainException('E2EE_NOT_ACTIVE');
    $project=$scope['kind']==='project'?genesisSharedProjectAccess($scope['resource_id'],$actor,'read',true):null;
    $spaceId=$project?$project['space_id']:$scope['resource_id'];$space=genesisSharedSpaceAccess($spaceId,$actor);
    $permissions=$project?$project['permissions']:genesisSharedPermissions($space['member_role'],$space['permissions_json'],(int)$space['can_organize_tasks']===1,null,(bool)$space['project_access_restricted']);
    if($project){$q=$db->prepare('SELECT m.user_id AS userId,m.role,sm.role AS spaceRole,sm.permissions_json,sm.can_organize_tasks,sm.project_access_restricted,u.display_name AS displayName FROM shared_project_members m JOIN shared_space_members sm ON sm.user_id=m.user_id AND sm.space_id=? JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.user_id LIMIT 201');$q->execute([$spaceId,$scope['resource_id']]);}
    else{$q=$db->prepare('SELECT m.user_id AS userId,m.role,m.role AS spaceRole,m.permissions_json,m.can_organize_tasks,m.project_access_restricted,m.member_category_id AS categoryId,u.display_name AS displayName FROM shared_space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.user_id LIMIT 201');$q->execute([$spaceId]);}
    $members=$q->fetchAll();$q->closeCursor();if(count($members)>200)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_CONTEXT_TOO_LARGE');
    foreach($members as &$member){$member['permissions']=genesisSharedPermissions($member['spaceRole'],$member['permissions_json'],(int)$member['can_organize_tasks']===1,$project?$member['role']:null,(bool)$member['project_access_restricted']);$member['canOrganizeTasks']=(int)$member['can_organize_tasks'];unset($member['permissions_json'],$member['can_organize_tasks'],$member['project_access_restricted']);}unset($member);
    $invitations=[];
    if($permissions['inviteMembers']){
        $table=$project?'shared_invitations':'shared_space_invitations';$column=$project?'project_id':'space_id';
        $q=$db->prepare('SELECT id,email,role,expires_at AS expiresAt FROM '.$table.' WHERE '.$column.'=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY id LIMIT 101');$q->execute([$scope['resource_id'],genesisNow()]);$invitations=$q->fetchAll();$q->closeCursor();
        if(count($invitations)>100)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_CONTEXT_TOO_LARGE');
    }
    return ['ownerId'=>$scope['owner_id'],'spaceId'=>$spaceId,'role'=>$project?$project['member_role']:$space['member_role'],'spaceRole'=>$space['member_role'],'permissions'=>$permissions,'members'=>$members,'invitations'=>$invitations];
}
function genesisE2eeProductDomain(string $kind): string
{
    return match($kind){'comment','project-comment'=>'shared-comment','mindmap'=>'mindmap','file'=>'attachment',default=>'shared-project'};
}
function genesisE2eeProductIds(mixed $value,int $maximum=200): array
{
    if(!is_array($value)||!array_is_list($value)||count($value)>$maximum||count(array_unique($value,SORT_REGULAR))!==count($value))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
    foreach($value as $id)genesisE2eeIdentifier($id);return$value;
}
function genesisE2eeProductMetadata(string $kind,mixed $input): array
{
    $project=$kind==='project'&&is_array($input)&&($input['protocol']??null)===2;
    $automation=$kind==='automation'&&is_array($input)&&($input['protocol']??null)===2;$run=$kind==='automation-run';$instance=false;
    $fields=$project?['protocol','spaceId','parentProjectId','projectCategoryId','boardStatusId','projectType','layout','isInbox','archived']:
        ($automation?['protocol','ownerId']:($run?['protocol','ruleId','ruleRevision','executorId','triggerKey']:(match($kind){'task'=>['protocol','statusId','completed','approverIds','dependsOnIds','presentFields'],'workflow'=>['protocol','enabled','statuses','transitions'],default=>['protocol']})));
    $value=genesisE2eeExactFields($input,$fields);if($value['protocol']!==($project||$automation||$run||$instance?2:1))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
    if($automation)genesisE2eeIdentifier($value['ownerId']);
    if($run){foreach(['ruleId','executorId','triggerKey'] as $key)genesisE2eeIdentifier($value[$key]);genesisE2eeInteger($value['ruleRevision'],1);}
    if($project){
        genesisE2eeIdentifier($value['spaceId']);foreach(['parentProjectId','projectCategoryId','boardStatusId'] as $key)if($value[$key]!==null)genesisE2eeIdentifier($value[$key]);
        if(!in_array($value['projectType'],['project','task-list'],true)||!in_array($value['layout'],['list','board'],true)||!is_bool($value['isInbox'])||!is_bool($value['archived'])
          ||$value['boardStatusId']!==null&&$value['parentProjectId']===null||$value['projectType']==='task-list'&&($value['parentProjectId']===null||$value['projectCategoryId']!==null)
          ||$value['isInbox']&&($value['parentProjectId']!==null||$value['projectType']!=='project'||$value['projectCategoryId']!==null))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
    }
    if($kind==='task'){
        if($value['statusId']!==null)genesisE2eeIdentifier($value['statusId']);if(!is_bool($value['completed']))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
        genesisE2eeProductIds($value['approverIds']);genesisE2eeProductIds($value['dependsOnIds'],1000);genesisE2eeProductIds($value['presentFields'],512);
    }
    if($kind==='workflow'){
        if(!is_bool($value['enabled'])||!is_array($value['statuses'])||!array_is_list($value['statuses'])||count($value['statuses'])>200
            ||!is_array($value['transitions'])||!array_is_list($value['transitions'])||count($value['transitions'])>10000)throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
        $ids=[];foreach($value['statuses'] as $row){genesisE2eeExactFields($row,['statusId','wipLimit','requiredFields']);$id=genesisE2eeIdentifier($row['statusId']);
            if(isset($ids[$id])||$row['wipLimit']!==null&&(genesisE2eeInteger($row['wipLimit'],1)>100000))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');$ids[$id]=true;genesisE2eeProductIds($row['requiredFields']);}
        foreach($value['transitions'] as $row){genesisE2eeExactFields($row,['fromStatusId','toStatusId','roles']);
            if($row['fromStatusId']!==null&&!isset($ids[$row['fromStatusId']])||!isset($ids[$row['toStatusId']]))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');
            $roles=genesisE2eeProductIds($row['roles'],5);if(!$roles||array_diff($roles,['owner','manager','member','commenter','viewer']))throw new InvalidArgumentException('E2EE_PRODUCT_METADATA_INVALID');}
    }return$value;
}
function genesisE2eeProductRow(PDO $db,array $scope,string $id): array|false
{
    return genesisE2eeRow($db,'SELECT * FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND entity_id=?',[$scope['scope_id'],$scope['generation'],$id]);
}
function genesisE2eeProductPublic(array $row): array
{
    return ['entityId'=>$row['entity_id'],'kind'=>$row['kind'],'revision'=>(int)$row['revision'],'domain'=>$row['domain'],'objectId'=>$row['object_id'],'payloadHash'=>$row['payload_hash'],
        'parentId'=>$row['parent_id'],'authorId'=>$row['author_id'],'deleted'=>(bool)$row['deleted'],'metadata'=>json_decode($row['metadata_json'],true,32,JSON_THROW_ON_ERROR),'updatedAt'=>$row['updated_at']];
}
function genesisE2eeProductIndex(PDO $db,array $scope,array $payload): array
{
    genesisE2eeExactFields($payload,['after','limit']);$after=$payload['after'];if($after!=='')genesisE2eeIdentifier($after);$limit=genesisE2eeInteger($payload['limit'],1);if($limit>50)throw new InvalidArgumentException('E2EE_INVALID_LIMIT');
    $q=$db->prepare('SELECT * FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND entity_id>? ORDER BY entity_id LIMIT ?');
    $q->bindValue(1,$scope['scope_id']);$q->bindValue(2,(int)$scope['generation'],PDO::PARAM_INT);$q->bindValue(3,$after);$q->bindValue(4,$limit,PDO::PARAM_INT);$q->execute();$rows=[];$usage=0;
    $consume=static function(int $amount)use(&$usage):void{$usage+=$amount;if($usage>4*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_PAGE_TOO_LARGE');};
    try{while($row=$q->fetch()){$consume(strlen(genesisE2eeJson($row)));$rows[]=$row;}}finally{$q->closeCursor();}
    return genesisE2eeProductProofRows($db,$scope,$rows);
}
function genesisE2eeProductProofRows(PDO $db,array $scope,array $rows): array
{
    require_once __DIR__.'/e2ee-product-bootstrap.php';$bootstrap=genesisE2eeProductBootstrapReady($db,$scope);$usage=0;
    $consume=static function(int $amount)use(&$usage):void{$usage+=$amount;if($usage>4*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_PAGE_TOO_LARGE');};
    foreach($rows as $row)$consume(strlen(genesisE2eeJson($row)));
    $entities=array_map('genesisE2eeProductPublic',$rows);$proposals=[];$attestations=[];$proofs=[];$heads=[];
    $proof=static function(string $raw)use(&$proofs,$consume):string{if(strlen($raw)>4*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_PAGE_TOO_LARGE');
        $packet=json_decode($raw,true,512,JSON_THROW_ON_ERROR);$hash=genesisE2eeCommandHash($packet['command']);if(!isset($proofs[$hash])){$consume(strlen($raw)+100);$proofs[$hash]=['proofHash'=>$hash,'packet'=>$raw];}return$hash;};
    $bootstrapProof=$proof($bootstrap['commit_packet']);
    foreach($rows as $row){
        $history=genesisE2eeRow($db,'SELECT signed_command FROM e2ee_product_history WHERE scope_id=? AND generation=? AND entity_id=? AND revision=?',[$scope['scope_id'],$scope['generation'],$row['entity_id'],$row['revision']]);
        if(!$history)throw new DomainException('E2EE_PRODUCT_HISTORY_MISSING');$heads[]=['entityId'=>$row['entity_id'],'revision'=>(int)$row['revision'],'proofHash'=>$proof($history['signed_command'])];
        $p=$db->prepare('SELECT proposal_id AS proposalId,entity_id AS entityId,base_revision AS baseRevision,object_id AS objectId,payload_hash AS payloadHash,metadata_json AS metadataJson,signed_command AS signedCommand,actor_id AS actorId,created_at AS createdAt FROM e2ee_product_proposals WHERE scope_id=? AND generation=? AND entity_id=? AND (base_revision=? OR (base_revision=? AND object_id=? AND payload_hash=?)) ORDER BY proposal_id LIMIT 201');
        $p->execute([$scope['scope_id'],$scope['generation'],$row['entity_id'],$row['revision'],(int)$row['revision']-1,$row['object_id'],$row['payload_hash']]);$count=0;
        try{while($item=$p->fetch()){if(++$count>200)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_PROPOSAL_LIMIT');$item['proofHash']=$proof($item['signedCommand']);unset($item['signedCommand']);$consume(strlen(genesisE2eeJson($item)));$item['baseRevision']=(int)$item['baseRevision'];$proposals[]=$item;
            $a=$db->prepare('SELECT proposal_id AS proposalId,user_id AS userId,device_id AS deviceId,payload_hash AS payloadHash,signed_command AS signedCommand,created_at AS createdAt FROM e2ee_product_attestations WHERE scope_id=? AND generation=? AND proposal_id=? ORDER BY user_id');
            $a->execute([$scope['scope_id'],$scope['generation'],$item['proposalId']]);try{while($approval=$a->fetch()){$approval['proofHash']=$proof($approval['signedCommand']);unset($approval['signedCommand']);$consume(strlen(genesisE2eeJson($approval)));$attestations[]=$approval;}}finally{$a->closeCursor();}
        }}finally{$p->closeCursor();}
    }
    return ['entities'=>$entities,'heads'=>$heads,'proofs'=>array_values($proofs),'proposals'=>$proposals,'attestations'=>$attestations,'bootstrapProofHash'=>$bootstrapProof,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
/** Immutable user-visible history. Every row carries the same independently
 * verifiable bootstrap/command/approval proofs as a current index head. Reading
 * history never changes the live index or replays an old mutation. */
function genesisE2eeProductHistory(PDO $db,array $scope,array $payload):array
{
    genesisE2eeExactFields($payload,['entityId','before','limit']);$id=genesisE2eeIdentifier($payload['entityId']);$before=genesisE2eeInteger($payload['before'],1);$limit=genesisE2eeInteger($payload['limit'],1);
    if($limit>10)throw new InvalidArgumentException('E2EE_INVALID_LIMIT');$entity=genesisE2eeProductRow($db,$scope,$id);if(!$entity)throw new DomainException('E2EE_PRODUCT_ENTITY_MISSING');
    $q=$db->prepare('SELECT * FROM e2ee_product_history WHERE scope_id=? AND generation=? AND entity_id=? AND revision<? ORDER BY revision DESC LIMIT ?');
    $q->bindValue(1,$scope['scope_id']);$q->bindValue(2,(int)$scope['generation'],PDO::PARAM_INT);$q->bindValue(3,$id);$q->bindValue(4,$before,PDO::PARAM_INT);$q->bindValue(5,$limit,PDO::PARAM_INT);$q->execute();$rows=$q->fetchAll();$q->closeCursor();$pages=[];$usage=0;
    foreach($rows as $history){
        $command=json_decode($history['signed_command'],true,512,JSON_THROW_ON_ERROR)['command'];$source=$command;$operation=null;
        if($command['action']==='product-approve'){
            $proposal=genesisE2eeRow($db,'SELECT signed_command FROM e2ee_product_proposals WHERE scope_id=? AND generation=? AND proposal_id=?',[$scope['scope_id'],$scope['generation'],$command['payload']['proposalId']]);
            if(!$proposal)throw new DomainException('E2EE_PRODUCT_HISTORY_MISSING');$source=json_decode($proposal['signed_command'],true,512,JSON_THROW_ON_ERROR)['command'];
        }
        $operations=$source['action']==='product-bootstrap-stage'?array_column($source['payload']['items'],'operation'):($source['payload']['operations']??[]);
        foreach($operations as $candidate)if($candidate['entityId']===$id&&$candidate['expectedRevision']+1===(int)$history['revision']&&$candidate['objectId']===$history['object_id']&&$candidate['payloadHash']===$history['payload_hash']){
            if($operation!==null)throw new DomainException('E2EE_PRODUCT_HISTORY_MISSING');$operation=$candidate;
        }
        if($operation===null)throw new DomainException('E2EE_PRODUCT_HISTORY_MISSING');
        $row=$entity;$row['revision']=(int)$history['revision'];$row['domain']=$operation['domain'];$row['object_id']=$operation['objectId'];$row['payload_hash']=$operation['payloadHash'];$row['parent_id']=$operation['parentId'];$row['deleted']=$operation['action']==='delete'?1:0;$row['metadata_json']=genesisE2eeJson($operation['metadata']);$row['updated_at']=$history['created_at'];
        $page=genesisE2eeProductProofRows($db,$scope,[$row]);$usage+=strlen(genesisE2eeJson($page));if($usage>4*1024*1024)throw new GenesisResourceLimitException(413,'E2EE_PRODUCT_PAGE_TOO_LARGE');$pages[]=$page;
    }
    return ['pages'=>$pages,'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
/** No content field can enter this boundary. The staged signed version is
 * immutable; only an authorized transaction can make its reference active. */
function genesisE2eeProductReference(PDO $db,array $scope,array $operation): void
{
    if($operation['domain']!==genesisE2eeProductDomain($operation['kind'])||!is_string($operation['objectId'])||preg_match('/\Aproduct-version:[a-f0-9-]{36}\z/D',$operation['objectId'])!==1)throw new InvalidArgumentException('E2EE_PRODUCT_REFERENCE_INVALID');
    genesisE2eeDecode($operation['payloadHash'],32);$stored=genesisE2eeRow($db,'SELECT revision,payload_hash FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain=? AND object_id=?',[$scope['scope_id'],$scope['generation'],$operation['domain'],$operation['objectId']]);
    if(!$stored||(int)$stored['revision']!==1||!hash_equals($stored['payload_hash'],$operation['payloadHash']))throw new DomainException('E2EE_OBJECT_REFERENCE_MISMATCH');
}
function genesisE2eeProductPermission(string $actor,array $scope,string $kind,string $action,array|false $old): array
{
    if(!in_array($scope['kind'],['project','space'],true)||$scope['state']!=='active')throw new DomainException('E2EE_NOT_ACTIVE');
    $permission=in_array($kind,['project','space','status','category','label','workflow','review-policy','planning','sprint','automation','template','custom-field','import'],true)?'manage':
        (in_array($kind,['comment','project-comment'],true)?'comment':'write');
    if($scope['kind']==='space'){genesisE2eeAccess($actor,'space',$scope['resource_id'],$permission);return ['member_role'=>'owner','permissions'=>['manageProjects'=>true,'editTasks'=>true,'organizeTasks'=>true,'comment'=>true]];}
    $project=genesisSharedProjectAccess($scope['resource_id'],$actor,$permission,true);
    if(in_array($kind,['series','series-instance'],true))genesisSharedProjectAccess($scope['resource_id'],$actor,'organize',true);
    if(in_array($kind,['comment','project-comment'],true)&&$old&&$old['author_id']!==$actor&&!$project['permissions']['manageProjects'])throw new GenesisResourceLimitException(403,'E2EE_PRODUCT_AUTHOR_REQUIRED');
    return$project;
}
function genesisE2eeProductTaskRules(PDO $db,string $actor,array $scope,array $operation,array|false $old,array $project,bool $bound=false): void
{
    $metadata=$operation['metadata'];$before=$old?json_decode($old['metadata_json'],true,32,JSON_THROW_ON_ERROR):null;
    $approvers=$metadata['approverIds'];$oldApprovers=$before['approverIds']??[];$left=$approvers;$right=$oldApprovers;sort($left,SORT_STRING);sort($right,SORT_STRING);
    if($left!==$right&&$old&&($old['author_id']!==$actor&&!$project['permissions']['manageProjects']||($before['completed']??false)))throw new GenesisResourceLimitException(403,'E2EE_PRODUCT_APPROVERS_FORBIDDEN');
    foreach($approvers as $user)genesisSharedProjectAccess($scope['resource_id'],$user,'read',true);
    foreach($metadata['dependsOnIds'] as $id){$other=genesisE2eeProductRow($db,$scope,$id);if($id===$operation['entityId']||!$other||$other['deleted']||$other['kind']!=='task')throw new DomainException('E2EE_PRODUCT_DEPENDENCY_INVALID');}
    // A fully owner-reviewed membership transaction may clear a private
    // assignee on an already completed task. It cannot change completion,
    // status, approvers, dependencies or any other declared present field.
    $maintenance=$bound&&$operation['action']==='update'&&$old&&($before['completed']??false)&&$metadata['completed']&&$left===$right
        &&$metadata['statusId']===$before['statusId']&&$metadata['dependsOnIds']===$before['dependsOnIds']
        &&array_values(array_diff($before['presentFields'],['assigneeId']))===$metadata['presentFields'];
    if($metadata['completed']&&$approvers&&$operation['action']!=='propose-complete'&&!$maintenance)throw new DomainException('E2EE_PRODUCT_APPROVAL_REQUIRED');
    $q=$db->prepare("SELECT metadata_json FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND kind='workflow' AND deleted=0 ORDER BY entity_id");$q->execute([$scope['scope_id'],$scope['generation']]);$workflows=$q->fetchAll();$q->closeCursor();
    foreach($workflows as $row){$workflow=json_decode($row['metadata_json'],true,32,JSON_THROW_ON_ERROR);if(!$workflow['enabled'])continue;
        $target=$metadata['statusId'];$prior=$before['statusId']??null;
        $status=null;foreach($workflow['statuses'] as $entry)if($entry['statusId']===$target)$status=$entry;
        if(!$status)throw new DomainException('E2EE_PRODUCT_WORKFLOW_STATUS');
        if($target!==$prior){$allowed=false;foreach($workflow['transitions'] as $entry)if($entry['fromStatusId']===$prior&&$entry['toStatusId']===$target&&in_array($project['member_role'],$entry['roles'],true))$allowed=true;
            if(!$allowed)throw new GenesisResourceLimitException(403,'E2EE_PRODUCT_WORKFLOW_TRANSITION');
            if($status['wipLimit']!==null){$count=genesisE2eeRow($db,"SELECT COUNT(*) AS n FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND kind='task' AND deleted=0 AND entity_id<>? AND json_extract(metadata_json,'$.statusId')=?",[$scope['scope_id'],$scope['generation'],$operation['entityId'],$target]);
                if((int)$count['n']>=$status['wipLimit'])throw new DomainException('E2EE_PRODUCT_WIP_LIMIT');}}
        if(array_diff($status['requiredFields'],$metadata['presentFields']))throw new DomainException('E2EE_PRODUCT_REQUIRED_FIELDS');
    }
}
function genesisE2eeProductSave(PDO $db,array $scope,array $operation,string $author,string $actor,array $packet): array
{
    $revision=$operation['expectedRevision']+1;$now=genesisNow();$deleted=$operation['action']==='delete';$json=genesisE2eeJson($operation['metadata']);
    $db->prepare('INSERT INTO e2ee_product_entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_id,generation,entity_id) DO UPDATE SET revision=excluded.revision,domain=excluded.domain,object_id=excluded.object_id,payload_hash=excluded.payload_hash,parent_id=excluded.parent_id,deleted=excluded.deleted,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at')
        ->execute([$scope['scope_id'],$scope['generation'],$operation['entityId'],$operation['kind'],$revision,$operation['domain'],$operation['objectId'],$operation['payloadHash'],$operation['parentId'],$author,(int)$deleted,$json,$now]);
    $db->prepare('INSERT INTO e2ee_product_history VALUES(?,?,?,?,?,?,?,?,?,?)')->execute([$scope['scope_id'],$scope['generation'],$operation['entityId'],$revision,$operation['objectId'],$operation['payloadHash'],$json,$actor,genesisE2eeJson($packet),$now]);
    return ['entityId'=>$operation['entityId'],'revision'=>$revision,'payloadHash'=>$operation['payloadHash']];
}
function genesisE2eeProductCommit(PDO $db,string $actor,array $scope,array $payload,array $packet): array
{
    genesisSharedRequireEnabled($actor);
    $bound=($packet['command']['action']??null)==='product-commit-bound';genesisE2eeExactFields($payload,['intentId','operations',...($bound?['membershipHash']:[])]);genesisE2eeIdentifier($payload['intentId']);if($bound)genesisE2eeDecode($payload['membershipHash'],32);
    if(!is_array($payload['operations'])||!array_is_list($payload['operations'])||count($payload['operations'])<1||count($payload['operations'])>100)throw new InvalidArgumentException('E2EE_PRODUCT_BATCH_INVALID');
    $seen=[];$results=[];
    foreach($payload['operations'] as $operation){
        genesisE2eeExactFields($operation,['action','entityId','kind','expectedRevision','domain','objectId','payloadHash','parentId','metadata','proposalId']);$id=genesisE2eeIdentifier($operation['entityId']);
        if(isset($seen[$id])||!in_array($operation['kind'],GENESIS_E2EE_PRODUCT_KINDS,true)||!in_array($operation['action'],['create','update','delete','restore','propose-complete'],true))throw new InvalidArgumentException('E2EE_PRODUCT_BATCH_INVALID');$seen[$id]=true;
        if($scope['kind']==='space'&&in_array($operation['kind'],['task','status','workflow','review-policy','planning','sprint','series','series-instance','automation','automation-run','custom-field-value'],true)
            ||$scope['kind']==='project'&&$operation['kind']==='space')throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
        genesisE2eeInteger($operation['expectedRevision']);$metadata=genesisE2eeProductMetadata($operation['kind'],$operation['metadata']);$old=genesisE2eeProductRow($db,$scope,$id);
        if(($old?(int)$old['revision']:0)!==$operation['expectedRevision']||($old&&$old['kind']!==$operation['kind'])||($old===false)!==($operation['action']==='create'))throw new DomainException('E2EE_PRODUCT_REVISION_CONFLICT');
        if($old&&$old['deleted']&&$operation['action']!=='restore'||$old&&!$old['deleted']&&$operation['action']==='restore')throw new DomainException('E2EE_PRODUCT_DELETED');
        $project=genesisE2eeProductPermission($actor,$scope,$operation['kind'],$operation['action'],$old);genesisE2eeProductReference($db,$scope,$operation);
        if($operation['parentId']!==null){$parent=genesisE2eeProductRow($db,$scope,genesisE2eeIdentifier($operation['parentId']));
            $retainedHistory=$bound&&$operation['kind']==='history'&&$operation['action']==='create'&&$scope['kind']==='project'&&$operation['parentId']==='project:'.$scope['resource_id'];
            if(!$parent||$parent['deleted']&&!$retainedHistory||$operation['parentId']===$id)throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');}
        if($operation['kind']==='history'&&(!$bound||$operation['action']!=='create'||$scope['kind']!=='project'||$operation['parentId']!=='project:'.$scope['resource_id']))throw new DomainException('E2EE_PRODUCT_HISTORY_FORBIDDEN');
        require_once __DIR__.'/e2ee-client-execution.php';genesisE2eeClientExecutionOperation($db,$actor,$scope,$operation,$old,$project,$payload['operations']);
        if($operation['kind']==='task')genesisE2eeProductTaskRules($db,$actor,$scope,$operation,$old,$project,$bound);
        if($operation['kind']==='project'){
            require_once __DIR__.'/e2ee-project-topology.php';genesisE2eeProjectRootMutation($db,$actor,$scope,$operation,$old);
        }
        if(!$old){$count=genesisE2eeRow($db,'SELECT COUNT(*) AS n FROM e2ee_product_entities WHERE scope_id=? AND generation=?',[$scope['scope_id'],$scope['generation']]);if((int)$count['n']>=10000)throw new GenesisResourceLimitException(413,'E2EE_SCOPE_OBJECT_LIMIT');}
        if($operation['action']==='propose-complete'){
            if(!$old||$old['kind']!=='task'||!$metadata['completed']||!$metadata['approverIds']||$operation['parentId']!==$old['parent_id'])throw new DomainException('E2EE_PRODUCT_APPROVAL_INVALID');genesisE2eeIdentifier($operation['proposalId']);
            $prior=genesisE2eeRow($db,'SELECT * FROM e2ee_product_proposals WHERE scope_id=? AND generation=? AND proposal_id=?',[$scope['scope_id'],$scope['generation'],$operation['proposalId']]);
            if($prior)throw new DomainException('E2EE_PRODUCT_PROPOSAL_IMMUTABLE');
            $db->prepare('INSERT INTO e2ee_product_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?)')->execute([$scope['scope_id'],$scope['generation'],$operation['proposalId'],$id,$old['revision'],$operation['objectId'],$operation['payloadHash'],genesisE2eeJson($metadata),$actor,genesisE2eeJson($packet),genesisNow()]);
            $results[]=['entityId'=>$id,'proposalId'=>$operation['proposalId'],'revision'=>(int)$old['revision'],'payloadHash'=>$operation['payloadHash']];
        }else{if($operation['proposalId']!==null)throw new InvalidArgumentException('E2EE_PRODUCT_BATCH_INVALID');$results[]=genesisE2eeProductSave($db,$scope,$operation,$old?$old['author_id']:$actor,$actor,$packet);}
    }
    // Parent/dependency cycles are checked against the transaction's final
    // projection, so a partially applied multi-row operation never escapes.
    $q=$db->prepare("SELECT entity_id,parent_id,metadata_json FROM e2ee_product_entities WHERE scope_id=? AND generation=? AND deleted=0 AND kind<>'history'");$q->execute([$scope['scope_id'],$scope['generation']]);$rows=$q->fetchAll();$q->closeCursor();$edges=[];
    foreach($rows as $row){$meta=json_decode($row['metadata_json'],true,32,JSON_THROW_ON_ERROR);$edges[$row['entity_id']]=array_merge($row['parent_id']===null?[]:[$row['parent_id']],$meta['dependsOnIds']??[]);}
    $degrees=[];$reverse=[];$ready=[];foreach($edges as $id=>$links){$links=array_values(array_unique($links));$degrees[$id]=count($links);if(!$links)$ready[]=$id;
        foreach($links as $next){if(!isset($edges[$next]))throw new DomainException('E2EE_PRODUCT_DEPENDENCY_INVALID');$reverse[$next][]=$id;}}
    $visited=0;for($index=0;$index<count($ready);$index++){$visited++;foreach($reverse[$ready[$index]]??[] as $id)if(--$degrees[$id]===0)$ready[]=$id;}
    if($visited!==count($edges))throw new DomainException('E2EE_PRODUCT_DEPENDENCY_CYCLE');return ['intentId'=>$payload['intentId'],'results'=>$results];
}
function genesisE2eeProductApprove(PDO $db,string $actor,array $scope,array $payload,array $packet): array
{
    genesisSharedRequireEnabled($actor);if($scope['kind']!=='project'||$scope['state']!=='active')throw new DomainException('E2EE_NOT_ACTIVE');
    genesisE2eeExactFields($payload,['intentId','proposalId','entityId','baseRevision','payloadHash']);genesisE2eeIdentifier($payload['intentId']);genesisE2eeIdentifier($payload['proposalId']);genesisE2eeIdentifier($payload['entityId']);genesisE2eeInteger($payload['baseRevision'],1);genesisE2eeDecode($payload['payloadHash'],32);
    genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'read');$proposal=genesisE2eeRow($db,'SELECT * FROM e2ee_product_proposals WHERE scope_id=? AND generation=? AND proposal_id=?',[$scope['scope_id'],$scope['generation'],$payload['proposalId']]);$old=genesisE2eeProductRow($db,$scope,$payload['entityId']);
    if(!$proposal||!$old||$old['deleted']||$proposal['entity_id']!==$payload['entityId']||(int)$proposal['base_revision']!==$payload['baseRevision']||(int)$old['revision']!==$payload['baseRevision']||!hash_equals($proposal['payload_hash'],$payload['payloadHash']))throw new DomainException('E2EE_PRODUCT_PROPOSAL_STALE');
    $origin=json_decode($proposal['signed_command'],true,512,JSON_THROW_ON_ERROR)['command'];if($origin['securityEpoch']!==(int)$scope['security_epoch'])throw new DomainException('E2EE_PRODUCT_PROPOSAL_STALE');
    $metadata=json_decode($proposal['metadata_json'],true,32,JSON_THROW_ON_ERROR);if(!in_array($actor,$metadata['approverIds'],true))throw new GenesisResourceLimitException(403,'E2EE_PRODUCT_APPROVER_REQUIRED');
    $db->prepare('INSERT OR IGNORE INTO e2ee_product_attestations VALUES(?,?,?,?,?,?,?,?)')->execute([$scope['scope_id'],$scope['generation'],$payload['proposalId'],$actor,$packet['command']['deviceId'],$payload['payloadHash'],genesisE2eeJson($packet),genesisNow()]);
    $q=$db->prepare('SELECT user_id FROM e2ee_product_attestations WHERE scope_id=? AND generation=? AND proposal_id=? AND payload_hash=?');$q->execute([$scope['scope_id'],$scope['generation'],$payload['proposalId'],$payload['payloadHash']]);$approved=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
    $remaining=array_values(array_diff($metadata['approverIds'],$approved));
    if(!$remaining){foreach($metadata['approverIds'] as $user)genesisE2eeAccess($user,$scope['kind'],$scope['resource_id'],'read');
        $operation=['action'=>'update','entityId'=>$old['entity_id'],'kind'=>'task','expectedRevision'=>(int)$old['revision'],'domain'=>'shared-project','objectId'=>$proposal['object_id'],'payloadHash'=>$proposal['payload_hash'],'parentId'=>$old['parent_id'],'metadata'=>$metadata];
        $project=genesisE2eeProductPermission($proposal['actor_id'],$scope,'task','update',$old);$checked=$operation;$checked['action']='propose-complete';genesisE2eeProductTaskRules($db,$proposal['actor_id'],$scope,$checked,$old,$project);
        genesisE2eeProductReference($db,$scope,$operation);genesisE2eeProductSave($db,$scope,$operation,$old['author_id'],$actor,$packet);}
    return ['intentId'=>$payload['intentId'],'proposalId'=>$payload['proposalId'],'entityId'=>$payload['entityId'],'completed'=>!$remaining,'remaining'=>$remaining];
}
function genesisE2eeProductService(PDO $db,string $actor,array $scope,array $command,array $packet): array
{
    require_once __DIR__.'/e2ee-product-bootstrap.php';genesisE2eeProductBootstrapReady($db,$scope);
    $payload=$command['payload'];$id=genesisE2eeIdentifier($payload['intentId']??null);$hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($payload),true)),'+/','-_'),'=');
    $old=genesisE2eeRow($db,'SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action=? AND intent_id=?',[$scope['scope_id'],$actor,$command['action'],$id]);
    if($old){if(!hash_equals($old['payload_hash'],$hash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');return json_decode($old['result_json'],true,512,JSON_THROW_ON_ERROR);}
    $result=match($command['action']){'product-commit','product-commit-bound'=>genesisE2eeProductCommit($db,$actor,$scope,$payload,$packet),'product-approve'=>genesisE2eeProductApprove($db,$actor,$scope,$payload,$packet),default=>throw new InvalidArgumentException('E2EE_UNKNOWN_ACTION')};
    $db->prepare('INSERT INTO e2ee_service_intents VALUES(?,?,?,?,?,?)')->execute([$scope['scope_id'],$actor,$command['action'],$id,$hash,genesisE2eeJson($result)]);return$result;
}
