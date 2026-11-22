<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-membership.php';

/** Pure technical operation format shared with membership-operation-plan.ts.
 * Private titles, task bodies and keys are never accepted through this codec. */
function genesisMembershipPermissions(mixed $input):array
{
    $value=genesisE2eeExactFields($input,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);
    foreach($value as $allowed)if(!is_bool($allowed))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');return $value;
}
function genesisMembershipOperation(mixed $input,bool $header=false):array
{
    if(!is_array($input)||array_is_list($input))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');$kind=$input['kind']??null;
    $fields=match($kind){
        'project-role'=>['kind','projectId','userId','role'],'project-remove'=>['kind','projectId','userId'],
        'space-role'=>['kind','spaceId','userId','role',...(array_key_exists('permissions',$input)?['permissions']:[]),...(array_key_exists('canOrganizeTasks',$input)?['canOrganizeTasks']:[])],
        'member-permissions'=>['kind','spaceId','userId','categoryId','permissions'],
        'project-grants'=>['kind','spaceId','userId','allProjects',...($header?[]:['grants'])],
        'category-permissions'=>['kind','spaceId','categoryId','expectedRevision','permissions'],
        default=>throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID')};
    genesisE2eeExactFields($input,$fields);foreach(['projectId','spaceId','userId'] as $name)if(array_key_exists($name,$input))genesisE2eeIdentifier($input[$name]);
    if(array_key_exists('categoryId',$input)&&($kind==='category-permissions'||$input['categoryId']!==null))genesisE2eeIdentifier($input['categoryId']);
    if($kind==='project-role'&&!in_array($input['role'],['manager','member','commenter','viewer'],true)
        ||$kind==='space-role'&&!in_array($input['role'],['admin','member','guest'],true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');
    if(array_key_exists('permissions',$input)&&$input['permissions']!==null)genesisMembershipPermissions($input['permissions']);
    if(array_key_exists('canOrganizeTasks',$input)&&!is_bool($input['canOrganizeTasks'])
        ||$kind==='member-permissions'&&$input['categoryId']===null&&$input['permissions']===null
        ||$kind==='category-permissions'&&$input['permissions']===null)throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');
    if($kind==='category-permissions')genesisE2eeInteger($input['expectedRevision']);
    if($kind==='project-grants'){
        if(!is_bool($input['allProjects']))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');
        if(!$header){
            if(!is_array($input['grants'])||!array_is_list($input['grants'])||count($input['grants'])>5000||$input['allProjects']&&$input['grants'])throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');
            $seen=[];foreach($input['grants'] as $row){genesisMembershipOperationGrant($row);if(isset($seen[$row['projectId']]))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');$seen[$row['projectId']]=true;}
        }
    }return $input;
}
function genesisMembershipOperationGrant(mixed $input):array
{
    $row=genesisE2eeExactFields($input,['projectId','role','includeDescendants']);genesisE2eeIdentifier($row['projectId']);
    if(!in_array($row['role'],['member','commenter','viewer','none'],true)||!is_bool($row['includeDescendants']))throw new InvalidArgumentException('E2EE_MEMBERSHIP_OPERATION_INVALID');return $row;
}
function genesisMembershipOperationCoordinate(string $table,array $key):string
{
    ksort($key,SORT_STRING);return $table."\0".genesisE2eeJson(array_map(static fn($name,$value)=>[$name,$value],array_keys($key),array_values($key)));
}
/** Caller holds a read/write transaction. SQL provides routing/technical
 * authority only; clients additionally pin/decrypt these normal root heads. */
function genesisMembershipOperationSnapshot(PDO $db,string $actor,string $space,array $operation):array
{
    if(!$db->inTransaction())throw new LogicException('E2EE_TRANSACTION_CONTEXT_INVALID');$graph=genesisE2eeMembershipGraph($actor,['spaceId'=>$space]);
    $scopeRoot=static function(string $kind,string $resource,?string $id)use($db):array{
        if($id===null)throw new DomainException('E2EE_SHARED_TRANSITION_REQUIRED');$scope=genesisE2eeRow($db,'SELECT * FROM e2ee_scopes WHERE scope_id=?',[$id]);
        if(!$scope||$scope['kind']!==$kind||$scope['resource_id']!==$resource||!in_array($scope['state'],['active','retirement'],true))throw new DomainException('E2EE_SHARED_TRANSITION_REQUIRED');
        $root=genesisE2eeProductRow($db,$scope,$kind.':'.$resource);if(!$root||$root['kind']!==$kind)throw new DomainException('E2EE_PRODUCT_ENTITY_MISSING');
        return ['scope'=>['scopeId'=>$id,'ownerId'=>$scope['owner_id'],'state'=>$scope['state'],'root'=>['scopeId'=>$id,'entityId'=>$root['entity_id'],'generation'=>(int)$scope['generation'],
            'directoryRevision'=>(int)$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash'],'revision'=>(int)$root['revision'],'payloadHash'=>$root['payload_hash']]],'root'=>$root];
    };
    $opened=$scopeRoot('space',$space,$graph['spaceScopeId']);if($opened['root']['deleted'])throw new DomainException('E2EE_MEMBERSHIP_STALE');$projects=[];
    foreach($graph['projects'] as $row){
        $project=$scopeRoot('project',$row['id'],$row['scopeId']);$metadata=json_decode($project['root']['metadata_json'],true,32,JSON_THROW_ON_ERROR);
        if(($metadata['protocol']??null)!==2||$metadata['spaceId']!==$space||$metadata['parentProjectId']!==$row['parentId']||$metadata['isInbox']!==$row['isInbox']
            ||$metadata['archived']!==$row['archived']||(bool)$project['root']['deleted']!==$row['inTrash'])throw new DomainException('E2EE_MEMBERSHIP_STALE');
        $projects[]=['id'=>$row['id'],'parentId'=>$row['parentId'],'isInbox'=>$row['isInbox'],'archived'=>$row['archived'],'inTrash'=>$row['inTrash'],'scope'=>$project['scope']];
    }
    $byId=[];foreach($projects as $project)$byId[$project['id']]=$project;
    if(count(array_filter($projects,static fn($row)=>$row['isInbox']))!==1)throw new DomainException('E2EE_MEMBERSHIP_STALE');$done=[];
    foreach($projects as $project){if($project['parentId']!==null&&!isset($byId[$project['parentId']])||$project['isInbox']&&$project['parentId']!==null)throw new DomainException('E2EE_MEMBERSHIP_STALE');
        $id=$project['id'];$path=[];while($id!==null&&!isset($done[$id])){if(isset($path[$id]))throw new DomainException('E2EE_PRODUCT_DEPENDENCY_CYCLE');$path[$id]=true;$id=$byId[$id]['parentId'];}foreach($path as $id=>$_)$done[$id]=true;
    }
    $rows=[];$read=static function(string $table,array $key)use($db,&$rows):void{
        if(count($rows)>=1000000)throw new GenesisResourceLimitException(413,'E2EE_MEMBERSHIP_SNAPSHOT_TOO_LARGE');$spec=genesisE2eeAclSpec($table);
        $where=implode(' AND ',array_map(static fn($name)=>'"'.$name.'"=?',$spec['keys']));$before=genesisE2eeRow($db,'SELECT * FROM "'.$table.'" WHERE '.$where,array_map(static fn($name)=>$key[$name],$spec['keys']));
        $rows[]=['table'=>$table,'key'=>$key,'before'=>$before?genesisE2eeAclTechnical($before,$spec):null,'beforeHash'=>genesisE2eeAclBeforeHash($before,$spec)];
    };
    foreach($graph['spaceUserIds'] as $user)$read('shared_space_members',['space_id'=>$space,'user_id'=>$user]);
    $complete=[$actor=>true];if(array_key_exists('userId',$operation))$complete[$operation['userId']]=true;
    if($operation['kind']==='category-permissions')foreach($rows as $row)if(($row['before']['member_category_id']??null)===$operation['categoryId']&&($row['before']['role']??null)!=='owner')$complete[$row['key']['user_id']]=true;
    if(array_key_exists('categoryId',$operation)&&$operation['categoryId']!==null)$read('shared_member_categories',['id'=>$operation['categoryId'],'space_id'=>$space]);
    $users=array_keys($complete);sort($users,SORT_STRING);foreach($users as $user){if(!in_array($user,$graph['spaceUserIds'],true))throw new DomainException('E2EE_MEMBERSHIP_STALE');foreach($projects as $project){
        $read('shared_project_members',['project_id'=>$project['id'],'user_id'=>$user]);$read('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project['id']]);
    }}
    return ['format'=>'genesis-membership-operation-snapshot-v1','actorId'=>$actor,'spaceId'=>$space,'spaceScope'=>$opened['scope'],'projects'=>$projects,'spaceUserIds'=>$graph['spaceUserIds'],'completeUserIds'=>$users,'rows'=>$rows];
}
function genesisMembershipOperationFingerprint(array $snapshot,array $operation):string
{
    $pageHashes=static function(array $items):array{$hashes=[];foreach(array_chunk($items,200)as $page)$hashes[]=genesisMembershipAtomicDigest($page);return ['count'=>count($items),'pages'=>$hashes];};
    $hashes=[];foreach(array_chunk($snapshot['rows'],200)as $page)$hashes[]=genesisMembershipAtomicDigest(array_map(static fn($row)=>['table'=>$row['table'],'key'=>genesisE2eeMembershipFields($row['key']),'beforeHash'=>$row['beforeHash']],$page));
    $snapshot['projects']=$pageHashes($snapshot['projects']);$count=count($snapshot['rows']);$snapshot['rows']=['count'=>$count,'pages'=>$hashes];
    return genesisMembershipAtomicDigest(['format'=>'genesis-membership-operation-review-v1','operation'=>$operation,'snapshot'=>$snapshot]);
}
function genesisMembershipDefaultPermissions(string $role):array
{
    $manager=in_array($role,['owner','admin'],true);$project=$manager?'manager':($role==='guest'?'viewer':'member');
    return ['createProjects'=>$role!=='guest','editTasks'=>in_array($project,['owner','manager','member'],true),'organizeTasks'=>$manager,
        'comment'=>in_array($project,['owner','manager','member','commenter'],true),'manageProjects'=>$manager,'inviteMembers'=>$manager];
}
/** Pure matching normal semantics. The snapshot is built inside the final
 * writer; no legacy plaintext mutation or generic SQL bypass is invoked. */
function genesisMembershipOperationPlan(array $snapshot,array $rawOperation):array
{
    $operation=genesisMembershipOperation($rawOperation);$space=$snapshot['spaceId'];$projects=[];
    foreach($snapshot['projects'] as $project)$projects[$project['id']]=$project;
    if(array_key_exists('spaceId',$operation)&&$operation['spaceId']!==$space||array_key_exists('projectId',$operation)&&!isset($projects[$operation['projectId']]))throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
    $original=[];$after=[];foreach($snapshot['rows'] as $row){$key=genesisMembershipOperationCoordinate($row['table'],$row['key']);if(isset($original[$key]))throw new DomainException('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');$original[$key]=$row;$after[$key]=$row['before'];}
    $assignments=[];$revokes=[];$events=[];
    $read=static function(string $table,array $key)use(&$original,&$after):?array{$id=genesisMembershipOperationCoordinate($table,$key);if(!array_key_exists($id,$original))throw new DomainException('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');return $after[$id];};
    $put=static function(string $table,array $key,?array $value)use(&$original,&$after):void{$id=genesisMembershipOperationCoordinate($table,$key);if(!array_key_exists($id,$original))throw new DomainException('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');$after[$id]=$value===null?null:array_replace($key,$value);};
    $fields=static fn(string $table,array $row):array=>array_intersect_key($row,array_fill_keys(genesisE2eeAclSpec($table)['fields'],true));
    $sm=static fn(string $user):?array=>$read('shared_space_members',['space_id'=>$space,'user_id'=>$user]);
    $member=static fn(string $project,string $user):?array=>$read('shared_project_members',['project_id'=>$project,'user_id'=>$user]);
    $grant=static fn(string $project,string $user):?array=>$read('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project]);
    $complete=static function(string $user)use($snapshot):void{if(!in_array($user,$snapshot['completeUserIds'],true))throw new DomainException('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');};
    $revoke=static function(string $kind,string $resource,string $user)use(&$revokes):void{$revokes[$kind."\0".$resource."\0".$user]=['kind'=>$kind,'resourceId'=>$resource,'userId'=>$user];};
    $setMember=static function(string $project,string $user,?string $role)use($complete,$member,$put,$revoke,&$assignments,&$events):void{
        $complete($user);$before=$member($project,$user);$old=$before['role']??null;if($old===$role)return;
        if($old==='owner'||$role==='owner')throw new DomainException('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');
        $put('shared_project_members',['project_id'=>$project,'user_id'=>$user],$role===null?null:['role'=>$role]);
        if($role===null)$assignments[$project."\0".$user]=['projectId'=>$project,'userId'=>$user];$revoke('project',$project,$user);
        $key=$project."\0".$user;$first=$events[$key]??null;$events[$key]=['projectId'=>$project,'userId'=>$user,'from'=>$first?$first['from']:$old,'to'=>$role];
    };
    $recompute=static function(string $user)use($sm,$complete,$projects,$grant,$setMember):void{
        $spaceMember=$sm($user);if(!$spaceMember||$spaceMember['project_access_restricted']!==1||in_array($spaceMember['role'],['owner','admin'],true))return;$complete($user);
        $children=[];foreach($projects as $project)$children[$project['parentId']??''][]=$project['id'];$stack=[];foreach($children['']??[] as $id)$stack[]=['id'=>$id,'inherited'=>null];
        while($stack){$row=array_pop($stack);$id=$row['id'];$rule=$grant($id,$user);$own=$rule?($rule['excluded']===1?null:$rule['role']):null;
            $setMember($id,$user,$rule?$own:$row['inherited']);$next=$rule&&$rule['include_descendants']===1?$own:$row['inherited'];
            foreach($children[$id]??[] as $child)$stack[]=['id'=>$child,'inherited'=>$next];
        }
    };
    $actorSpace=$sm($snapshot['actorId']);if(!$actorSpace)throw new DomainException('E2EE_OWNER_REQUIRED');
    if(in_array($operation['kind'],['project-role','project-remove'],true)){
        $project=$projects[$operation['projectId']];$user=$operation['userId'];if($project['isInbox'])throw new DomainException('INBOX_MEMBERSHIP_MANAGED_BY_SPACE');$complete($user);
        $actor=$member($project['id'],$snapshot['actorId']);$target=$member($project['id'],$user);$spaceMember=$sm($user);
        if(!$target||!$spaceMember)throw new DomainException('E2EE_MEMBERSHIP_STALE');if(($actor['role']??null)!=='owner')throw new DomainException('E2EE_OWNER_REQUIRED');
        if($operation['kind']==='project-role'){
            $setMember($project['id'],$user,$operation['role']);if($spaceMember['project_access_restricted']===1){
                if(!in_array($operation['role'],['member','commenter','viewer'],true))throw new DomainException('PROJECT_ACCESS_MANAGER_UNRESTRICTED');$old=$grant($project['id'],$user);
                $put('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project['id']],['role'=>$operation['role'],'include_descendants'=>$old['include_descendants']??0,'excluded'=>0]);
            }$recompute($user);
        }else{
            $setMember($project['id'],$user,null);$other=0;foreach($projects as $row)if(!$row['isInbox']&&$member($row['id'],$user)!==null)$other++;
            if($other===0&&$spaceMember['role']==='guest'){
                foreach($projects as $row)if($row['isInbox'])$setMember($row['id'],$user,null);$put('shared_space_members',['space_id'=>$space,'user_id'=>$user],null);$revoke('space',$space,$user);
                foreach($projects as $row)if($grant($row['id'],$user))$put('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$row['id']],null);
            }elseif($spaceMember['project_access_restricted']===1){$old=$grant($project['id'],$user);$put('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project['id']],['role'=>$old['role']??'viewer','include_descendants'=>1,'excluded'=>1]);}
            else $put('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project['id']],null);
            $recompute($user);
        }
    }else{
        if($actorSpace['role']!=='owner')throw new DomainException('E2EE_OWNER_REQUIRED');
        if($operation['kind']==='category-permissions'){
            $key=['id'=>$operation['categoryId'],'space_id'=>$space];$before=$read('shared_member_categories',$key);if(($before['revision']??0)!==$operation['expectedRevision'])throw new DomainException('E2EE_MEMBERSHIP_STALE');
            $json=genesisE2eeJson($operation['permissions']);$put('shared_member_categories',$key,['permissions_json'=>$json,'revision'=>$operation['expectedRevision']+1]);
            foreach($snapshot['spaceUserIds'] as $user){$spaceMember=$sm($user);if($spaceMember&&$spaceMember['role']!=='owner'&&$spaceMember['member_category_id']===$operation['categoryId']){
                $complete($user);$put('shared_space_members',['space_id'=>$space,'user_id'=>$user],array_replace($fields('shared_space_members',$spaceMember),['permissions_json'=>$json,'can_organize_tasks'=>$operation['permissions']['organizeTasks']?1:0]));$revoke('space',$space,$user);
            }}
        }else{
            $user=$operation['userId'];$complete($user);$spaceMember=$sm($user);if(!$spaceMember)throw new DomainException('E2EE_MEMBERSHIP_STALE');if($spaceMember['role']==='owner')throw new DomainException('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');
            if($operation['kind']==='space-role'){
                $changed=$spaceMember['role']!==$operation['role'];$manual=$changed||array_key_exists('permissions',$operation)||array_key_exists('canOrganizeTasks',$operation);
                $permissionJson=array_key_exists('permissions',$operation)?($operation['permissions']===null?null:genesisE2eeJson($operation['permissions'])):($changed?genesisE2eeJson(genesisMembershipDefaultPermissions($operation['role'])):$spaceMember['permissions_json']);
                $organize=array_key_exists('canOrganizeTasks',$operation)?($operation['canOrganizeTasks']?1:0):$spaceMember['can_organize_tasks'];
                $put('shared_space_members',['space_id'=>$space,'user_id'=>$user],array_replace($fields('shared_space_members',$spaceMember),['role'=>$operation['role'],'permissions_json'=>$permissionJson,'can_organize_tasks'=>$organize,'member_category_id'=>$manual?null:$spaceMember['member_category_id']]));
                if($changed||$permissionJson!==$spaceMember['permissions_json']||$organize!==$spaceMember['can_organize_tasks'])$revoke('space',$space,$user);
                if($operation['role']==='admin')foreach($projects as $project)if($member($project['id'],$user)===null)$setMember($project['id'],$user,'manager');
                foreach($projects as $project)if($project['isInbox']){if($operation['role']==='guest')$assignments[$project['id']."\0".$user]=['projectId'=>$project['id'],'userId'=>$user];$setMember($project['id'],$user,$operation['role']==='guest'?null:'member');}$recompute($user);
            }elseif($operation['kind']==='member-permissions'){
                $value=$operation['categoryId']===null?$operation['permissions']:($read('shared_member_categories',['id'=>$operation['categoryId'],'space_id'=>$space])['permissions_json']??null);
                $chosen=genesisMembershipPermissions(is_string($value)?json_decode($value,true,16,JSON_THROW_ON_ERROR):$value);
                $put('shared_space_members',['space_id'=>$space,'user_id'=>$user],array_replace($fields('shared_space_members',$spaceMember),['member_category_id'=>$operation['categoryId'],'permissions_json'=>is_string($value)?$value:genesisE2eeJson($chosen),'can_organize_tasks'=>$chosen['organizeTasks']?1:0]));$revoke('space',$space,$user);
            }else{
                if($spaceMember['role']==='admin')throw new DomainException('PROJECT_ACCESS_MANAGER_UNRESTRICTED');
                $put('shared_space_members',['space_id'=>$space,'user_id'=>$user],array_replace($fields('shared_space_members',$spaceMember),['all_projects'=>$operation['allProjects']?1:0,'project_access_restricted'=>$operation['allProjects']?0:1,'project_access_revision'=>$spaceMember['project_access_revision']+1]));
                $desired=[];foreach($operation['grants'] as $rule){if(!isset($projects[$rule['projectId']]))throw new DomainException('E2EE_PRODUCT_PARENT_INVALID');$desired[$rule['projectId']]=$rule;}
                foreach($projects as $project){$rule=$desired[$project['id']]??null;$put('shared_member_project_grants',['space_id'=>$space,'user_id'=>$user,'project_id'=>$project['id']],$rule?['role'=>$rule['role']==='none'?'viewer':$rule['role'],'include_descendants'=>$rule['includeDescendants']?1:0,'excluded'=>$rule['role']==='none'?1:0]:null);}
                if($operation['allProjects'])foreach($projects as $project)$setMember($project['id'],$user,($member($project['id'],$user)['role']??null)==='owner'?'owner':($spaceMember['role']==='guest'?'viewer':'member'));else $recompute($user);
                $revoke('space',$space,$user);
            }
        }
    }
    $changes=[];foreach($original as $id=>$source){$next=$after[$id];if(genesisE2eeAclRow($source['before'])!==genesisE2eeAclRow($next))$changes[]=['table'=>$source['table'],'key'=>$source['key'],'expectedHash'=>$source['beforeHash'],'after'=>$next===null?null:$fields($source['table'],$next)];}
    $required=[];$add=static function(?array $scope)use(&$required):void{if(!$scope||!in_array($scope['state'],['active','retirement'],true))throw new DomainException('E2EE_SHARED_TRANSITION_REQUIRED');$old=$required[$scope['scopeId']]??null;if($old&&$old!==$scope)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');$required[$scope['scopeId']]=$scope;};
    $addSpace=static function()use($snapshot,$projects,$add):void{$add($snapshot['spaceScope']);foreach($projects as $project)$add($project['scope']);};
    foreach($changes as $row)if($row['table']==='shared_project_members')$add($projects[$row['key']['project_id']]['scope']);else $addSpace();
    foreach($assignments as $row)$add($projects[$row['projectId']]['scope']);foreach($events as $row)$add($projects[$row['projectId']]['scope']);foreach($revokes as $row)if($row['kind']==='project')$add($projects[$row['resourceId']]['scope']);else $addSpace();
    ksort($required,SORT_STRING);return ['format'=>'genesis-membership-operation-plan-v1','operation'=>$operation,'changes'=>$changes,'scopeIds'=>array_keys($required),'requiredScopes'=>array_values($required),
        'clearAssignments'=>array_values($assignments),'revokeInvitations'=>array_values($revokes),'roleEvents'=>array_values($events)];
}
