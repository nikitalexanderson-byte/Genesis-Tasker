<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused.');
foreach(['repository','google','shared-projects','shared-google','template-manifest','template-capture','shared-templates'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function tmCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function tmReject(callable $action,string $code):void{try{$action();}catch(InvalidArgumentException|GenesisSharedAccessException $e){tmCheck($e->getMessage()===$code,'Unexpected '.$e->getMessage().' instead of '.$code);return;}throw new RuntimeException('Expected '.$code);}
$context=['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march'];
$manifest=['schemaVersion'=>1,'kind'=>'task','calendarMode'=>'lunar','calendarContext'=>$context,
 'projects'=>[['key'=>'project-a','parentKey'=>null,'title'=>'Источник · русский текст','description'=>'Описание','layout'=>'board','kind'=>'project',
  'statuses'=>[['key'=>'open','title'=>'Первый этап','isDone'=>false],['key'=>'done','title'=>'Итог','isDone'=>true]],'categories'=>[],'labelKeys'=>['label']]],
 'labels'=>[['key'=>'label','title'=>'Проверка','color'=>'#abcdef']],
 'fields'=>[['key'=>'points','projectKey'=>'project-a','title'=>'Объём','type'=>'number','required'=>false,'showCard'=>true,'showList'=>true,'options'=>[]],
  ['key'=>'flag','projectKey'=>null,'title'=>'Проверено','type'=>'checkbox','required'=>true,'showCard'=>true,'showList'=>false,'options'=>[]]],
 'tasks'=>[['key'=>'root','projectKey'=>'project-a','parentKey'=>null,'title'=>'Корневая задача','statusKey'=>'open','labelKeys'=>['label'],
   'customValues'=>['points'=>0,'flag'=>false],'due'=>['amount'=>1,'unit'=>'month'],
   'checklists'=>[['key'=>'checklist','title'=>'Контроль','items'=>[['key'=>'item','title'=>'Связанный пункт','linkedTaskKey'=>'child']]]]],
  ['key'=>'child','projectKey'=>'project-a','parentKey'=>'root','title'=>'Подзадача','statusKey'=>'open','customValues'=>['flag'=>true]]]];
$legacy=$manifest;
$legacy['fields'][]=['key'=>'legacy-extra','projectKey'=>'project-a','title'=>'Legacy choices','type'=>'select','required'=>false,'showCard'=>true,'showList'=>true,
    'options'=>array_map(static fn($i)=>['id'=>'legacy-'.$i,'title'=>'Choice '.$i,'archived'=>$i===0],range(0,200))];
$legacyNormal=genesisTemplateManifest($legacy);tmCheck(count($legacyNormal['fields'][2]['options'])===201,'Legacy archived choices were dropped from a template');
$legacy['fields'][2]['options'][0]['archived']=false;tmReject(fn()=>genesisTemplateManifest($legacy),'TEMPLATE_INVALID');
$normal=genesisTemplateManifest($manifest);
tmCheck(json_encode(genesisTemplateManifest($normal))===json_encode($normal),'Manifest normalization not idempotent');
tmCheck((array)$normal['tasks'][0]['customValues']===['points'=>0,'flag'=>false],'Manifest lost0/false');
tmCheck($normal['calendarContext']===$context&&$normal['tasks'][0]['due']===['amount'=>1,'unit'=>'month'],'Manifest rewrote calendar-relative date');
foreach(['permissions','files','comments','automations','notificationJobs'] as $unsupported)tmReject(fn()=>genesisTemplateManifest([...$manifest,$unsupported=>[]]),'TEMPLATE_INVALID');
$bad=$manifest;$bad['tasks'][1]['dependsOnKeys']=['root'];tmReject(fn()=>genesisTemplateManifest($bad),'TASK_RELATION_CYCLE');
$bad=$manifest;$bad['projects'][0]['boardStatusKey']=[];tmReject(fn()=>genesisTemplateManifest($bad),'TEMPLATE_INVALID');
$bad=$manifest;$bad['tasks'][1]['parentKey']='unknown';tmReject(fn()=>genesisTemplateManifest($bad),'TEMPLATE_REFERENCE_INVALID');
$bad=$manifest;$bad['tasks'][0]['customValues']['points']='0';tmReject(fn()=>genesisTemplateManifest($bad),'CUSTOM_FIELD_VALUE_INVALID');
$bad=$manifest;$bad['tasks'][0]['due']['unit']='week';tmReject(fn()=>genesisTemplateManifest($bad),'TEMPLATE_DATE_INVALID');
$empty=[...$manifest,'kind'=>'project','tasks'=>[]];tmCheck(genesisTemplateManifest($empty)['tasks']===[],'Empty project structure rejected');

$db=genesisDb();$user=null;$spaceId=null;$member=null;
try{
 $tag='c1-atomic-'.genesisUuid();$user=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag,'email'=>$tag.'@example.invalid','name'=>'C1 isolated'],[],false)['id'];genesisTestEnableSharedProjects($user);
 $space=genesisSharedCreateSpace($user,['title'=>'C1 atomic fixture']);$spaceId=$space['id'];
 $counts=static function()use($db):array{$out=[];foreach(['shared_projects','shared_project_members','shared_project_statuses','shared_space_labels','shared_project_categories','shared_custom_fields','shared_custom_field_values','shared_custom_field_versions','shared_custom_field_receipts','shared_tasks','shared_audit_events'] as $table)$out[$table]=(int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();return $out;};
 $before=$counts();genesisBeginWriteTransaction($db);
 $root=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 root','statuses'=>[['title'=>'Новое','isDone'=>false,'color'=>'#abcdef','taskTitleLines'=>1,'visibleTaskCount'=>8],['title'=>'Завершено','isDone'=>true]]]);
 tmCheck($db->inTransaction(),'Project factory committed caller transaction');
 $snapshot=genesisSharedProjectSnapshot($user,$root['id']);tmCheck(count($snapshot['statuses'])===2&&$snapshot['statuses'][0]['color']==='#abcdef'&&(int)$snapshot['statuses'][0]['taskTitleLines']===1,'Project template status structure/display lost');
 $child=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 child','parentId'=>$root['id'],'boardStatusId'=>$snapshot['statuses'][0]['id']]);
 genesisSharedCreateStatus($user,$root['id'],['title'=>'Дополнительный этап','isDone'=>false]);
 $category=genesisSharedCreateCategory($user,$root['id'],['title'=>'Категория']);
 $label=genesisSharedSaveLabel($user,$spaceId,null,['title'=>'Метка','color'=>'#abcdef']);
 $field=['id'=>genesisUuid(),'title'=>'Поле в общей транзакции','type'=>'number','projectId'=>$root['id'],'options'=>[],'position'=>0,'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];
 $preview=genesisSharedPreviewCustomField($user,$spaceId,$field);$command=[...$field,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']];
 genesisSharedSaveCustomField($user,$spaceId,$command);genesisSharedSaveCustomField($user,$spaceId,$command);
 tmCheck($db->inTransaction(),'Field replay committed caller transaction');
 $task=genesisSharedTask($user,$root['id'],['title'=>'C1 data','statusId'=>$snapshot['statuses'][0]['id'],'categoryId'=>$category['id'],'labelIds'=>[$label['id']],'customFields'=>[$field['id']=>0]]);
 $subtask=genesisSharedTask($user,$root['id'],['title'=>'C1 nested task','statusId'=>$snapshot['statuses'][0]['id'],'parentTaskId'=>$task['id'],'dueDate'=>'2026-11-18']);
 $external=genesisSharedTask($user,$root['id'],['title'=>'C1 external task','statusId'=>$snapshot['statuses'][0]['id']]);
 $task=genesisSharedTask($user,$root['id'],['expectedRevision'=>$task['revision'],'dependsOnIds'=>[$external['id']]],$task['id']);
 $captured=genesisSharedTemplateCapture($user,$root['id'],$task['id'],['calendarMode'=>'lunar','calendarContext'=>$context,'anchorDate'=>'2026-10-18']);
 tmCheck(count($captured['manifest']['tasks'])===2&&count($captured['manifest']['projects'])===1,'Task capture did not preserve the exact subtree');
 tmCheck(((array)$captured['manifest']['tasks'][0]['customValues'])[$field['id']]===0,'Captured task lost a typed zero');
 tmCheck(in_array('EXTERNAL_DEPENDENCIES_EXCLUDED',array_column($captured['notices'],'code'),true),'Capture silently dropped an external reference');
 $tree=genesisSharedTemplateCapture($user,$root['id'],null,['calendarMode'=>'sacred','calendarContext'=>$context,'anchorDate'=>'2026-10-18']);
 tmCheck(count($tree['manifest']['projects'])===2&&count($tree['manifest']['tasks'])===3&&count($tree['sourceProjectIds'])===2,'Project capture lost its tree or tasks');
 tmCheck(count($tree['manifest']['projects'][0]['statuses'])===3,'Capture exposed project inbox rows as template boards');
 $inboxTask=genesisSharedTask($user,$root['id'],['title'=>'Inbox capture']);
 $inboxCapture=genesisSharedTemplateCapture($user,$root['id'],$inboxTask['id'],['calendarMode'=>'sacred','calendarContext'=>$context,'anchorDate'=>'2026-10-18']);
 tmCheck($inboxCapture['manifest']['tasks'][0]['statusKey']===$snapshot['statuses'][0]['id'],'Inbox capture does not have a valid visible status mapping');
 tmCheck(in_array('STATUS_MAPPED',array_column($inboxCapture['notices'],'code'),true),'Inbox capture silently changed placement');
 tmCheck(genesisSharedGetTask($user,$root['id'],$inboxTask['id'])['statusId']==='chaos-open:'.$root['id'],'Capture moved the original inbox task');
 tmCheck($db->inTransaction(),'Task factory committed caller transaction');
 $db->rollBack();tmCheck($counts()===$before,'Atomic rollback left tree/labels/fields/values/receipts/audit');
 $ordinary=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 ordinary caller']);tmCheck(!$db->inTransaction(),'Ordinary project caller leaked transaction');
 genesisBeginWriteTransaction($db);$committed=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 committed parent']);$db->commit();tmCheck(genesisSharedProjectAccess($committed['id'],$user)['id']===$committed['id'],'Caller commit failed');
 $input=['operationId'=>genesisUuid(),'title'=>'C1 manual template','manifest'=>$manifest];
 $saved=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],$input);
 tmCheck(genesisSharedSaveTemplate($user,$spaceId,$committed['id'],$input)===$saved,'Template create retry duplicated identity');
 tmReject(fn()=>genesisSharedSaveTemplate($user,$spaceId,$committed['id'],[...$input,'title'=>'Reused request']),'TEMPLATE_OPERATION_REUSED');
 $record=genesisSharedTemplateRecord(genesisSharedTemplateAccess($user,$saved['id']));
 tmCheck((array)$record['manifest']['tasks'][0]['customValues']===['points'=>0,'flag'=>false],'Stored template lost typed values');
 $raw=$db->query('SELECT manifest_json FROM shared_templates WHERE id='.$db->quote($saved['id']))->fetchColumn();tmCheck(str_starts_with($raw,GENESIS_SHARED_CONTENT_PREFIX)&&!str_contains($raw,'Корневая'),'Template not encrypted at rest');
 $renamed=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'C1 renamed','expectedRevision'=>1],$saved['id']);
 tmReject(fn()=>genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'Stale','expectedRevision'=>1],$saved['id']),'TEMPLATE_CONFLICT');
 $removed=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'C1 renamed','expectedRevision'=>2,'deleted'=>true],$saved['id']);
 tmCheck(genesisSharedTemplates($user,$spaceId,$committed['id'])['total']===0&&genesisSharedTemplates($user,$spaceId,$committed['id'],true)['total']===1,'Template deletion affected wrong library');
 $restored=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'C1 renamed','expectedRevision'=>3,'deleted'=>false],$saved['id']);
 $privateChild=genesisSharedCreateProject($user,$spaceId,['title'=>'C1 private source branch','parentId'=>$committed['id']]);
 $captured=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'C1 captured tree','sourceProjectId'=>$committed['id'],
  'capture'=>['calendarMode'=>'sacred','calendarContext'=>$context,'anchorDate'=>'2026-10-18']]);
 $clone=genesisSharedSaveTemplate($user,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'C1 copied tree','cloneTemplateId'=>$captured['id'],'manifest'=>genesisSharedTemplateRecord(genesisSharedTemplateAccess($user,$captured['id']))['manifest']]);
 tmCheck((int)$db->query('SELECT COUNT(*) FROM shared_template_sources WHERE template_id='.$db->quote($clone['id']))->fetchColumn()===2,'Copy erased the source ACL evidence');
 $member=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.'-member','email'=>$tag.'-member@example.invalid','name'=>'C1 scoped member'],[],false)['id'];genesisTestEnableSharedProjects($member);
 $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'member',0,?)")->execute([$spaceId,$member,genesisNow()]);
 $access=['allProjects'=>false,'grants'=>[['projectId'=>$committed['id'],'role'=>'viewer','includeDescendants'=>false]]];$preview=genesisSharedPreviewProjectAccess($user,$spaceId,$member,$access);
 genesisSharedSaveProjectAccess($user,$spaceId,$member,[...$access,'operationId'=>genesisUuid(),'expectedFingerprint'=>$preview['fingerprint']]);
 $library=genesisSharedTemplates($member,$spaceId,$committed['id']);tmCheck($library['total']===1&&$library['templates'][0]['id']===$saved['id'],'Library leaked a hidden source project');
 tmReject(fn()=>genesisSharedTemplateAccess($member,$captured['id']),'TEMPLATE_SOURCE_SCOPE_UNAVAILABLE');
 tmReject(fn()=>genesisSharedTemplateAccess($member,$clone['id']),'TEMPLATE_SOURCE_SCOPE_UNAVAILABLE');
 tmReject(fn()=>genesisSharedSaveTemplate($member,$spaceId,$committed['id'],['operationId'=>genesisUuid(),'title'=>'Forbidden','manifest'=>$manifest]),'SHARED_PROJECT_FORBIDDEN');
 $db->prepare('DELETE FROM shared_projects WHERE id=?')->execute([$privateChild['id']]);
 tmCheck((int)$db->query('SELECT COUNT(*) FROM shared_template_sources WHERE template_id='.$db->quote($captured['id']))->fetchColumn()===2,'Source deletion erased ACL evidence');
 tmReject(fn()=>genesisSharedTemplateAccess($user,$captured['id']),'TEMPLATE_SOURCE_SCOPE_UNAVAILABLE');
 tmCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign key failure');
 echo "Templates: manifest, typed values/calendars/cycles, factories and atomic rollback; encrypted CRUD, CAS/replay/delete/restore, C6 sources/library and deleted-source ACL evidence passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if($spaceId)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$spaceId]);foreach([$user,$member] as $id)if($id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}
