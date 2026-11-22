<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-membership-hash.php';

function genesisE2eeAclBindings(): WeakMap {static $bindings;return $bindings??=new WeakMap();}
function genesisE2eeAclRow(mixed $value): mixed
{
    if($value===null)return null;if(!is_array($value)||array_is_list($value))throw new LogicException('E2EE_ACL_ROW_INVALID');ksort($value,SORT_STRING);return$value;
}
function genesisE2eeAclPermitKey(string $table,string $verb,mixed $before,mixed $after): string
{
    return hash('sha256',genesisE2eeJson([$table,$verb,genesisE2eeAclRow($before),genesisE2eeAclRow($after)]));
}
/** SQL callbacks never query the database or trust a request boolean. Only the
 * exact before/after rows prepared by the verified batch are admitted. */
function genesisE2eeRegisterAclGuard(PDO $db): void
{
    $bindings=genesisE2eeAclBindings();
    $db->sqliteCreateFunction('genesis_e2ee_acl_allowed',static function(string $table,string $verb,?string $before,?string $after)use($db,$bindings):int{
        $permitted=$bindings[$db]??[];if(!$permitted)return 0;
        $key=genesisE2eeAclPermitKey($table,$verb,$before===null?null:json_decode($before,true,32,JSON_THROW_ON_ERROR),$after===null?null:json_decode($after,true,32,JSON_THROW_ON_ERROR));
        return isset($permitted[$key])?1:0;
    },4);
}
function genesisE2eeAclTriggerJson(PDO $db,string $table,string $row): string
{
    if(!in_array($table,['shared_project_members','shared_space_members','shared_member_categories','shared_member_project_grants'],true)||!in_array($row,['OLD','NEW'],true))throw new LogicException('E2EE_ACL_ROW_INVALID');
    $columns=$db->query('PRAGMA table_info("'.$table.'")')->fetchAll();$pairs=[];
    foreach($columns as $column){$name=$column['name'];if(!preg_match('/\A[a-z_]+\z/D',$name))throw new LogicException('E2EE_ACL_ROW_INVALID');$pairs[]="'$name'";$pairs[]=$row.'."'.$name.'"';}
    return'json_object('.implode(',',$pairs).')';
}
function genesisE2eeAclSpec(string $table): array
{
    return match($table){
        'shared_project_members'=>['keys'=>['project_id','user_id'],'fields'=>['role'],'space'=>false],
        'shared_space_members'=>['keys'=>['space_id','user_id'],'fields'=>['role','can_organize_tasks','all_projects','permissions_json','member_category_id','project_access_restricted','project_access_revision'],'space'=>true],
        'shared_member_categories'=>['keys'=>['id','space_id'],'fields'=>['permissions_json','revision'],'space'=>true],
        'shared_member_project_grants'=>['keys'=>['space_id','user_id','project_id'],'fields'=>['role','include_descendants'],'space'=>true],
        default=>throw new InvalidArgumentException('E2EE_ACL_TABLE_FORBIDDEN')};
}
function genesisE2eeAclTechnical(array $row,array $spec): array
{
    return array_intersect_key($row,array_fill_keys([...$spec['keys'],...$spec['fields']],true));
}
function genesisE2eeAclBeforeHash(array|false $row,array $spec): string
{
    if(!$row)return'absent';return rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical(['hashFormat'=>'acl-name-value-v1','fields'=>genesisE2eeMembershipFields(genesisE2eeAclTechnical($row,$spec))]),true)),'+/','-_'),'=');
}
function genesisE2eeAclChanges(PDO $db,string $actor,array $changes): array
{
    if(!array_is_list($changes)||count($changes)<1||count($changes)>200)throw new InvalidArgumentException('E2EE_MEMBERSHIP_BATCH_INVALID');$prepared=[];$spaces=[];$projects=[];$seen=[];
    foreach($changes as $change){genesisE2eeExactFields($change,['table','key','expectedHash','after']);$table=$change['table'];$spec=genesisE2eeAclSpec($table);genesisE2eeExactFields($change['key'],$spec['keys']);
        foreach($change['key'] as $id)genesisE2eeIdentifier($id);$keyHash=hash('sha256',genesisE2eeCanonical([$table,genesisE2eeMembershipFields($change['key'])]));if(isset($seen[$keyHash]))throw new InvalidArgumentException('E2EE_MEMBERSHIP_BATCH_INVALID');$seen[$keyHash]=true;
        $where=implode(' AND ',array_map(static fn(string $name):string=>'"'.$name.'"=?',$spec['keys']));$parameters=array_map(static fn(string $name)=>$change['key'][$name],$spec['keys']);$before=genesisE2eeRow($db,'SELECT * FROM "'.$table.'" WHERE '.$where,$parameters);
        if($change['expectedHash']!==genesisE2eeAclBeforeHash($before,$spec))throw new DomainException('E2EE_MEMBERSHIP_STALE');
        if($spec['space']){$space=$change['key']['space_id'];$access=genesisSharedSpaceAccess($space,$actor);if($access['member_role']!=='owner')throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');$spaces[$space]=true;}
        else{$project=$change['key']['project_id'];genesisSharedProjectAccess($project,$actor,'owner',true);$projects[$project]=true;}
        if($table==='shared_member_project_grants'){$project=genesisE2eeRow($db,'SELECT space_id FROM shared_projects WHERE id=?',[$change['key']['project_id']]);if(!$project||$project['space_id']!==$space)throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');}
        $after=null;
        if($change['after']!==null){$fields=genesisE2eeExactFields($change['after'],$spec['fields']);$after=$before?:$change['key'];foreach($fields as $name=>$value)$after[$name]=$value;
            if(isset($fields['role'])){if(!in_array($fields['role'],$table==='shared_space_members'?['owner','admin','member','guest']:($table==='shared_project_members'?['owner','manager','member','commenter','viewer']:['member','commenter','viewer']),true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_ROLE_INVALID');
                if(($before['role']??null)==='owner'||$fields['role']==='owner')throw new DomainException('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');}
            foreach(['can_organize_tasks','all_projects','project_access_restricted','include_descendants'] as $field)if(array_key_exists($field,$fields)&&!in_array($fields[$field],[0,1],true))throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');
            foreach(['revision','project_access_revision'] as $field)if(array_key_exists($field,$fields)&&genesisE2eeInteger($fields[$field],1)!==(int)($before[$field]??0)+1)throw new DomainException('E2EE_MEMBERSHIP_STALE');
            if(array_key_exists('member_category_id',$fields)&&$fields['member_category_id']!==null){genesisE2eeIdentifier($fields['member_category_id']);$category=genesisE2eeRow($db,'SELECT id FROM shared_member_categories WHERE id=? AND space_id=?',[$fields['member_category_id'],$space]);if(!$category)throw new InvalidArgumentException('E2EE_MEMBERSHIP_CATEGORY_INVALID');}
            if(array_key_exists('permissions_json',$fields)){
                if($fields['permissions_json']!==null){$permissions=json_decode($fields['permissions_json'],true,16,JSON_THROW_ON_ERROR);genesisE2eeExactFields($permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);foreach($permissions as $allowed)if(!is_bool($allowed))throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');}
                elseif($table==='shared_member_categories')throw new InvalidArgumentException('E2EE_MEMBERSHIP_PERMISSION_INVALID');}
            if(!$before){if(in_array($table,['shared_space_members','shared_project_members'],true))$after['joined_at']=genesisNow();if($table==='shared_member_categories')$after['title']='[encrypted:'.$change['key']['id'].']';}
        }elseif($before&&($before['role']??null)==='owner')throw new DomainException('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');
        if(!$before&&$after===null)throw new DomainException('E2EE_MEMBERSHIP_STALE');
        $prepared[]=['table'=>$table,'keys'=>$spec['keys'],'where'=>$where,'parameters'=>$parameters,'before'=>$before?:null,'after'=>$after];
    }
    return ['rows'=>$prepared,'spaces'=>array_keys($spaces),'projects'=>array_keys($projects)];
}
function genesisE2eeMembershipScopes(PDO $db,array $prepared): array
{
    $scopes=[];foreach($prepared['spaces'] as $space){$q=$db->prepare("SELECT * FROM e2ee_scopes s WHERE (s.kind='space' AND s.resource_id=?) OR (s.kind='project' AND s.resource_id IN(SELECT id FROM shared_projects WHERE space_id=?)) ORDER BY scope_id");$q->execute([$space,$space]);foreach($q->fetchAll() as $scope)$scopes[$scope['scope_id']]=$scope;$q->closeCursor();}
    foreach($prepared['projects'] as $project){$scope=genesisE2eeRow($db,"SELECT * FROM e2ee_scopes WHERE kind='project' AND resource_id=?",[$project]);if($scope)$scopes[$scope['scope_id']]=$scope;}
    foreach($scopes as $id=>$scope){if(!in_array($scope['state'],['active','retirement'],true)){
        $lease=genesisE2eeRow($db,'SELECT lease_until FROM e2ee_migrations WHERE scope_id=?',[$id]);if($lease&&(int)$lease['lease_until']>=time())throw new DomainException('E2EE_MIGRATION_BUSY');unset($scopes[$id]);}}
    ksort($scopes,SORT_STRING);return$scopes;
}
function genesisE2eeApplyAclRows(PDO $db,array $rows): void
{
    $bindings=genesisE2eeAclBindings();if(isset($bindings[$db]))throw new LogicException('E2EE_ACL_CONTEXT_NESTED');$permitted=[];
    foreach($rows as $row){$verb=$row['after']===null?'DELETE':($row['before']===null?'INSERT':'UPDATE');$permitted[genesisE2eeAclPermitKey($row['table'],$verb,$row['before'],$row['after'])]=true;}
    $bindings[$db]=$permitted;
    try{foreach($rows as $row){$table=$row['table'];$after=$row['after'];
        if($after===null)$db->prepare('DELETE FROM "'.$table.'" WHERE '.$row['where'])->execute($row['parameters']);
        elseif($row['before']===null){$names=array_keys($after);$db->prepare('INSERT INTO "'.$table.'"("'.implode('","',$names).'") VALUES('.implode(',',array_fill(0,count($names),'?')).')')->execute(array_values($after));}
        else{$fields=array_values(array_diff(array_keys($after),$row['keys']));$db->prepare('UPDATE "'.$table.'" SET '.implode(',',array_map(static fn(string $field):string=>'"'.$field.'"=?',$fields)).' WHERE '.$row['where'])->execute([...array_map(static fn(string $field)=>$after[$field],$fields),...$row['parameters']]);}
    }}finally{unset($bindings[$db]);}
}
/** Relayed owner signatures authorize a specific complete membership change.
 * Every affected scope rotates under the same SQLite writer transaction. */
function genesisE2eeMembershipBatch(string $actor,array $input,string $sessionBinding): array
{
    genesisE2eeExactFields($input,['intentId','changes','authorization','rotations']);genesisE2eeIdentifier($input['intentId']);if(!is_array($input['changes'])||!is_array($input['rotations'])||!array_is_list($input['rotations'])||count($input['rotations'])>256)throw new InvalidArgumentException('E2EE_MEMBERSHIP_BATCH_INVALID');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $authorization=genesisE2eeExactFields($input['authorization'],['command','signature']);$command=genesisE2eeCommand($authorization['command']);$anchor=genesisE2eeScope($actor,$command['scopeId']);
        if($anchor['kind']!=='personal'||$anchor['owner_id']!==$actor||$anchor['resource_id']!==$actor||$anchor['state']!=='active'||$command['ownerId']!==$actor||$command['action']!=='membership-authorize')throw new DomainException('E2EE_SCOPE_BINDING_MISMATCH');
        $device=genesisE2eeRow($db,'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$anchor['scope_id'],$command['deviceId']]);if(!$device||$device['revoked']||$device['user_id']!==$actor||$device['role']!=='owner')throw new DomainException('E2EE_REVOKED_DEVICE');genesisE2eeVerifyCommand($authorization,$device['signing_key']);
        genesisE2eeExactFields($command['payload'],['intentId','changeHash']);if($command['payload']['intentId']!==$input['intentId'])throw new DomainException('E2EE_CONTEXT_MISMATCH');genesisE2eeDecode($command['payload']['changeHash'],32);
        $requestHash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical(['hashFormat'=>'acl-name-value-v1','intentId'=>$input['intentId'],'changes'=>genesisE2eeMembershipChangesProjection($input['changes']),'authorization'=>$authorization,'rotations'=>$input['rotations']]),true)),'+/','-_'),'=');
        $old=genesisE2eeRow($db,"SELECT payload_hash,result_json FROM e2ee_service_intents WHERE scope_id=? AND actor_id=? AND action='membership-change' AND intent_id=?",[$anchor['scope_id'],$actor,$input['intentId']]);
        if($old){if(!hash_equals($old['payload_hash'],$requestHash))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');$result=json_decode($old['result_json'],true,512,JSON_THROW_ON_ERROR);$db->commit();return$result;}
        if($command['securityEpoch']!==(int)$anchor['security_epoch']||$command['expectedRevision']!==(int)$anchor['directory_revision']||$command['checkpointHash']!==$anchor['checkpoint_hash'])throw new DomainException('E2EE_STALE_EPOCH');
        $prepared=genesisE2eeAclChanges($db,$actor,$input['changes']);$scopes=genesisE2eeMembershipScopes($db,$prepared);
        $changeHash=genesisE2eeMembershipChangeHash($actor,$input['intentId'],$input['changes'],array_keys($scopes));
        if(!hash_equals($command['payload']['changeHash'],$changeHash)||count($input['rotations'])!==count($scopes))throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
        $rotations=[];foreach($input['rotations'] as $packet){$rotation=genesisE2eeCommand($packet['command']??null);$id=$rotation['scopeId'];if(isset($rotations[$id])||!isset($scopes[$id])||$rotation['action']!=='rotate-membership'||($rotation['payload']['membershipHash']??null)!==$changeHash)throw new DomainException('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');$rotations[$id]=$packet;}
        genesisE2eeApplyAclRows($db,$prepared['rows']);$results=[];
        foreach($scopes as $id=>$scope){$results[$id]=genesisE2eeExecuteLocked($scope['owner_id'],$rotations[$id],$sessionBinding,$changeHash);}
        $result=['intentId'=>$input['intentId'],'changeHash'=>$changeHash,'scopes'=>$results,'signInRequired'=>true];
        $db->prepare("INSERT INTO e2ee_service_intents VALUES(?,?,'membership-change',?,?,?)")->execute([$anchor['scope_id'],$actor,$input['intentId'],$requestHash,genesisE2eeJson($result)]);$db->commit();return$result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
}
function genesisE2eeMembershipState(string $actor,array $input): array
{
    genesisE2eeExactFields($input,['targets']);if(!is_array($input['targets'])||!array_is_list($input['targets'])||count($input['targets'])<1||count($input['targets'])>200)throw new InvalidArgumentException('E2EE_MEMBERSHIP_BATCH_INVALID');$rows=[];$db=genesisDb();
    foreach($input['targets'] as $target){genesisE2eeExactFields($target,['table','key']);$spec=genesisE2eeAclSpec($target['table']);genesisE2eeExactFields($target['key'],$spec['keys']);foreach($target['key'] as $id)genesisE2eeIdentifier($id);
        if($spec['space']){if(genesisSharedSpaceAccess($target['key']['space_id'],$actor)['member_role']!=='owner')throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');}
        else genesisSharedProjectAccess($target['key']['project_id'],$actor,'owner',true);
        $where=implode(' AND ',array_map(static fn(string $name):string=>'"'.$name.'"=?',$spec['keys']));$row=genesisE2eeRow($db,'SELECT * FROM "'.$target['table'].'" WHERE '.$where,array_map(static fn(string $name)=>$target['key'][$name],$spec['keys']));
        $rows[]=['table'=>$target['table'],'key'=>$target['key'],'before'=>$row?genesisE2eeAclTechnical($row,$spec):null,'beforeHash'=>genesisE2eeAclBeforeHash($row,$spec)];
    }return['rows'=>$rows];
}
function genesisE2eeMembershipPreview(string $actor,array $input): array
{
    genesisE2eeExactFields($input,['intentId','changes']);genesisE2eeIdentifier($input['intentId']);if(!is_array($input['changes']))throw new InvalidArgumentException('E2EE_MEMBERSHIP_BATCH_INVALID');$db=genesisDb();genesisBeginWriteTransaction($db);
    try{$prepared=genesisE2eeAclChanges($db,$actor,$input['changes']);$scopes=genesisE2eeMembershipScopes($db,$prepared);genesisE2eeApplyAclRows($db,$prepared['rows']);
        $hash=genesisE2eeMembershipChangeHash($actor,$input['intentId'],$input['changes'],array_keys($scopes));$plans=[];
        foreach($scopes as $id=>$scope){genesisE2eeAccess($scope['owner_id'],$scope['kind'],$scope['resource_id'],'manage');$q=$db->prepare('SELECT device_id,user_id FROM e2ee_devices WHERE scope_id=? AND revoked=0 ORDER BY device_id');$q->execute([$id]);$devices=$q->fetchAll();$q->closeCursor();$roles=[];
            foreach($devices as $device){$role=null;try{$role=genesisE2eeDeviceRole($device['user_id'],$scope);}catch(GenesisSharedAccessException|GenesisResourceLimitException $error){if(!in_array($error->status,[403,404],true))throw$error;}$roles[]=['deviceId'=>$device['device_id'],'role'=>$role];}
            $manifest=genesisE2eeManifest($db,$scope);$plans[]=['scopeId'=>$id,'ownerId'=>$scope['owner_id'],'kind'=>$scope['kind'],'resourceId'=>$scope['resource_id'],'directoryRevision'=>(int)$scope['directory_revision'],
                'checkpointHash'=>$scope['checkpoint_hash'],'cryptoEpoch'=>(int)$scope['crypto_epoch'],'securityEpoch'=>(int)$scope['security_epoch'],'roles'=>$roles,'manifest'=>$manifest];}
        return['intentId'=>$input['intentId'],'changeHash'=>$hash,'scopePlans'=>$plans];
    }finally{if($db->inTransaction())$db->rollBack();}
}
