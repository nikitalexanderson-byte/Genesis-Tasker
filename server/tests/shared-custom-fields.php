<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$fixtureConfig=genesisConfig();
$browserFixture=$fixtureConfig['app_url']==='http://127.0.0.1:4338'&&basename($fixtureConfig['db_path'])==='improvements-test.sqlite';
$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');$ciFixture=$fixtureConfig['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$fixtureConfig['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browserFixture&&!$ciFixture)throw new RuntimeException('Non-fixture configuration refused.');
foreach(['repository','google','shared-projects','shared-google'] as $module)require __DIR__.'/../src/'.$module.'.php';
function cfCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function cfReject(callable $action,string $code):void{try{$action();}catch(GenesisSharedAccessException|GenesisResourceLimitException|InvalidArgumentException $e){cfCheck($e->getMessage()===$code,'Unexpected error '.$e->getMessage().' vs '.$code);return;}throw new RuntimeException('Expected '.$code);}
function cfSave(string $actor,string $space,array $input):array{
    $preview=genesisSharedPreviewCustomField($actor,$space,$input);
    return genesisSharedSaveCustomField($actor,$space,[...$input,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint'],'replaceType'=>$preview['replaceType']])['field'];
}
function cfDraft(string $type,?string $project=null,array $extra=[]):array{return [...['id'=>genesisUuid(),'title'=>'Поле '.$type,'type'=>$type,'projectId'=>$project,'options'=>[],'position'=>0,'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0],...$extra];}
function cfEdit(array $field,array $extra=[]):array{return [...array_intersect_key($field,array_fill_keys(['id','title','type','projectId','options','position','required','showCard','showList','archived'],true)),'expectedRevision'=>$field['revision'],...$extra];}
$users=[];$spaces=[];$checks=[];$db=genesisDb();
try{
    $tag='c3-'.genesisUuid();foreach(['owner','member','viewer'] as $kind){$u=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag.$kind,'email'=>$tag.$kind.'@example.invalid','name'=>'C3 '.$kind],[],false);$users[$kind]=$u['id'];genesisTestEnableSharedProjects($u['id']);}
    $owner=$users['owner'];$member=$users['member'];$viewer=$users['viewer'];$space=genesisSharedCreateSpace($owner,['title'=>'C3 isolated']);$spaceId=$space['id'];$spaces[]=$spaceId;
    foreach([$member=>'member',$viewer=>'guest'] as $id=>$role)$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at,all_projects) VALUES(?,?,?,?,1)')->execute([$spaceId,$id,$role,genesisNow()]);
    $a=genesisSharedCreateProject($owner,$spaceId,['title'=>'C3 allowed']);$b=genesisSharedCreateProject($owner,$spaceId,['title'=>'C3 private']);
    $snapshot=genesisSharedProjectSnapshot($owner,$a['id']);$status=$snapshot['statuses'][0]['id'];$done=$snapshot['statuses'][2]['id'];
    $fields=[];foreach(['text','number','date','select','multi','checkbox','url'] as $type)$fields[$type]=cfSave($owner,$spaceId,cfDraft($type,$a['id'],in_array($type,['select','multi'],true)?['options'=>[['id'=>'first','title'=>'Русский вариант','archived'=>false],['id'=>'second','title'=>'Второй','archived'=>false]]]:[]));
    cfReject(fn()=>cfSave($viewer,$spaceId,cfDraft('text')),'SHARED_SPACE_FORBIDDEN');
    $values=[$fields['text']['id']=>'<script>пользовательский текст</script>',$fields['number']['id']=>0,$fields['date']['id']=>'2026-10-18',
        $fields['select']['id']=>'first',$fields['multi']['id']=>['second','first'],$fields['checkbox']['id']=>false,$fields['url']['id']=>'https://example.invalid/path'];
    $task=genesisSharedTask($owner,$a['id'],['title'=>'C3 all types','statusId'=>$status,'customFields'=>$values]);$taskId=$task['id'];$stored=(array)$task['customFields'];
    cfCheck($stored[$fields['number']['id']]===0&&$stored[$fields['checkbox']['id']]===false,'Zero/false lost');
    cfCheck($stored[$fields['multi']['id']]===['first','second'],'Multiselect was not canonicalized');
    $q=$db->prepare('SELECT value_json FROM shared_custom_field_values WHERE task_id=?');$q->execute([$taskId]);foreach($q->fetchAll(PDO::FETCH_COLUMN) as $raw)cfCheck(str_starts_with($raw,GENESIS_SHARED_CONTENT_PREFIX),'Plaintext value stored');
    foreach([['number','1'],['date','2026-02-30'],['checkbox',0],['url','javascript:alert(1)'],['select','unknown'],['multi',['unknown']]] as [$type,$bad]){
        $before=genesisSharedGetTask($owner,$a['id'],$taskId);try{genesisSharedTask($owner,$a['id'],['expectedRevision'=>$before['revision'],'customFields'=>[$fields[$type]['id']=>$bad]],$taskId);throw new RuntimeException('Invalid value accepted');}catch(InvalidArgumentException){}
        cfCheck(genesisSharedGetTask($owner,$a['id'],$taskId)['revision']===$before['revision'],'Validation partially wrote task');
    }
    $checks[]='types-zero-false-encryption-and-atomic-validation';
    $edited=genesisSharedTask($owner,$a['id'],['expectedRevision'=>$task['revision'],'title'=>'C3 old client save'],$taskId);
    cfCheck((array)$edited['customFields']===$stored,'Old client erased custom values');
    $textOnly=genesisSharedTask($owner,$a['id'],['expectedRevision'=>$edited['revision'],'customFields'=>[$fields['text']['id']=>'уникальная история']],$taskId);
    $events=genesisSharedActivity($owner,$a['id'],$taskId,null)['events'];cfCheck((bool)array_filter($events,fn($e)=>isset($e['details']['changes']['customFields'])),'Pure custom edit missing audit');
    $checks[]='legacy-patch-preservation-and-real-history';
    foreach([['number','eq',0],['checkbox','eq',false],['multi','contains',['first']]] as [$type,$op,$value])cfCheck(genesisSharedQueryTasks($owner,['projectIds'=>[$a['id']],'customFields'=>[['fieldId'=>$fields[$type]['id'],'op'=>$op,'value'=>$value]]])['total']===1,'Typed query mismatch');
    cfCheck(genesisSharedQueryTasks($owner,['q'=>'уникальная'])['total']===1,'Custom text search missing');
    cfCheck(genesisSharedQueryTasks($owner,['q'=>'Русский вариант'])['total']===1,'Select label search missing');
    cfCheck(genesisSharedQueryTasks($owner,['customFields'=>[['fieldId'=>$fields['number']['id'],'op'=>'missing']]])['total']===0,'Missing confused with zero');
    for($i=1;$i<6;$i++)genesisSharedTask($owner,$a['id'],['title'=>'C3 pagination '.$i,'statusId'=>$status,'customFields'=>$i<4?[$fields['number']['id']=>$i]:[]]);
    foreach(['asc','desc'] as $direction){$cursor=null;$ids=[];do{$page=genesisSharedQueryTasks($owner,['projectIds'=>[$a['id']]],$cursor,2,'custom:'.$fields['number']['id'].':'.$direction);foreach($page['tasks'] as $item)$ids[]=$item['id'];$cursor=$page['nextCursor'];}while($cursor);cfCheck(count($ids)===6&&count(array_unique($ids))===6,'Custom nullable sort lost/duplicated tasks');}
    $checks[]='query-search-option-labels-zero-and-nullable-keyset-sort';
    $definition=['version'=>1,'title'=>'C3 typed saved view','filter'=>['spaceId'=>$spaceId,'customFields'=>[['fieldId'=>$fields['checkbox']['id'],'op'=>'eq','value'=>false]]],
        'sort'=>'custom:'.$fields['number']['id'].':desc','relative'=>'none','calendarMode'=>'lunar','calendarContext'=>['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march']];
    $view=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'spaceId'=>$spaceId,'visibility'=>'personal','definition'=>$definition]);
    cfCheck(genesisSharedQueryTasks($owner,['savedViewId'=>$view['id']])['total']===1,'Saved view lost typed false');
    $other=genesisSharedTask($owner,$b['id'],['title'=>'C3 other scope','statusId'=>genesisSharedProjectSnapshot($owner,$b['id'])['statuses'][0]['id']]);
    cfCheck(!in_array($other['id'],array_column(genesisSharedQueryTasks($owner,['customFields'=>[['fieldId'=>$fields['number']['id'],'op'=>'missing']]])['tasks'],'id'),true),'Missing criterion included tasks outside field scope');
    $checks[]='saved-view-roundtrip-and-field-applicability';
    $field=$fields['select'];$field=cfSave($owner,$spaceId,cfEdit($field,['options'=>[['id'=>'second','title'=>'Второй','archived'=>false]]]));
    cfCheck(count($field['options'])===2&&$field['options'][1]['archived'],'Removed choice did not become archived');
    cfCheck(((array)genesisSharedGetTask($owner,$a['id'],$taskId)['customFields'])[$field['id']]==='first','Option deletion changed old value');
    cfReject(fn()=>genesisSharedTask($owner,$a['id'],['title'=>'C3 unavailable choice','statusId'=>$status,'customFields'=>[$field['id']=>'first']]),'CUSTOM_FIELD_OPTION_UNAVAILABLE');
    $fields['select']=$field;
    $number=$fields['number'];$preview=genesisSharedPreviewCustomField($owner,$spaceId,cfEdit($number,['type'=>'text']));cfCheck($preview['replaceType']&&$preview['valueCount']===4,'Type change lost impact');
    $command=[...cfEdit($number,['type'=>'text']),'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint'],'replaceType'=>true];
    $result=genesisSharedSaveCustomField($owner,$spaceId,$command);cfCheck($result['previousFieldId']===$number['id']&&$result['field']['id']!==$number['id'],'Type change reused old identity');
    cfCheck(genesisSharedSaveCustomField($owner,$spaceId,$command)===$result,'Replay changed successor');
    cfCheck(((array)genesisSharedGetTask($owner,$a['id'],$taskId)['customFields'])[$number['id']]===0,'Type transition erased old value');
    cfCheck(count(genesisSharedCustomFieldHistory($owner,$number['id']))===2,'Definition history missing');
    $oldField=genesisSharedCustomFieldAccess($owner,$number['id']);cfCheck($oldField['archived'],'Previous type not archived');
    cfSave($owner,$spaceId,cfEdit($oldField,['archived'=>false]));
    $checks[]='choice-tombstones-type-successor-restoration-history-and-replay';
    $normal=cfSave($owner,$spaceId,cfDraft('select',$a['id'],['options'=>[['id'=>'kept','title'=>'Kept option','archived'=>false]]]));
    $newOptions=array_map(static fn($n)=>['id'=>'new-'.$n,'title'=>'New '.$n,'archived'=>false],range(1,200));
    cfReject(fn()=>cfSave($owner,$spaceId,cfEdit($normal,['options'=>$newOptions])),'CUSTOM_FIELD_OPTIONS_LIMIT');
    cfCheck(genesisSharedCustomFieldAccess($owner,$normal['id'])['revision']===$normal['revision'],'Rejected normalized201 changed the field');
    $legacy=cfSave($owner,$spaceId,cfDraft('select',$a['id'],['options'=>[['id'=>'legacy-old','title'=>'Original label','archived'=>false]]]));
    $legacyTask=genesisSharedTask($owner,$a['id'],['title'=>'Legacy archived selection','statusId'=>$status,'customFields'=>[$legacy['id']=>'legacy-old']]);
    $legacyOptions=[['id'=>'legacy-old','title'=>'Original label','archived'=>true],...$newOptions];
    // Only this isolated synthetic row reproduces the former normalizer output.
    $db->prepare('UPDATE shared_custom_fields SET definition_json=? WHERE id=?')->execute([json_encode(['title'=>$legacy['title'],'options'=>$legacyOptions],JSON_THROW_ON_ERROR),$legacy['id']]);
    $legacy=genesisSharedCustomFieldAccess($owner,$legacy['id']);
    $legacy=cfSave($owner,$spaceId,cfEdit($legacy,['title'=>'Renamed legacy choices']));
    cfCheck(count($legacy['options'])===201&&$legacy['options'][0]['id']==='legacy-old'&&$legacy['options'][0]['archived'],'Legacy archived options were not preserved');
    cfCheck(((array)genesisSharedGetTask($owner,$a['id'],$legacyTask['id'])['customFields'])[$legacy['id']]==='legacy-old','Legacy task value changed');
    cfReject(fn()=>cfSave($owner,$spaceId,cfEdit($legacy,['options'=>[...$legacyOptions,['id'=>'extra','title'=>'Extra','archived'=>true]]])),'CUSTOM_FIELD_OPTIONS_LIMIT');
    $unarchive=$legacyOptions;$unarchive[0]['archived']=false;
    cfReject(fn()=>cfSave($owner,$spaceId,cfEdit($legacy,['options'=>$unarchive])),'CUSTOM_FIELD_OPTIONS_LIMIT');
    cfCheck(genesisSharedCustomFieldAccess($owner,$legacy['id'])['revision']===$legacy['revision'],'Rejected legacy growth changed revision');
    $checks[]='normalized-option-bound-legacy201-preservation-and-no-growth';
    $required=cfSave($owner,$spaceId,cfDraft('checkbox',$a['id'],['required'=>true]));
    cfReject(fn()=>genesisSharedTask($owner,$a['id'],['title'=>'C3 missing required','statusId'=>$status]),'CUSTOM_FIELD_REQUIRED');
    genesisSharedTask($owner,$a['id'],['title'=>'C3 false is present','statusId'=>$status,'customFields'=>[$required['id']=>false]]);
    $fresh=genesisSharedGetTask($owner,$a['id'],$taskId);cfReject(fn()=>genesisSharedTask($owner,$a['id'],['expectedRevision'=>$fresh['revision'],'statusId'=>$done],$taskId),'CUSTOM_FIELD_REQUIRED');
    $stale=genesisSharedPreviewCustomField($owner,$spaceId,cfEdit($required,['title'=>'Concurrent']));cfSave($owner,$spaceId,cfEdit($required,['title'=>'Changed elsewhere']));
    cfReject(fn()=>genesisSharedSaveCustomField($owner,$spaceId,[...cfEdit($required,['title'=>'Concurrent']),'fingerprint'=>$stale['fingerprint'],'operationId'=>genesisUuid()]),'CUSTOM_FIELD_CONFLICT');
    $bStatus=genesisSharedProjectSnapshot($owner,$b['id'])['statuses'][0]['id'];$fresh=genesisSharedGetTask($owner,$a['id'],$taskId);
    cfReject(fn()=>genesisSharedMoveTask($owner,$a['id'],$taskId,['expectedRevision'=>$fresh['revision'],'destinationProjectId'=>$b['id'],'statusId'=>$bStatus,'position'=>0]),'CUSTOM_FIELD_MOVE_REQUIRES_MAPPING');
    $bulk=genesisSharedBulkPreview($owner,['requestId'=>genesisUuid(),'selection'=>['mode'=>'page','items'=>[
        ['id'=>$taskId,'projectId'=>$a['id'],'revision'=>$fresh['revision']]]],'action'=>['kind'=>'move','projectId'=>$b['id'],'statusId'=>$bStatus]]);
    genesisSharedBulkConfirm($owner,$bulk['id']);
    for($attempt=0;$attempt<20;$attempt++){$bulk=genesisSharedBulkAdvance($owner,$bulk['id']);if($bulk['state']!=='running')break;}
    cfCheck($bulk['state']==='done'&&$bulk['counts']['skipped']===1&&$bulk['items'][0]['code']==='CUSTOM_FIELD_MOVE_REQUIRES_MAPPING','Bulk move hid custom-field mapping requirement');
    cfCheck(genesisSharedGetTask($owner,$a['id'],$taskId)['revision']===$fresh['revision'],'Rejected bulk move changed custom field task');
    $checks[]='bulk-move-retains-custom-field-mapping-error';
    $private=cfSave($owner,$spaceId,cfDraft('text',$b['id'],['title'=>'C3 confidential definition']));
    $access=['allProjects'=>false,'grants'=>[['projectId'=>$a['id'],'role'=>'viewer','includeDescendants'=>false]]];$preview=genesisSharedPreviewProjectAccess($owner,$spaceId,$member,$access);
    genesisSharedSaveProjectAccess($owner,$spaceId,$member,[...$access,'expectedFingerprint'=>$preview['fingerprint'],'operationId'=>genesisUuid()]);
    cfReject(fn()=>genesisSharedCustomFieldAccess($member,$private['id']),'SHARED_PROJECT_NOT_FOUND');
    cfCheck(!in_array($private['id'],array_column(genesisSharedCustomFields($member,$spaceId),'id'),true),'Definition list leaked inaccessible project');
    cfReject(fn()=>genesisSharedQueryTasks($member,['customFields'=>[['fieldId'=>$private['id'],'op'=>'exists']]]),'SHARED_PROJECT_NOT_FOUND');
    cfCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Foreign key failure');$checks[]='required-false-concurrency-safe-move-and-c6-acl';
    echo json_encode(['passed'=>$checks],JSON_THROW_ON_ERROR)."\n";
}finally{foreach($spaces as $id)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$id]);foreach($users as $id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}
