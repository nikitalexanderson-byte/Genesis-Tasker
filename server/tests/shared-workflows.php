<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&$ciDirectory&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused');
foreach(['repository','google','shared-projects','shared-google'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function wfCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function wfReject(callable $work,string $code):Throwable{
    try{$work();}catch(InvalidArgumentException|GenesisSharedAccessException $error){wfCheck($error->getMessage()===$code,'Unexpected '.$error->getMessage().' instead of '.$code);return $error;}throw new RuntimeException('Expected '.$code);
}
function wfSave(string $actor,string $project,array $rules,bool $enabled=true,array $extra=[]):array{
    return genesisSharedSaveWorkflow($actor,$project,['requestId'=>genesisUuid(),'expectedRevision'=>genesisWorkflowConfig($project)['revision'],'enabled'=>$enabled,...$rules,...$extra]);
}
function wfPatch(string $actor,string $project,array $task,array $patch):array{return genesisSharedTask($actor,$project,['requestId'=>genesisUuid(),'expectedRevision'=>$task['revision'],...$patch],$task['id']);}
function wfRules(array $statuses,array $required=[]):array{
    [$todo,$doing,$done]=array_column($statuses,'id');$roles=['owner','manager','member'];
    return ['statuses'=>[['statusId'=>$todo,'wipLimit'=>null,'requiredFields'=>[]],['statusId'=>$doing,'wipLimit'=>1,'requiredFields'=>$required],['statusId'=>$done,'wipLimit'=>null,'requiredFields'=>['assigneeId']]],
        'transitions'=>[['fromStatusId'=>null,'toStatusId'=>$todo,'roles'=>$roles],['fromStatusId'=>$todo,'toStatusId'=>$doing,'roles'=>['owner','manager']],['fromStatusId'=>$doing,'toStatusId'=>$todo,'roles'=>$roles],['fromStatusId'=>$doing,'toStatusId'=>$done,'roles'=>$roles],['fromStatusId'=>$done,'toStatusId'=>$todo,'roles'=>$roles]]];
}
if(($argv[1]??null)==='race'){
    [$mode,$actor,$project,$task,$status]=array_slice($argv,1);$user=genesisFindUser($actor);if(!$user||!str_contains($user['email'],'workflow-')||!str_ends_with($user['email'],'@example.invalid'))throw new RuntimeException('Wrong concurrent fixture actor');
    try{genesisSharedTask($actor,$project,['expectedRevision'=>1,'statusId'=>$status],$task);echo json_encode(['ok'=>true],JSON_THROW_ON_ERROR);}
    catch(GenesisSharedAccessException $error){echo json_encode(['ok'=>false,'error'=>$error->getMessage()],JSON_THROW_ON_ERROR);}exit;
}
$db=genesisDb();$users=[];$space=null;$checks=[];
try {
    $tag='workflow-'.genesisUuid();foreach(['owner','manager','member','viewer','outsider'] as $kind){$users[$kind]=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.$kind,'email'=>$tag.$kind.'@example.invalid','name'=>'Workflow '.$kind],[],false)['id'];genesisTestEnableSharedProjects($users[$kind]);}
    $owner=$users['owner'];$space=genesisSharedCreateSpace($owner,['title'=>'Workflow isolated'])['id'];
    foreach(['manager'=>'admin','member'=>'member','viewer'=>'guest'] as $kind=>$role)$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at,all_projects) VALUES(?,?,?,?,1)')->execute([$space,$users[$kind],$role,genesisNow()]);
    $db->prepare('UPDATE shared_space_members SET can_organize_tasks=1 WHERE space_id=? AND user_id=?')->execute([$space,$users['member']]);
    $project=genesisSharedCreateProject($owner,$space,['title'=>'Workflow A'])['id'];$other=genesisSharedCreateProject($owner,$space,['title'=>'Workflow B'])['id'];
    $statuses=genesisSharedProjectSnapshot($owner,$project)['statuses'];[$todo,$doing,$done]=array_column($statuses,'id');
    wfCheck(!genesisSharedWorkflow($owner,$project)['config']['enabled'],'Workflow enabled without consent');
    $legacy=genesisSharedTask($owner,$project,['title'=>'Legacy direct done','statusId'=>$done]);wfCheck($legacy['completedAt']!==null,'Disabled workflow changed legacy create semantics');
    $legacy=wfPatch($owner,$project,$legacy,['statusId'=>$todo]);
    $fields=[];foreach(['number','checkbox'] as $type){$input=['id'=>genesisUuid(),'title'=>'Workflow '.$type,'type'=>$type,'projectId'=>$project,'options'=>[],'position'=>count($fields),'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];$preview=genesisSharedPreviewCustomField($owner,$space,$input);$fields[$type]=genesisSharedSaveCustomField($owner,$space,[...$input,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']])['field'];}
    genesisSharedSavePlanning($owner,$project,['requestId'=>genesisUuid(),'expectedRevision'=>0,'enabled'=>true,'estimateUnit'=>'points']);
    $required=['description','storyPoints','custom:'.$fields['number']['id'],'custom:'.$fields['checkbox']['id']];$rules=wfRules($statuses,$required);
    wfReject(fn()=>wfSave($users['viewer'],$project,$rules),'SHARED_PROJECT_FORBIDDEN');
    wfReject(fn()=>genesisSharedWorkflow($users['outsider'],$project),'SHARED_PROJECT_NOT_FOUND');
    $firstInput=['requestId'=>genesisUuid(),'expectedRevision'=>0,'enabled'=>true,...$rules];$saved=genesisSharedSaveWorkflow($owner,$project,$firstInput);
    wfCheck(genesisSharedSaveWorkflow($owner,$project,$firstInput)===$saved,'Settings replay diverged');
    wfReject(fn()=>genesisSharedSaveWorkflow($owner,$project,[...$firstInput,'enabled'=>false]),'SHARED_REQUEST_ID_CONFLICT');
    wfReject(fn()=>wfSave($owner,$project,$rules,true,['expectedRevision'=>0]),'WORKFLOW_CONFLICT');
    wfCheck(count(genesisSharedWorkflowHistory($users['viewer'],$project)['versions'])===1,'Viewer history missing');$checks[]='opt-in/ACL/CAS/replay/history';
    $values=['storyPoints'=>0,'customFields'=>[$fields['number']['id']=>0,$fields['checkbox']['id']=>false]];
    $task=genesisSharedTask($owner,$project,['title'=>'Validated task','statusId'=>$todo,...$values]);
    $error=wfReject(fn()=>wfPatch($owner,$project,$task,['statusId'=>$doing]),'WORKFLOW_REQUIRED_FIELDS');wfCheck(in_array('description',$error->details['fields'],true),'Missing field explanation absent');
    wfCheck(genesisSharedGetTask($owner,$project,$task['id'])['revision']===$task['revision'],'Rejected entry partially wrote task');
    wfReject(fn()=>wfPatch($users['member'],$project,$task,['statusId'=>$doing,'description'=>'Ready']),'WORKFLOW_ROLE_FORBIDDEN');
    wfReject(fn()=>wfPatch($owner,$project,$task,['statusId'=>$done]),'WORKFLOW_TRANSITION_FORBIDDEN');
    wfReject(fn()=>genesisSharedTask($owner,$project,['title'=>'Invalid direct entry','statusId'=>$doing,'description'=>'Ready',...$values]),'WORKFLOW_TRANSITION_FORBIDDEN');
    $task=wfPatch($owner,$project,$task,['statusId'=>$doing,'description'=>'Ready']);wfCheck($task['storyPoints']===0&&((array)$task['customFields'])[$fields['checkbox']['id']]===false,'Zero/false required values rejected/lost');
    wfReject(fn()=>wfPatch($owner,$project,$task,['description'=>'']),'WORKFLOW_REQUIRED_FIELDS');
    $second=genesisSharedTask($owner,$project,['title'=>'Second task','statusId'=>$todo,'description'=>'Ready',...$values]);
    $limit=wfReject(fn()=>wfPatch($owner,$project,$second,['statusId'=>$doing]),'WORKFLOW_WIP_LIMIT');wfCheck($limit->details['limit']===1&&$limit->details['count']===2,'WIP explanation incorrect');
    $tight=$rules;$tight['statuses'][1]['wipLimit']=0;wfReject(fn()=>wfSave($owner,$project,$tight),'WORKFLOW_WIP_LIMIT');wfCheck(genesisWorkflowConfig($project)['revision']===1,'Rejected settings revision leaked');
    $unsafe=$rules;$unsafe['transitions']=array_values(array_filter($unsafe['transitions'],fn($edge)=>$edge['toStatusId']!==$done));wfReject(fn()=>wfSave($owner,$project,$unsafe),'WORKFLOW_NO_SAFE_EXIT');$checks[]='transitions/roles/required/zero/false/WIP/rollback';
    wfReject(fn()=>genesisSharedUpdateStatus($owner,$project,$doing,['title'=>'Doing','isDone'=>true,'expectedRevision'=>(int)$statuses[1]['revision']]),'WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE');
    wfReject(fn()=>genesisSharedDeleteStatus($owner,$project,$doing,['destinationStatusId'=>$todo,'expectedRevision'=>(int)$statuses[1]['revision']]),'WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE');
    wfReject(fn()=>genesisSharedCreateStatus($owner,$project,['title'=>'Unconfigured']),'WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE');
    $field=$fields['checkbox'];$fieldInput=[...$field,'expectedRevision'=>$field['revision'],'archived'=>true];unset($fieldInput['spaceId'],$fieldInput['revision'],$fieldInput['predecessorId']);$preview=genesisSharedPreviewCustomField($owner,$space,$fieldInput);
    wfReject(fn()=>genesisSharedSaveCustomField($owner,$space,[...$fieldInput,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]),'WORKFLOW_FIELD_IN_USE');$checks[]='status/field safety';
    $task=wfPatch($owner,$project,$task,['approvalRequired'=>true,'approverIds'=>[$owner]]);
    wfReject(fn()=>genesisSharedApproveTask($owner,$project,$task['id']),'WORKFLOW_REQUIRED_FIELDS');wfCheck(genesisSharedTaskApprovals($task['id'])[0]['approvedAt']===null,'Rejected approval partially acknowledged');
    $task=wfPatch($owner,$project,$task,['assigneeId'=>$owner]);$task=genesisSharedApproveTask($owner,$project,$task['id']);wfCheck($task['completedAt']!==null,'Existing approval failed to complete valid workflow transition');$checks[]='existing approval atomicity';
    $second=wfPatch($owner,$project,$second,['statusId'=>$doing]);$secondArchived=genesisSharedArchiveTask($owner,$project,$second['id'],['archived'=>true,'expectedRevision'=>$second['revision']]);
    $third=genesisSharedTask($owner,$project,['title'=>'Third task','statusId'=>$todo,'description'=>'Ready',...$values]);$third=wfPatch($owner,$project,$third,['statusId'=>$doing]);
    wfReject(fn()=>genesisSharedArchiveTask($owner,$project,$second['id'],['archived'=>false,'expectedRevision'=>$secondArchived['revision']]),'WORKFLOW_WIP_LIMIT');
    wfCheck(genesisSharedGetTask($owner,$project,$second['id'],true)['archivedAt']!==null,'Failed unarchive leaked');
    $trashed=genesisSharedTrashTask($owner,$project,$third['id'],['expectedRevision'=>$third['revision']]);
    genesisSharedArchiveTask($owner,$project,$second['id'],['archived'=>false,'expectedRevision'=>$secondArchived['revision']]);
    wfReject(fn()=>genesisSharedRestoreTrash($owner,$space,'task',$third['id'],['expectedExpiresAt'=>$trashed['expiresAt']]),'WORKFLOW_WIP_LIMIT');
    wfCheck((bool)genesisPlanningRows("SELECT object_id FROM shared_trash WHERE kind='task' AND object_id=?",[$third['id']]),'Failed trash restore leaked');$checks[]='archive/trash restoration';
    genesisSharedSetArchived($owner,$project,true);$off=wfSave($owner,$project,[],false);wfCheck(!$off['config']['enabled'],'Archived workflow cannot be repaired');genesisSharedSetArchived($owner,$project,false);wfSave($owner,$project,$rules);
    $managerInput=['requestId'=>genesisUuid(),'expectedRevision'=>genesisWorkflowConfig($project)['revision'],'enabled'=>false];genesisSharedSaveWorkflow($users['manager'],$project,$managerInput);
    $db->prepare("UPDATE shared_space_members SET role='guest' WHERE space_id=? AND user_id=?")->execute([$space,$users['manager']]);$db->prepare("UPDATE shared_project_members SET role='viewer' WHERE project_id=? AND user_id=?")->execute([$project,$users['manager']]);
    wfReject(fn()=>genesisSharedSaveWorkflow($users['manager'],$project,$managerInput),'SHARED_PROJECT_FORBIDDEN');
    foreach(genesisPlanningRows('SELECT definition_json FROM shared_project_workflow_versions WHERE project_id=?',[$project]) as $row)wfCheck(str_starts_with($row['definition_json'],GENESIS_SHARED_CONTENT_PREFIX),'Plaintext workflow history');$checks[]='archived repair/revoke/encryption';
    $race=genesisSharedCreateProject($owner,$space,['title'=>'Workflow race'])['id'];$raceStatuses=genesisSharedProjectSnapshot($owner,$race)['statuses'];$raceRules=wfRules($raceStatuses);$raceRules['statuses'][2]['requiredFields']=[];wfSave($owner,$race,$raceRules);
    $raceTasks=[];for($i=0;$i<2;$i++)$raceTasks[]=genesisSharedTask($owner,$race,['title'=>'Racer '.$i,'statusId'=>$raceStatuses[0]['id']]);
    $processes=[];foreach($raceTasks as $row){$pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'race',$owner,$race,$row['id'],$raceStatuses[1]['id']],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);if(!is_resource($process))throw new RuntimeException('Cannot launch race');fclose($pipes[0]);$processes[]=[$process,$pipes];}
    $results=[];foreach($processes as [$process,$pipes]){$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);wfCheck(proc_close($process)===0,'Race child failed '.$err);$results[]=json_decode($out,true,32,JSON_THROW_ON_ERROR);}
    wfCheck(count(array_filter($results,fn($row)=>$row['ok']))===1&&count(array_filter($results,fn($row)=>($row['error']??null)==='WORKFLOW_WIP_LIMIT'))===1,'Concurrent WIP did not serialize '.json_encode($results));$checks[]='two process concurrent WIP';
    require_once __DIR__.'/workflow-integrations.php';$checks=[...$checks,...wfIntegrations($owner,$space,$users)];
    echo json_encode(['pass'=>true,'checks'=>$checks],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n";
}finally{
    if($db->inTransaction())$db->rollBack();if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space]);foreach($users as $id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
