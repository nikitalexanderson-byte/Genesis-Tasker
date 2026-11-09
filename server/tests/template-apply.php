<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused.');
foreach(['repository','google','shared-projects','shared-google','template-apply'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function taCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function taReject(callable $action,string $code):void{try{$action();}catch(InvalidArgumentException|GenesisSharedAccessException $e){taCheck($e->getMessage()===$code,'Unexpected '.$e->getMessage().' instead of '.$code);return;}throw new RuntimeException('Expected '.$code);}
$db=genesisDb();$user=null;$spaceId=null;$member=null;
try{
    $tag='c1-apply-'.genesisUuid();$user=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag,'email'=>$tag.'@example.invalid','name'=>'C1 apply isolated'],[],false)['id'];genesisTestEnableSharedProjects($user);
    $space=genesisSharedCreateSpace($user,['title'=>'C1 apply fixture']);$spaceId=$space['id'];$library=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 library']);
    $context=['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march'];
    $manifest=['schemaVersion'=>1,'kind'=>'project','calendarMode'=>'profane','calendarContext'=>$context,
        'projects'=>[['key'=>'root','title'=>'Новый проект','description'=>'Описание проекта','parentKey'=>null,'layout'=>'board','kind'=>'project','categories'=>[['key'=>'category','title'=>'Категория','color'=>'#abcdef']],
            'statuses'=>[['key'=>'todo','title'=>'Подготовка','isDone'=>false],['key'=>'doing','title'=>'Работа','isDone'=>false],['key'=>'done','title'=>'Готово','isDone'=>true]],'labelKeys'=>['label']],
            ['key'=>'nested','title'=>'Подпроект','description'=>'Вложенное описание','parentKey'=>'root','boardStatusKey'=>'doing','layout'=>'list','kind'=>'task-list',
                'statuses'=>[['key'=>'nested-todo','title'=>'Очередь','isDone'=>false],['key'=>'nested-done','title'=>'Итог','isDone'=>true]]]],
        'labels'=>[['key'=>'label','title'=>'Запуск','color'=>'#abcdef']],
        'fields'=>[['key'=>'number','projectKey'=>'root','title'=>'Количество','type'=>'number','options'=>[],'required'=>false,'showCard'=>true,'showList'=>true],
            ['key'=>'flag','projectKey'=>null,'title'=>'Подтверждено','type'=>'checkbox','options'=>[],'required'=>true,'showCard'=>true,'showList'=>false],
            ['key'=>'select','projectKey'=>'root','title'=>'Вариант','type'=>'select','options'=>[['id'=>'choice','title'=>'Первый','archived'=>false]],'required'=>false,'showCard'=>true,'showList'=>true]],
        'tasks'=>[['key'=>'parent','projectKey'=>'root','title'=>'Родитель','description'=>'Пользовательская кириллица','statusKey'=>'doing','categoryKey'=>'category','labelKeys'=>['label'],'priority'=>2,'assigneeId'=>$user,
            'due'=>['amount'=>1,'unit'=>'month'],'start'=>['amount'=>0,'unit'=>'day'],'startTime'=>'09:00','endTime'=>'10:30','customValues'=>['number'=>0,'flag'=>false,'select'=>'choice'],
            'approvalRequired'=>true,'approverIds'=>[$user],
            'checklists'=>[['key'=>'list','title'=>'Проверка','items'=>[['key'=>'item','title'=>'Проверить','linkedTaskKey'=>'child','assigneeId'=>$user,'due'=>['amount'=>1,'unit'=>'month']]]]]],
            ['key'=>'child','projectKey'=>'root','parentKey'=>'parent','title'=>'Дочерняя','statusKey'=>'done','dependsOnKeys'=>['leaf'],'customValues'=>['flag'=>false]],
            ['key'=>'leaf','projectKey'=>'root','title'=>'До начала','statusKey'=>'todo','customValues'=>['flag'=>true]],
            ['key'=>'nested-task','projectKey'=>'nested','title'=>'Во вложенном проекте','statusKey'=>'nested-todo','customValues'=>['flag'=>false]]]];
    $saved=genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Запуск','manifest'=>$manifest]);$id=$saved['id'];
    $options=['spaceId'=>$spaceId,'anchorDate'=>'2024-01-31','title'=>'Мой запуск'];
    $counts=static function()use($db):array{$out=[];foreach(['shared_projects','shared_project_members','shared_member_project_grants','shared_tasks','shared_project_statuses','shared_space_labels','shared_task_dependencies','shared_task_approvals','shared_audit_events','shared_notification_outbox','shared_notification_recipients','shared_notification_task_state','shared_custom_fields','shared_custom_field_values','shared_custom_field_versions','shared_custom_field_receipts','shared_template_operations'] as $table)$out[$table]=(int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();return $out;};
    $before=$counts();$preview=genesisSharedPreviewTemplate($user,$id,$options);
    taCheck($counts()===$before,'Preview wrote persistent records');taCheck($preview['canApply'],'Valid project preview blocked: '.json_encode($preview['blockers']));
    taCheck(count($preview['newFields'])===4,'Space fields were not narrowed into each new project scope');
    taCheck($preview['tasks'][0]['dueDate']==='2024-02-29'&&$preview['tasks'][0]['customValues']['new:root:number']===0&&$preview['tasks'][0]['customValues']['new:root:flag']===false,'Plan lost clamp/zero/false');
    taCheck(in_array('TEMPLATE_DATE_CLAMPED',array_column($preview['notices'],'code'),true),'Clamp not explained');
    $excluded=genesisSharedPreviewTemplate($user,$id,[...$options,'include'=>['descriptions'=>false,'tags'=>false,'labels'=>false,'customFields'=>false,'assignees'=>false,'checklists'=>false,'dependencies'=>false,'dates'=>false,'approvals'=>false,'subtasks'=>false]]);
    taCheck($excluded['canApply']&&count($excluded['tasks'])===3&&$excluded['newFields']===[]&&$excluded['tasks'][0]['description']===''&&$excluded['tasks'][0]['checklists']===[]&&$excluded['tasks'][0]['assigneeId']===null&&$excluded['tasks'][0]['dueDate']===null&&$excluded['tasks'][0]['approverIds']===[],'Explicit transfer choices not honoured');
    // Simulate a failure late in a multi-project application, after fields, values and the first tasks.
    $db->exec("CREATE TEMP TRIGGER c1_apply_failure BEFORE INSERT ON shared_tasks WHEN NEW.title='До начала' BEGIN SELECT RAISE(ABORT,'isolated late failure'); END");
    $command=[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']];$failed=false;
    try{genesisSharedApplyTemplate($user,$id,$command);}catch(PDOException $error){$failed=str_contains($error->getMessage(),'isolated late failure');}
    genesisBeginWriteTransaction($db);$outerFailed=false;
    try{genesisSharedApplyTemplate($user,$id,$command);}catch(PDOException $error){$outerFailed=str_contains($error->getMessage(),'isolated late failure');}
    taCheck($outerFailed&&$db->inTransaction()&&$counts()===$before,'Nested apply leaked changes or rolled back its caller');$db->commit();
    $db->exec('DROP TRIGGER c1_apply_failure');taCheck($failed&&$counts()===$before,'Late failure leaked a partial project, field, task, notification or receipt');
    $result=genesisSharedApplyTemplate($user,$id,$command);$after=$counts();
    taCheck($result['projectCount']===2&&$result['taskCount']===4,'Wrong apply counts');
    foreach($result['statusIds'] as $statusId)taCheck(!str_starts_with($statusId,'chaos-'),'Internal inbox status displaced a template board');
    taCheck(genesisSharedApplyTemplate($user,$id,$command)===$result&&$counts()===$after,'Lost response retry created duplicates');
    taReject(fn()=>genesisSharedApplyTemplate($user,$id,[...$command,'title'=>'Changed request']),'TEMPLATE_OPERATION_REUSED');
    $created=genesisSharedGetTask($user,$result['projectIds']['root'],$result['taskIds']['parent']);
    $child=genesisSharedGetTask($user,$result['projectIds']['root'],$result['taskIds']['child']);
    $created['customFields']=(array)$created['customFields'];
    taCheck($created['description']==='Пользовательская кириллица'&&$created['priority']===2&&$created['startDate']==='2024-01-31'&&$created['dueDate']==='2024-02-29','Content/schedule lost');
    taCheck($created['customFields'][$result['fieldIds']['new:root:number']]===0&&$created['customFields'][$result['fieldIds']['new:root:flag']]===false,'Created task lost typed0/false');
    taCheck($created['customFields'][$result['fieldIds']['new:root:select']]===$result['optionIds']['new:root:select']['choice'],'Option ID map lost');
    taCheck($child['parentTaskId']===$created['id']&&$child['completedAt']===null&&$child['dependsOnIds']===[$result['taskIds']['leaf']],'Parent/dependency/completion reset incorrect');
    taCheck($created['checklists'][0]['items'][0]['linkedTaskId']===$child['id']&&!$created['checklists'][0]['items'][0]['done'],'Checklist link or reset lost');
    taCheck($created['approvals'][0]['approvedAt']===null&&$created['approvals'][0]['userId']===$user,'Approval policy/confirmation reset lost');
    taReject(fn()=>genesisSharedTask($user,$result['projectIds']['root'],['expectedRevision'=>$created['revision'],'statusId'=>$result['statusIds']['done']],$created['id']),'TASK_CHILDREN_INCOMPLETE');
    taCheck(genesisSharedProjectAccess($result['rootProjectId'],$user)['title']==='Мой запуск','Root title override lost');
    taCheck(genesisSharedProjectAccess($result['projectIds']['nested'],$user)['board_status_id']===$result['statusIds']['doing'],'Nested board structure lost');
    foreach(genesisSharedCustomFields($user,$spaceId) as $field)taCheck($field['projectId']!==null,'Template silently imposed a required workspace field');
    // CAS includes both the source template and effective destination definitions/members.
    $stale=genesisSharedPreviewTemplate($user,$id,$options);
    genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'expectedRevision'=>1,'title'=>'Переименован'], $id);
    taReject(fn()=>genesisSharedApplyTemplate($user,$id,[...$options,'operationId'=>genesisUuid(),'fingerprint'=>$stale['fingerprint']]),'TEMPLATE_PREVIEW_CHANGED');
    $taskManifest=$manifest;$taskManifest['kind']='task';$taskManifest['projects']=[$manifest['projects'][0]];$taskManifest['tasks']=array_slice($manifest['tasks'],0,3);$taskManifest['tasks'][2]['parentKey']='parent';
    $taskId=genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Повтор задачи','manifest'=>$taskManifest])['id'];
    $target=genesisSharedCreateProject($user,$spaceId,['title'=>'Существующий проект']);$taskOptions=['spaceId'=>$spaceId,'projectId'=>$target['id'],'anchorDate'=>'2024-01-31'];
    $missing=genesisSharedPreviewTemplate($user,$taskId,$taskOptions);taCheck(!$missing['canApply']&&in_array('TEMPLATE_FIELD_VALUE_UNMAPPED',array_column($missing['blockers'],'code'),true),'Unmapped custom values silently dropped');
    $fields=[];foreach($taskManifest['fields'] as $field){$definition=['id'=>genesisUuid(),'title'=>$field['title'],'type'=>$field['type'],'projectId'=>$target['id'],'options'=>$field['options'],'position'=>0,
        'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'archived'=>false,'expectedRevision'=>0];$fp=genesisSharedPreviewCustomField($user,$spaceId,$definition);
        $fields[$field['key']]=genesisSharedSaveCustomField($user,$spaceId,[...$definition,'operationId'=>genesisUuid(),'fingerprint'=>$fp['fingerprint']])['field']['id'];}
    $mapped=genesisSharedPreviewTemplate($user,$taskId,$taskOptions);taCheck($mapped['canApply'],'Automatic field mapping failed');
    $copied=genesisSharedApplyTemplate($user,$taskId,[...$taskOptions,'operationId'=>genesisUuid(),'fingerprint'=>$mapped['fingerprint']]);
    $copy=genesisSharedGetTask($user,$target['id'],$copied['taskIds']['parent']);$copy['customFields']=(array)$copy['customFields'];taCheck($copy['customFields'][$fields['flag']]===false&&$copy['customFields'][$fields['number']]===0,'Existing project mapping lost values');
    $noFields=genesisSharedPreviewTemplate($user,$taskId,[...$taskOptions,'include'=>['customFields'=>false]]);
    taCheck(!$noFields['canApply']&&in_array('CUSTOM_FIELD_REQUIRED',array_column($noFields['blockers'],'code'),true),'Destination required policy bypassed');
    $provided=[];foreach($taskManifest['tasks'] as $task)$provided[$task['key']]=[$fields['flag']=>false];
    $resolved=genesisSharedPreviewTemplate($user,$taskId,[...$taskOptions,'include'=>['customFields'=>false],'fieldValues'=>$provided]);taCheck($resolved['canApply'],'Required false override rejected');
    // Assignments never grant membership. Missing approvers block until explicitly remapped/excluded.
    $member=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.'-member','email'=>$tag.'-member@example.invalid','name'=>'C1 restricted'],[],false)['id'];genesisTestEnableSharedProjects($member);
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'member',0,?)")->execute([$spaceId,$member,genesisNow()]);
    $access=['allProjects'=>false,'grants'=>[['projectId'=>$target['id'],'role'=>'member','includeDescendants'=>true]]];$fp=genesisSharedPreviewProjectAccess($user,$spaceId,$member,$access);
    genesisSharedSaveProjectAccess($user,$spaceId,$member,[...$access,'operationId'=>genesisUuid(),'expectedFingerprint'=>$fp['fingerprint']]);
    $memberManifest=$taskManifest;$memberManifest['tasks'][0]['assigneeId']=$member;$memberManifest['tasks'][0]['approverIds']=[$member];
    $memberId=genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Участник','manifest'=>[...$memberManifest,'kind'=>'project']])['id'];
    $blocked=genesisSharedPreviewTemplate($user,$memberId,$options);taCheck(!$blocked['canApply']&&in_array('APPROVER_NOT_AVAILABLE',array_column($blocked['blockers'],'code'),true),'Missing approver silently removed');
    $inherited=genesisSharedPreviewTemplate($user,$memberId,[...$options,'parentProjectId'=>$target['id']]);taCheck($inherited['canApply']&&in_array($member,array_column($inherited['members'],'id'),true),'C6 inherited destination member not available');
    $assigned=genesisSharedApplyTemplate($user,$memberId,[...$options,'parentProjectId'=>$target['id'],'operationId'=>genesisUuid(),'fingerprint'=>$inherited['fingerprint']]);
    taCheck(genesisSharedGetTask($user,$assigned['rootProjectId'],$assigned['taskIds']['parent'])['assigneeId']===$member,'Inherited member assignment not applied');
    taReject(fn()=>genesisSharedPreviewTemplate($member,$taskId,$taskOptions),'SHARED_PROJECT_NOT_FOUND');
    genesisBeginWriteTransaction($db);$policy=['createProjects'=>true,'editTasks'=>false,'organizeTasks'=>false,'comment'=>false,'manageProjects'=>false,'inviteMembers'=>false];
    $db->prepare('UPDATE shared_space_members SET project_access_restricted=0,all_projects=1,permissions_json=? WHERE space_id=? AND user_id=?')->execute([json_encode($policy,JSON_THROW_ON_ERROR),$spaceId,$member]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'viewer',?)")->execute([$library['id'],$member,genesisNow()]);
    $policyPreview=genesisSharedPreviewTemplate($member,$id,$options);
    taCheck(!$policyPreview['canApply']&&in_array('SHARED_PROJECT_FORBIDDEN',array_column($policyPreview['blockers'],'code'),true)&&in_array('TEMPLATE_CATEGORY_CREATE_FORBIDDEN',array_column($policyPreview['blockers'],'code'),true),'Preview ignored custom space permissions for a new project');$db->rollBack();
    foreach(['ru','en','de','el','es','fr','it','ja','pl','pt','sr','tr','uk','zh'] as $language){
        $starters=genesisSharedStarterTemplates($language);taCheck(count($starters)===4&&count(array_unique(array_column($starters,'id')))===4,'Missing localized system starter');
        foreach($starters as $starter){taCheck($starter['system']&&$starter['revision']===1,'System marker lost');genesisTemplateManifest($starter['manifest']);
            $systemPreview=genesisSharedPreviewTemplate($user,$starter['id'],[...$taskOptions,'projectId'=>$starter['kind']==='task'?$target['id']:null,'language'=>$language,
                'fieldValues'=>$starter['kind']==='task'?array_fill_keys(array_column($starter['manifest']['tasks'],'key'),[$fields['flag']=>false]):[]]);
            taCheck($systemPreview['canApply'],'System template blocked for '.$language);}
    }
    $starterOptions=[...$options,'language'=>'ja'];$starterPreview=genesisSharedPreviewTemplate($user,'system:launch',$starterOptions);$systemCommand=[...$starterOptions,'operationId'=>genesisUuid(),'fingerprint'=>$starterPreview['fingerprint']];
    $systemApplied=genesisSharedApplyTemplate($user,'system:launch',$systemCommand);taCheck($systemApplied===genesisSharedApplyTemplate($user,'system:launch',$systemCommand),'System retry duplicated application');
    taCheck(genesisSharedGetTask($user,$systemApplied['rootProjectId'],$systemApplied['taskIds']['task-0'])['title']==='計画を合意する','System task content not localized');
    taReject(fn()=>genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Try changing system','expectedRevision'=>1],'system:launch'),'TEMPLATE_UNAVAILABLE');
    // Current destination policy changes invalidate the preview, preserving the caller's draft.
    $beforePolicy=genesisSharedPreviewTemplate($user,$taskId,$taskOptions);$extra=['id'=>genesisUuid(),'title'=>'Новая политика','type'=>'text','projectId'=>$target['id'],'options'=>[],'position'=>20,'required'=>true,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];
    $fp=genesisSharedPreviewCustomField($user,$spaceId,$extra);genesisSharedSaveCustomField($user,$spaceId,[...$extra,'operationId'=>genesisUuid(),'fingerprint'=>$fp['fingerprint']]);
    taReject(fn()=>genesisSharedApplyTemplate($user,$taskId,[...$taskOptions,'operationId'=>genesisUuid(),'fingerprint'=>$beforePolicy['fingerprint']]),'TEMPLATE_PREVIEW_CHANGED');
    // Lower a fixture quota inside a transaction, then restore it by rolling back.
    genesisBeginWriteTransaction($db);$db->exec("UPDATE resource_quota_limits SET amount=1 WHERE name='projects_per_space'");$limited=genesisSharedPreviewTemplate($user,$id,$options);
    taCheck(!$limited['canApply']&&in_array('TEMPLATE_RESOURCE_LIMIT',array_column($limited['blockers'],'code'),true),'Quota missing from preview');taCheck($db->inTransaction(),'Preview committed caller transaction');$db->rollBack();
    taCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign key failure');
    $db->prepare('INSERT INTO shared_task_approvals(id,task_id,user_id) VALUES(?,?,NULL)')->execute([genesisUuid(),$result['taskIds']['parent']]);
    $former=genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Former approver policy','sourceProjectId'=>$result['rootProjectId'],'sourceTaskId'=>$result['taskIds']['parent'],
        'capture'=>['calendarMode'=>'profane','calendarContext'=>$context,'anchorDate'=>'2026-10-18']]);
    $formerOptions=['spaceId'=>$spaceId,'projectId'=>$result['rootProjectId'],'anchorDate'=>'2026-10-18'];$formerPreview=genesisSharedPreviewTemplate($user,$former['id'],$formerOptions);
    taCheck(!$formerPreview['canApply']&&in_array('TEMPLATE_APPROVERS_REQUIRED',array_column($formerPreview['blockers'],'code'),true),'A partly deleted approval list silently weakened the completion policy');
    $omitted=genesisSharedPreviewTemplate($user,$former['id'],[...$formerOptions,'include'=>['approvals'=>false]]);taCheck($omitted['canApply'],'Explicit approval exclusion did not resolve missing former approver');
    $access['grants'][]=['projectId'=>$result['rootProjectId'],'role'=>'viewer','includeDescendants'=>false];$fp=genesisSharedPreviewProjectAccess($user,$spaceId,$member,$access);
    genesisSharedSaveProjectAccess($user,$spaceId,$member,[...$access,'operationId'=>genesisUuid(),'expectedFingerprint'=>$fp['fingerprint']]);
    $edited=genesisSharedTemplateSource($user,$former['id']);$edited['manifest']['tasks'][0]['approverIds'][]=$member;
    genesisSharedSaveTemplate($user,$spaceId,$library['id'],['operationId'=>genesisUuid(),'title'=>'Explicit replacement','expectedRevision'=>1,'manifest'=>$edited['manifest']],$former['id']);
    taCheck(genesisSharedPreviewTemplate($user,$former['id'],$formerOptions)['canApply'],'Explicit replacement of the former approver not accepted');
    require __DIR__.'/task-graph-integrations.php';
    taGraphIntegrations($user,$spaceId,$library['id'],$member,$context);
    echo "Templates apply: read-only preview, relative dates, typed values and ID maps, atomic late rollback, replay/CAS, required/mapped fields, structure/relations/approval resets and C6 destination inheritance passed.\n";
}finally{
    if($db->inTransaction())$db->rollBack();$db->exec('DROP TRIGGER IF EXISTS c1_apply_failure');
    if($spaceId)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$spaceId]);foreach([$user,$member] as $value)if($value)$db->prepare('DELETE FROM users WHERE id=?')->execute([$value]);
}
