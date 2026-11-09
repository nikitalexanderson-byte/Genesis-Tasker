<?php
declare(strict_types=1);

/** Existing project memberships remain the access index used by all task/file/query APIs. */
function genesisSharedProjectAccessState(string $actorId, string $spaceId, string $targetId): array
{
    genesisSharedRequireEnabled($actorId);
    $space=genesisSharedSpaceAccess($spaceId,$actorId);
    if($space['member_role']!=='owner')throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN',403);
    $db=genesisDb();
    $q=$db->prepare('SELECT role,all_projects,project_access_restricted,project_access_revision,permissions_json,can_organize_tasks FROM shared_space_members WHERE space_id=? AND user_id=?');
    $q->execute([$spaceId,$targetId]);$member=$q->fetch();
    if(!$member)throw new GenesisSharedAccessException();
    $q=$db->prepare('SELECT p.id,p.title,p.parent_id AS parentId,p.is_inbox AS isInbox,p.archived_at AS archivedAt,
        p.revision,m.role,(SELECT COUNT(*) FROM shared_tasks t WHERE t.project_id=p.id AND t.assignee_id=m.user_id) AS assignedTaskCount,
        EXISTS(SELECT 1 FROM shared_trash t WHERE t.kind=\'project\' AND t.object_id=p.id) AS inTrash
        FROM shared_projects p LEFT JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=?
        WHERE p.space_id=? ORDER BY p.id');
    $q->execute([$targetId,$spaceId]);$projects=$q->fetchAll();
    $q=$db->prepare("SELECT project_id AS projectId,CASE WHEN excluded=1 THEN 'none' ELSE role END AS role,include_descendants AS includeDescendants FROM shared_member_project_grants WHERE space_id=? AND user_id=? ORDER BY project_id");
    $q->execute([$spaceId,$targetId]);$grants=$q->fetchAll();
    $grants=array_map(static fn(array $r):array=>['projectId'=>$r['projectId'],'role'=>$r['role'],'includeDescendants'=>(bool)$r['includeDescendants']],$grants);
    if(!(int)$member['project_access_restricted'])$grants=array_values(array_map(static fn(array $p):array=>[
        'projectId'=>$p['id'],'role'=>in_array($p['role'],['viewer','commenter'],true)?$p['role']:'member','includeDescendants'=>false
    ],array_filter($projects,static fn(array $p):bool=>$p['role']!==null)));
    $fingerprint=hash('sha256',json_encode([$member,$projects,$grants],JSON_THROW_ON_ERROR));
    $manager=in_array($member['role'],['owner','admin'],true);
    return ['spaceId'=>$spaceId,'userId'=>$targetId,'memberRole'=>$member['role'],'allProjects'=>$manager||(bool)$member['all_projects'],
        'restricted'=>!$manager&&(bool)$member['project_access_restricted'],'revision'=>(int)$member['project_access_revision'],
        'fingerprint'=>$fingerprint,'projects'=>$projects,'grants'=>$grants,
        'spacePermissions'=>genesisSharedPermissions($member['role'],$member['permissions_json'],(bool)$member['can_organize_tasks']),
        'permissionsOverride'=>$member['permissions_json']===null||$member['permissions_json']===''?null:genesisSharedPermissionInput(json_decode($member['permissions_json'],true,512,JSON_THROW_ON_ERROR)),
        'canOrganizeTasks'=>(bool)$member['can_organize_tasks']];
}

function genesisSharedProjectAccessInput(array $input): array
{
    if(!is_bool($input['allProjects']??null)||!is_array($input['grants']??null)||!array_is_list($input['grants'])
        ||count($input['grants'])>5000||array_diff(array_keys($input),['allProjects','grants','expectedFingerprint','operationId']))throw new InvalidArgumentException('INVALID_PROJECT_ACCESS');
    $grants=[];
    foreach($input['grants'] as $row){
        if(!is_array($row)||!is_string($row['projectId']??null)||$row['projectId']===''||strlen($row['projectId'])>100
            ||!in_array($row['role']??null,['member','commenter','viewer','none'],true)||!is_bool($row['includeDescendants']??null)
            ||array_diff(array_keys($row),['projectId','role','includeDescendants'])||isset($grants[$row['projectId']]))throw new InvalidArgumentException('INVALID_PROJECT_ACCESS');
        $grants[$row['projectId']]=['projectId'=>$row['projectId'],'role'=>$row['role'],'includeDescendants'=>$row['includeDescendants']];
    }
    ksort($grants);
    if($input['allProjects']&&$grants)throw new InvalidArgumentException('INVALID_PROJECT_ACCESS');
    return ['allProjects'=>$input['allProjects'],'grants'=>array_values($grants)];
}

/** The nearest explicit grant wins; ancestors grant descendants only when explicitly enabled. */
function genesisSharedProjectAccessRoles(array $projects, array $grants): array
{
    $byId=array_column($projects,null,'id');$rules=array_column($grants,null,'projectId');$roles=[];
    foreach($projects as $project){
        $cursor=$project['id'];$seen=[];
        while($cursor!==null&&isset($byId[$cursor])){
            if(isset($seen[$cursor]))throw new InvalidArgumentException('PROJECT_CYCLE');
            $seen[$cursor]=true;
            if(isset($rules[$cursor])&&($cursor===$project['id']||$rules[$cursor]['includeDescendants'])){
                $roles[$project['id']]=$rules[$cursor]['role']==='none'?null:$rules[$cursor]['role'];break;
            }
            $cursor=$byId[$cursor]['parentId'];
        }
    }
    return $roles;
}

function genesisSharedPreviewProjectAccess(string $actorId,string $spaceId,string $targetId,array $input):array
{
    $state=genesisSharedProjectAccessState($actorId,$spaceId,$targetId);$desired=genesisSharedProjectAccessInput($input);
    if(in_array($state['memberRole'],['owner','admin'],true))throw new GenesisSharedAccessException('PROJECT_ACCESS_MANAGER_UNRESTRICTED',409);
    $available=array_column($state['projects'],null,'id');
    foreach($desired['grants'] as $grant)if(!isset($available[$grant['projectId']]))throw new GenesisSharedAccessException();
    $roles=$desired['allProjects']?[]:genesisSharedProjectAccessRoles($state['projects'],$desired['grants']);
    if($desired['allProjects'])foreach($state['projects'] as $project)$roles[$project['id']]=$project['role']==='owner'?'owner':($state['memberRole']==='guest'?'viewer':'member');
    $changes=[];$blockers=[];
    foreach($state['projects'] as $project){
        $next=$roles[$project['id']]??null;
        $permissions=static fn(?string $role,bool $restricted):array=>$role===null?array_fill_keys(['read','createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'],false)
            :['read'=>true]+genesisSharedPermissions($state['memberRole'],$state['permissionsOverride']===null?null:json_encode($state['permissionsOverride'],JSON_THROW_ON_ERROR),$state['canOrganizeTasks'],$role,$restricted);
        $before=$permissions($project['role'],$state['restricted']);$after=$permissions($next,!$desired['allProjects']);
        if($next===$project['role']&&$before===$after)continue;
        if($project['role']==='owner'&&$next!=='owner'){
            $q=genesisDb()->prepare("SELECT COUNT(*) FROM shared_project_members WHERE project_id=? AND role='owner'");
            $q->execute([$project['id']]);if((int)$q->fetchColumn()<=1)$blockers[]=['projectId'=>$project['id'],'code'=>'LAST_OWNER'];
        }
        $changes[]=['projectId'=>$project['id'],'title'=>$project['title'],'from'=>$project['role'],'to'=>$next,
            'clearedAssignments'=>$next===null?(int)$project['assignedTaskCount']:0,'beforePermissions'=>$before,'afterPermissions'=>$after];
    }
    return ['fingerprint'=>$state['fingerprint'],'revision'=>$state['revision'],'desired'=>$desired,'changes'=>$changes,'blockers'=>$blockers,
        'effectiveRoles'=>$roles,'projects'=>$state['projects']];
}

/** Caller holds the SQLite write lock. Revoke existing projection links and obsolete task assignments together. */
function genesisSharedApplyProjectRoleIndex(string $spaceId,string $targetId,array $roles,string $actorId):void
{
    $db=genesisDb();$q=$db->prepare('SELECT p.id,m.role FROM shared_projects p LEFT JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? WHERE p.space_id=?');
    $q->execute([$targetId,$spaceId]);
    foreach($q->fetchAll() as $project){
        $id=$project['id'];$role=$roles[$id]??null;if($role===$project['role'])continue;
        if($project['role']==='owner'&&$role!=='owner'){
            $q=$db->prepare("SELECT COUNT(*) FROM shared_project_members WHERE project_id=? AND role='owner'");$q->execute([$id]);
            if((int)$q->fetchColumn()<=1)throw new GenesisSharedAccessException('LAST_OWNER',409);
        }
        if($role===null){
            $q=$db->prepare('SELECT id FROM shared_tasks WHERE project_id=? AND assignee_id=?');$q->execute([$id,$targetId]);$assignments=$q->fetchAll(PDO::FETCH_COLUMN);
            $db->prepare('DELETE FROM shared_google_projection_links WHERE user_id=? AND task_id IN (SELECT id FROM shared_tasks WHERE project_id=?)')->execute([$targetId,$id]);
            $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$id,$targetId]);
            $db->prepare('UPDATE shared_tasks SET assignee_id=NULL,revision=revision+1,updated_by=?,updated_at=? WHERE project_id=? AND assignee_id=?')
                ->execute([$actorId,genesisNow(),$id,$targetId]);
            foreach($assignments as $taskId)genesisSharedAudit($id,$actorId,'task.updated',$taskId,['changes'=>['assigneeId'=>['from'=>$targetId,'to'=>null]]]);
        }else{
            $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)
                ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role')->execute([$id,$targetId,$role,genesisNow()]);
        }
        genesisSharedRevokeInvitationsByMember($targetId,$id);
        genesisSharedAudit($id,$actorId,$role===null?'member.removed':'member.role_changed',$targetId,['changes'=>['role'=>['from'=>$project['role'],'to'=>$role]]]);
    }
}

