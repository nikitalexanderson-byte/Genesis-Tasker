<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$fixtureConfig=genesisConfig();
$browserFixture=$fixtureConfig['app_url']==='http://127.0.0.1:4338'&&basename($fixtureConfig['db_path'])==='improvements-test.sqlite';
$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');$ciFixture=$fixtureConfig['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$fixtureConfig['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browserFixture&&!$ciFixture)throw new RuntimeException('Non-fixture configuration refused.');
foreach(['repository','google','shared-projects','shared-google','mindmaps','shared-mindmaps'] as $module)require __DIR__.'/../src/'.$module.'.php';
function accessCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function accessReject(callable $action,int $status):void{
    try{$action();}catch(GenesisSharedAccessException|GenesisResourceLimitException $error){accessCheck($error->status===$status,'Unexpected rejection: '.$error->getMessage());return;}
    throw new RuntimeException('Expected access rejection was bypassed.');
}
$users=[];$spaces=[];$tag='c6-'.genesisUuid();$checks=[];
try{
    $memory=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $memory->exec('PRAGMA foreign_keys=ON');genesisRegisterSharedContentFunctions($memory);
    foreach(glob(__DIR__.'/../migrations/*.sql') as $migration){$memory->beginTransaction();try{$memory->exec(file_get_contents($migration));$memory->commit();}catch(Throwable $error){$memory->rollBack();throw $error;}}
    accessCheck(in_array('excluded',array_column($memory->query('PRAGMA table_info(shared_member_project_grants)')->fetchAll(),'name'),true),'Fresh migration lost inheritance exclusions.');
    accessCheck(in_array('project_id',array_column($memory->query('PRAGMA table_info(shared_mindmap_deletion_scopes)')->fetchAll(),'name'),true),'Fresh migration lost scoped map deletion receipts.');
    accessCheck(count($memory->query('PRAGMA table_info(shared_mindmap_deletions)')->fetchAll())===2,'Migration broke legacy deletion receipt writes.');
    $checks[]='fresh-schema-foreign-keys';
    foreach(['owner','member','viewer'] as $name){$user=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.$name,'email'=>$tag.$name.'@example.invalid','name'=>'C6 '.$name],[],false);$users[$name]=$user['id'];genesisTestEnableSharedProjects($user['id']);}
    $owner=$users['owner'];$member=$users['member'];$viewer=$users['viewer'];$db=genesisDb();
    $space=genesisSharedCreateSpace($owner,['title'=>'C6 isolated space']);$spaceId=$space['id'];$spaces[]=$spaceId;
    $all=array_fill_keys(['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'],true);
    foreach([$member=>'member',$viewer=>'guest'] as $userId=>$role)$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,all_projects,permissions_json,joined_at) VALUES(?,?,?,1,?,?)')
        ->execute([$spaceId,$userId,$role,$role==='member'?json_encode($all):null,genesisNow()]);
    $a=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 allowed branch']);
    $child=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 child','parentId'=>$a['id']]);
    $grandchild=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 grandchild','parentId'=>$child['id']]);
    $b=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 distinctive private branch']);
    $snapshot=genesisSharedProjectSnapshot($owner,$b['id']);$status=$snapshot['statuses'][0]['id'];
    $secret=genesisSharedTask($owner,$b['id'],['title'=>'C6 hidden task','statusId'=>$status,'assigneeId'=>$member,'dueDate'=>'2026-10-18']);
    $maps=[];
    foreach(['a'=>$a['id'],'b'=>$b['id'],'space'=>null] as $name=>$projectId){
        $id=genesisUuid();$document=['schemaVersion'=>1,'id'=>$id,'projectId'=>$projectId,'title'=>'C6 map '.$name,'pinned'=>false,'archived'=>false,
            'nodes'=>[['id'=>genesisUuid(),'parentId'=>null,'kind'=>'idea','text'=>'C6 map content','note'=>'']],'links'=>[]];
        genesisSaveSharedMindmap($owner,$spaceId,$id,['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>genesisUuid(),'document'=>$document]);$maps[$name]=$document;
    }
    $desired=['allProjects'=>false,'grants'=>[['projectId'=>$a['id'],'role'=>'member','includeDescendants'=>true],['projectId'=>$child['id'],'role'=>'viewer','includeDescendants'=>true]]];
    $preview=genesisSharedPreviewProjectAccess($owner,$spaceId,$member,$desired);
    accessCheck(!$preview['blockers']&&array_sum(array_column($preview['changes'],'clearedAssignments'))===1,'Preview did not explain assignment cleanup.');
    $command=$desired+['expectedFingerprint'=>$preview['fingerprint'],'operationId'=>'c6-first'];
    $receipt=genesisSharedSaveProjectAccess($owner,$spaceId,$member,$command);
    $auditCount=$db->query('SELECT COUNT(*) FROM shared_audit_events')->fetchColumn();
    accessCheck(genesisSharedSaveProjectAccess($owner,$spaceId,$member,$command)===$receipt,'Replay changed its receipt.');
    accessCheck($auditCount===$db->query('SELECT COUNT(*) FROM shared_audit_events')->fetchColumn(),'Replay created new events.');
    accessReject(fn()=>genesisSharedSaveProjectAccess($owner,$spaceId,$member,[...$command,'grants'=>[]]),409);
    accessReject(fn()=>genesisSharedProjectAccessState($viewer,$spaceId,$member),403);
    accessReject(fn()=>genesisSharedPreviewProjectAccess($owner,$spaceId,$owner,$desired),409);
    $checks[]='preview-cas-replay-authorization';
    accessCheck(genesisSharedProjectAccess($a['id'],$member,'write')['permissions']['editTasks'],'Allowed editor lost task editing.');
    accessReject(fn()=>genesisSharedProjectAccess($child['id'],$member,'write'),403);
    accessReject(fn()=>genesisSharedProjectAccess($grandchild['id'],$member,'comment'),403);
    accessReject(fn()=>genesisSharedProjectAccess($a['id'],$member,'manage'),403);
    accessReject(fn()=>genesisSharedCreateProject($member,$spaceId,['title'=>'Forbidden root']),403);
    accessReject(fn()=>genesisSharedProjectAccess($b['id'],$member),404);
    accessReject(fn()=>genesisSharedGetTask($member,$b['id'],$secret['id']),404);
    accessReject(fn()=>genesisSharedActivity($member,$b['id'],null,null),404);
    accessCheck(genesisSharedQueryTasks($member,['q'=>'C6 hidden task'])['total']===0,'Search leaked a hidden task.');
    accessReject(fn()=>genesisSharedQueryTasks($member,['projectIds'=>[$b['id']]]),404);
    accessCheck(!array_filter(genesisSharedCalendarTasks($member,'2026-10-01','2026-10-31'),fn($task)=>$task['id']===$secret['id']),'Calendar leaked a hidden task.');
    accessCheck(genesisSharedGetTask($owner,$b['id'],$secret['id'])['assigneeId']===null,'Revoked participant remained assigned.');
    $checks[]='server-role-caps-query-calendar-history';
    accessCheck(array_column(genesisSharedMindmaps($member,$spaceId),'id')===[$maps['a']['id']],'Map index leaked another project or a space map.');
    accessCheck(genesisSharedMindmaps($member,$spaceId,$maps['b']['id'])===[],'Map version history leaked.');
    accessReject(fn()=>genesisDeleteSharedMindmap($member,$spaceId,$maps['b']['id'],['expectedRevision'=>1]),404);
    $movedMap=[...$maps['b'],'projectId'=>$a['id']];
    accessReject(fn()=>genesisSaveSharedMindmap($member,$spaceId,$maps['b']['id'],['schemaVersion'=>1,'expectedRevision'=>1,'operationId'=>genesisUuid(),'document'=>$movedMap]),404);
    $checks[]='maps-history-move-delete-scope';
    genesisSharedSetSpaceRole($owner,$spaceId,$member,['role'=>'admin']);
    accessCheck(genesisSharedProjectAccess($b['id'],$member,'write')['permissions']['editTasks'],'Explicit administrator promotion did not take effect.');
    accessCheck(in_array($maps['space']['id'],array_column(genesisSharedMindmaps($member,$spaceId),'id'),true),'Administrator lost the space-wide map while the restriction flag is retained.');
    $adminProject=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 created during administrator role']);
    genesisSharedSetSpaceRole($owner,$spaceId,$member,['role'=>'member']);
    accessReject(fn()=>genesisSharedProjectAccess($adminProject['id'],$member),404);
    accessReject(fn()=>genesisSharedProjectAccess($b['id'],$member),404);
    accessReject(fn()=>genesisSharedProjectAccess($child['id'],$member,'write'),403);
    $checks[]='administrator-demotion-restores-selected-policy';
    genesisSharedSetMemberRole($owner,$child['id'],$member,['role'=>'member']);
    accessCheck(genesisSharedProjectAccess($grandchild['id'],$member,'write')['permissions']['editTasks'],'Changing an explicit inherited role did not update descendants.');
    genesisSharedRemoveMember($owner,$child['id'],$member);
    accessReject(fn()=>genesisSharedProjectAccess($child['id'],$member),404);
    accessReject(fn()=>genesisSharedProjectAccess($grandchild['id'],$member),404);
    $new=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 new inherited child','parentId'=>$a['id']]);
    accessCheck(genesisSharedProjectAccess($new['id'],$member,'write')['permissions']['editTasks'],'New descendants lost their explicit inheritance.');
    $denied=genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 new excluded descendant','parentId'=>$child['id']]);
    accessReject(fn()=>genesisSharedProjectAccess($denied['id'],$member),404);
    genesisSharedUpdateProject($owner,$new['id'],['parentId'=>$b['id'],'expectedRevision'=>$new['revision']]);
    accessReject(fn()=>genesisSharedProjectAccess($new['id'],$member),404);
    $checks[]='creation-reparenting-and-old-client-exclusion';
    genesisSharedAudit($a['id'],$owner,'project.updated',$a['id'],['changes'=>['parentId'=>['from'=>$b['id'],'to'=>null]]]);
    $db->prepare('UPDATE shared_project_statuses SET title=? WHERE id=?')->execute(['C6 distinctive private board',$status]);
    $allowedStatus=genesisSharedProjectSnapshot($owner,$a['id'])['statuses'][0]['id'];
    genesisSharedAudit($a['id'],$owner,'task.moved_in',genesisUuid(),['boardId'=>$status,'destinationBoardId'=>$status,
        'changes'=>['statusId'=>['from'=>$status,'to'=>$allowedStatus],'boardStatusId'=>['from'=>$status,'to'=>$allowedStatus]]]);
    $events=genesisSharedActivity($member,$a['id'],null,null)['events'];
    accessCheck(!str_contains(json_encode($events),'distinctive private branch'),'Readable activity labels leaked a hidden project.');
    accessCheck(!str_contains(json_encode($events),'distinctive private board')&&!str_contains(json_encode($events),$status),'Moved-task history leaked an inaccessible board.');
    accessCheck((bool)array_filter($events,fn($event)=>!empty($event['details']['changes']['parentId']['fromUnavailable'])),'Redacted history did not explain missing access.');
    $checks[]='historical-label-redaction';
    $stale=genesisSharedPreviewProjectAccess($owner,$spaceId,$member,['allProjects'=>false,'grants'=>[]]);
    genesisSharedCreateProject($owner,$spaceId,['title'=>'C6 concurrent project']);
    accessReject(fn()=>genesisSharedSaveProjectAccess($owner,$spaceId,$member,['allProjects'=>false,'grants'=>[],'expectedFingerprint'=>$stale['fingerprint'],'operationId'=>'c6-stale']),409);
    $unrestricted=genesisSharedPreviewProjectAccess($owner,$spaceId,$member,['allProjects'=>true,'grants'=>[]]);
    genesisSharedSaveProjectAccess($owner,$spaceId,$member,['allProjects'=>true,'grants'=>[],'expectedFingerprint'=>$unrestricted['fingerprint'],'operationId'=>'c6-all']);
    accessCheck(in_array($maps['space']['id'],array_column(genesisSharedMindmaps($member,$spaceId),'id'),true),'Unrestricted participant lost the space-wide map.');
    accessCheck(count(genesisSharedMindmaps($member,$spaceId,$maps['space']['id']))===1,'Unrestricted participant lost space-wide map history.');
    $owned=genesisSharedCreateProject($member,$spaceId,['title'=>'C6 sole owner']);
    $blocked=genesisSharedPreviewProjectAccess($owner,$spaceId,$member,['allProjects'=>false,'grants'=>[]]);
    accessCheck(in_array($owned['id'],array_column($blocked['blockers'],'projectId'),true),'Preview lost the sole owner blocker.');
    accessReject(fn()=>genesisSharedSaveProjectAccess($owner,$spaceId,$member,['allProjects'=>false,'grants'=>[],'expectedFingerprint'=>$blocked['fingerprint'],'operationId'=>'c6-owner']),409);
    accessCheck(genesisSharedProjectAccess($owned['id'],$member)['member_role']==='owner','Rejected change partially removed ownership.');
    accessCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'C6 changed foreign key integrity.');
    $checks[]='stale-preview-owner-rollback-and-foreign-keys';
    echo json_encode(['passed'=>$checks],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
}finally{
    foreach($spaces as $spaceId)genesisDb()->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$spaceId]);
    foreach($users as $userId)genesisDb()->prepare('DELETE FROM users WHERE id=?')->execute([$userId]);
}