function genesisSharedSaveProjectAccess(string $actorId,string $spaceId,string $targetId,array $input):array
{
    $desired=genesisSharedProjectAccessInput($input);$operation=$input['operationId']??null;$expected=$input['expectedFingerprint']??null;
    if(!is_string($operation)||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$operation)||!is_string($expected)||!preg_match('/^[a-f0-9]{64}$/D',$expected))throw new InvalidArgumentException('INVALID_PROJECT_ACCESS');
    $hash=hash('sha256',json_encode([$desired,$expected],JSON_THROW_ON_ERROR));$db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        genesisSharedProjectAccessState($actorId,$spaceId,$targetId);
        $q=$db->prepare('SELECT actor_id,payload_hash,receipt_json FROM shared_member_access_receipts WHERE space_id=? AND user_id=? AND operation_id=?');
        $q->execute([$spaceId,$targetId,$operation]);$receipt=$q->fetch();
        if($receipt){
            if($receipt['actor_id']!==$actorId||!hash_equals($receipt['payload_hash'],$hash))throw new GenesisSharedAccessException('PROJECT_ACCESS_OPERATION_REUSED',409);
            $db->commit();return json_decode($receipt['receipt_json'],true,512,JSON_THROW_ON_ERROR);
        }
        $preview=genesisSharedPreviewProjectAccess($actorId,$spaceId,$targetId,$input);
        if(!hash_equals($preview['fingerprint'],$expected))throw new GenesisSharedAccessException('PROJECT_ACCESS_CONFLICT',409);
        if($preview['blockers'])throw new GenesisSharedAccessException('LAST_OWNER',409);
        $db->prepare('UPDATE shared_space_members SET all_projects=?,project_access_restricted=?,project_access_revision=project_access_revision+1 WHERE space_id=? AND user_id=?')
            ->execute([$desired['allProjects']?1:0,$desired['allProjects']?0:1,$spaceId,$targetId]);
        $db->prepare('DELETE FROM shared_member_project_grants WHERE space_id=? AND user_id=?')->execute([$spaceId,$targetId]);
        foreach($desired['grants'] as $grant)$db->prepare('INSERT INTO shared_member_project_grants(space_id,user_id,project_id,role,include_descendants,excluded) VALUES(?,?,?,?,?,?)')
            ->execute([$spaceId,$targetId,$grant['projectId'],$grant['role']==='none'?'viewer':$grant['role'],$grant['includeDescendants']?1:0,$grant['role']==='none'?1:0]);
        genesisSharedApplyProjectRoleIndex($spaceId,$targetId,$preview['effectiveRoles'],$actorId);
        foreach($preview['changes'] as $change)if($change['from']===$change['to']){
            $changes=[];
            foreach($change['afterPermissions'] as $key=>$value)if($change['beforePermissions'][$key]!==$value)$changes[$key]=['from'=>$change['beforePermissions'][$key],'to'=>$value];
            if($changes)genesisSharedAudit($change['projectId'],$actorId,'member.project_access_changed',$targetId,['changes'=>$changes]);
        }
        genesisSharedRevokeInvitationsByMember($targetId,null,$spaceId);
        $result=['operationId'=>$operation,'revision'=>$preview['revision']+1,'changed'=>count($preview['changes']),'allProjects'=>$desired['allProjects'],'grants'=>$desired['grants']];
        $db->prepare('INSERT INTO shared_member_access_receipts VALUES(?,?,?,?,?,?,?)')->execute([$spaceId,$targetId,$operation,$actorId,$hash,json_encode($result,JSON_THROW_ON_ERROR),genesisNow()]);
        $db->commit();return $result;
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Recompute inherited memberships after project creation/reparenting; old unrestricted users keep their rules. */
function genesisSharedRefreshRestrictedProjectAccess(string $spaceId,string $actorId,?string $targetId=null):void
{
    $db=genesisDb();$q=$db->prepare("SELECT user_id FROM shared_space_members WHERE space_id=? AND project_access_restricted=1 AND role NOT IN ('owner','admin')".($targetId!==null?' AND user_id=?':''));
    $q->execute($targetId!==null?[$spaceId,$targetId]:[$spaceId]);
    $users=$q->fetchAll(PDO::FETCH_COLUMN);if(!$users)return;
    $q=$db->prepare('SELECT id,parent_id AS parentId FROM shared_projects WHERE space_id=?');$q->execute([$spaceId]);$projects=$q->fetchAll();
    foreach($users as $id){
        $q=$db->prepare("SELECT project_id AS projectId,CASE WHEN excluded=1 THEN 'none' ELSE role END AS role,include_descendants AS includeDescendants FROM shared_member_project_grants WHERE space_id=? AND user_id=?");
        $q->execute([$spaceId,$id]);genesisSharedApplyProjectRoleIndex($spaceId,$id,genesisSharedProjectAccessRoles($projects,$q->fetchAll()),$actorId);
    }
}

function genesisSharedRememberDirectProjectAccess(string $projectId,string $targetId,string $role):void
{
    $q=genesisDb()->prepare('SELECT p.space_id FROM shared_projects p JOIN shared_space_members m ON m.space_id=p.space_id AND m.user_id=? WHERE p.id=? AND m.project_access_restricted=1');
    $q->execute([$targetId,$projectId]);$spaceId=$q->fetchColumn();if($spaceId===false)return;
    if(!in_array($role,['member','commenter','viewer'],true))throw new GenesisSharedAccessException('PROJECT_ACCESS_MANAGER_UNRESTRICTED',409);
    genesisDb()->prepare('INSERT INTO shared_member_project_grants(space_id,user_id,project_id,role,include_descendants) VALUES(?,?,?,?,0)
        ON CONFLICT(space_id,user_id,project_id) DO UPDATE SET role=excluded.role,excluded=0')->execute([$spaceId,$targetId,$projectId,$role]);
}

function genesisSharedForgetDirectProjectAccess(string $projectId,string $targetId):void
{
    $db=genesisDb();$q=$db->prepare('SELECT p.space_id FROM shared_projects p JOIN shared_space_members m ON m.space_id=p.space_id AND m.user_id=? WHERE p.id=? AND m.project_access_restricted=1');
    $q->execute([$targetId,$projectId]);$spaceId=$q->fetchColumn();
    if($spaceId!==false)$db->prepare("INSERT INTO shared_member_project_grants(space_id,user_id,project_id,role,include_descendants,excluded) VALUES(?,?,?,'viewer',1,1)
        ON CONFLICT(space_id,user_id,project_id) DO UPDATE SET excluded=1,include_descendants=1")->execute([$spaceId,$targetId,$projectId]);
    else $db->prepare('DELETE FROM shared_member_project_grants WHERE project_id=? AND user_id=?')->execute([$projectId,$targetId]);
}

function genesisSharedReadableReference(string $userId,string $kind,string $id):bool
{
    $sql=match($kind){
        'task'=>'SELECT p.id FROM shared_tasks_history_read t JOIN shared_projects p ON p.id=t.project_id',
        'status'=>'SELECT p.id FROM shared_project_statuses s JOIN shared_projects p ON p.id=s.project_id',
        default=>'SELECT p.id FROM shared_projects p',
    };
    $sql.=' JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id WHERE '.match($kind){'task'=>'t.id','status'=>'s.id',default=>'p.id'}.'=?';
    $q=genesisDb()->prepare($sql);$q->execute([$userId,$id]);return $q->fetchColumn()!==false;
}

/** Old readable labels have no canonical reference evidence; a restricted reader must not receive those names. */
function genesisSharedSafeActivityRow(string $userId,string $projectId,array $row):array
{
    $project=genesisSharedProjectAccess($projectId,$userId,'read',true);$restricted=(bool)$project['project_access_restricted'];
    $details=$row['details'];
    foreach($details['changes']??[] as $field=>$change){
        if(!in_array($field,['projectId','parentId','parentTaskId','dependsOnIds','statusId','boardStatusId'],true))continue;
        foreach(['from','to'] as $direction){
            $value=$change[$direction]??null;if($value===null||$value===[])continue;
            $reference=$details['referenceIds'][$field][$direction]??null;
            $kind=in_array($field,['parentTaskId','dependsOnIds'],true)?'task':(in_array($field,['statusId','boardStatusId'],true)?'status':'project');
            $hidden=$reference===null?$restricted:array_filter(is_array($reference)?$reference:[$reference],static fn($id):bool=>!is_string($id)||!genesisSharedReadableReference($userId,$kind,$id));
            if($hidden){$details['changes'][$field][$direction]=null;$details['changes'][$field][$direction.'Unavailable']=true;unset($details['referenceIds'][$field][$direction]);}
        }
    }
    if($restricted&&!empty($row['taskId'])&&!genesisSharedReadableReference($userId,'task',(string)$row['taskId'])){
        unset($details['objectTitle']);$row['taskId']=null;
    }
    foreach(['boardId','destinationBoardId'] as $field){
        $value=$field==='boardId'?($row[$field]??null):($details[$field]??null);
        if(is_string($value)&&$value!==''&&!genesisSharedReadableReference($userId,'status',$value)){
            if($field==='boardId')$row[$field]=null;
            unset($details[$field]);
        }
    }
    $row['details']=genesisPlanningSafeDetails($userId,$details);return $row;
}
