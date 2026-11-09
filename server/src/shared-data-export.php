<?php
declare(strict_types=1);
require_once __DIR__.'/shared-data-csv.php';
require_once __DIR__.'/shared-data-trello.php';

function genesisDataRows(string $sql,array $values=[]):array{$q=genesisDb()->prepare($sql);$q->execute($values);return $q->fetchAll();}
function genesisDataJson(mixed $value):string{return json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);}
function genesisDataSeal(mixed $value):string{return genesisSharedContentEncrypt(genesisDataJson($value));}
function genesisDataOpen(string $value):array{return json_decode(genesisSharedContentDecrypt($value),true,256,JSON_THROW_ON_ERROR);}

/** A consistent full authorized selection, independent of UI pagination and saved-view limits. */
function genesisDataExportManifest(string $actor,string $spaceId,array $input):array{
    genesisSharedRequireEnabled($actor);$space=genesisSharedSpaceAccess($spaceId,$actor);
    $input=genesisDataObject($input,['scope','projectId','from','to','undated','archived','calendarMode','calendarContext','format','titles']);
    $scope=$input['scope']??'project';if(!in_array($scope,['project','tree','space'],true))genesisDataInvalid();$root=$input['projectId']??null;
    if($scope!=='space'){if(!is_string($root)||genesisSharedProjectAccess($root,$actor,'read',true)['space_id']!==$spaceId)throw new GenesisSharedAccessException();}
    $from=genesisDataDate($input['from']??null);$to=genesisDataDate($input['to']??null);if($from!==null&&$to!==null&&$from>$to)genesisDataInvalid('DATA_DATE_INVALID');
    $undated=genesisDataBool($input['undated']??true);$archived=genesisDataBool($input['archived']??true);
    $out=genesisDataEmpty($space['title']);$out['exportedAt']=genesisNow();$out['calendarMode']=$input['calendarMode']??'profane';$out['calendarContext']=genesisCalendarContext($input['calendarContext']??null,'Europe/Moscow',2);
    if(($space['cover_image']??'')!=='')$out['notices'][]=['code'=>'DATA_VISUAL_ASSET_EXCLUDED','field'=>'space.cover'];
    $all=genesisDataRows("SELECT p.* FROM shared_projects p JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? WHERE p.space_id=? AND p.is_inbox=0 AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind='project' AND tr.object_id=p.id) ORDER BY p.id",[$actor,$spaceId]);
    $projects=[];$queue=[];$children=[];foreach($all as $row){$projects[$row['id']]=$row;if($row['parent_id']!==null)$children[$row['parent_id']][]=$row['id'];}
    if($scope==='space'){foreach($projects as $id=>$row)if($row['parent_id']===null||!isset($projects[$row['parent_id']]))$queue[]=$id;}else $queue=[$root];
    $ordered=[];for($i=0;$i<count($queue);$i++){$id=$queue[$i];if(!isset($projects[$id])||isset($ordered[$id]))continue;$row=$projects[$id];if(!$archived&&$row['archived_at']!==null)continue;$ordered[$id]=$row;if($scope!=='project')foreach($children[$id]??[] as $child)$queue[]=$child;}
    if(!$ordered)genesisDataInvalid('DATA_EMPTY');$projects=$ordered;$projectKeys=array_fill_keys(array_keys($projects),true);$taskRows=[];$statusIndex=[];$labels=[];$memberIds=[];
    foreach($projects as $id=>$row){
        if((bool)$row['is_inbox'])$out['notices'][]=['code'=>'DATA_INBOX_AS_PROJECT','field'=>''];
        $statuses=[];foreach(genesisDataRows('SELECT * FROM shared_project_statuses WHERE project_id=? ORDER BY position,id',[$id]) as $s){$statuses[]=['key'=>$s['id'],'title'=>$s['title'],'isDone'=>(bool)$s['is_done'],'isChaos'=>(bool)$s['is_chaos'],'color'=>$s['color'],'taskTitleLines'=>(int)($s['task_title_lines']??($s['is_done']?2:0)),'visibleTaskCount'=>(int)($s['visible_task_count']??($s['is_done']?5:0))];$statusIndex[$s['id']]=(bool)$s['is_done'];if(($s['image_url']??'')!=='')$out['notices'][]=['code'=>'DATA_VISUAL_ASSET_EXCLUDED','field'=>'status'];}
        $categories=[];foreach(genesisDataRows('SELECT id,title,color FROM shared_project_categories WHERE project_id=? ORDER BY position,id',[$id]) as $c)$categories[]=['key'=>$c['id'],'title'=>$c['title'],'color'=>$c['color']];
        $labelIds=genesisSharedLabelIds('project',$id);foreach($labelIds as $key)$labels[$key]=true;
        $parent=isset($projectKeys[$row['parent_id']??''])?$row['parent_id']:null;
        $out['projects'][]=['key'=>$id,'parentKey'=>$parent,'boardStatusKey'=>$parent===null?null:$row['board_status_id'],'title'=>$row['title'],'description'=>$row['description'],'kind'=>$row['kind'],'layout'=>$row['layout'],'tags'=>json_decode($row['tags_json'],true,64,JSON_THROW_ON_ERROR),'labelKeys'=>$labelIds,'statuses'=>$statuses,'categories'=>$categories,'archivedAt'=>$row['archived_at'],'createdAt'=>$row['created_at']];
        $where=$archived?'':' AND archived_at IS NULL';$values=[$id];$dateWhere='';if($from!==null){$dateWhere.=' AND due_date>=?';$values[]=$from;}if($to!==null){$dateWhere.=' AND due_date<=?';$values[]=$to;}
        $where.=' AND ((due_date IS NOT NULL'.$dateWhere.')'.($undated?' OR due_date IS NULL':'').')';
        foreach(genesisDataRows('SELECT * FROM shared_tasks_history_read WHERE project_id=?'.$where.' ORDER BY created_at,id',$values) as $task)$taskRows[$task['id']]=$task;
    }
    $keys=array_fill_keys(array_keys($taskRows),true);$fields=genesisSharedCustomFields($actor,$spaceId,null,true);$fields=array_values(array_filter($fields,static fn($field)=>$field['projectId']===null||isset($projectKeys[$field['projectId']])));
    foreach($fields as $field)$out['fields'][]=['key'=>$field['id'],'projectKey'=>$field['projectId'],'title'=>$field['title'],'type'=>$field['type'],'options'=>$field['options'],'position'=>$field['position'],'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'archived'=>$field['archived'],'predecessorKey'=>$field['predecessorId']];
    $fieldKeys=array_fill_keys(array_column($out['fields'],'key'),true);foreach($out['fields'] as &$field)if($field['predecessorKey']!==null&&!isset($fieldKeys[$field['predecessorKey']])){$field['predecessorKey']=null;$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'field.predecessor'];}unset($field);
    foreach($taskRows as $id=>$task){
        $parent=isset($keys[$task['parent_task_id']??''])?$task['parent_task_id']:null;if($parent===null&&$task['parent_task_id']!==null)$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'task.parent'];
        $archiveRoot=isset($keys[$task['archive_root_id']??''])?$task['archive_root_id']:null;if($archiveRoot===null&&$task['archive_root_id']!==null)$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'task.archiveRoot'];
        $allDependencies=genesisSharedDependencyIds($id);$dependencies=array_values(array_filter($allDependencies,static fn($key)=>isset($keys[$key])));if(count($dependencies)!==count($allDependencies))$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'task.dependencies'];
        $lists=json_decode($task['checklists_json'],true,128,JSON_THROW_ON_ERROR);foreach($lists as &$list){$list['key']=$list['id'];unset($list['id']);foreach($list['items'] as &$item){$item['key']=$item['id'];unset($item['id']);$item['assigneeKey']=$item['assigneeId'];unset($item['assigneeId']);if($item['assigneeKey'])$memberIds[$item['assigneeKey']]=true;$linked=$item['linkedTaskId']??null;unset($item['linkedTaskId']);$item['linkedTaskKey']=isset($keys[$linked??''])?$linked:null;if($linked!==null&&$item['linkedTaskKey']===null)$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'checklist.link'];}unset($item);}unset($list);
        $approvals=[];foreach(genesisSharedTaskApprovals($id) as $approval){$memberIds[$approval['userId']]=true;$approvals[]=['memberKey'=>$approval['userId'],'approvedAt'=>$approval['approvedAt']];}
        if($task['assignee_id'])$memberIds[$task['assignee_id']]=true;$labelIds=genesisSharedLabelIds('task',$id);foreach($labelIds as $key)$labels[$key]=true;
        $values=[];foreach(genesisDataRows('SELECT field_id,value_json FROM shared_custom_field_values WHERE task_id=? ORDER BY field_id',[$id]) as $value){if(isset($fieldKeys[$value['field_id']]))$values[$value['field_id']]=json_decode(genesisSharedContentDecrypt($value['value_json']),true,64,JSON_THROW_ON_ERROR);}
        $out['tasks'][]=['key'=>$id,'projectKey'=>$task['project_id'],'parentKey'=>$parent,'statusKey'=>$task['status_id'],'categoryKey'=>$task['category_id'],'title'=>$task['title'],'description'=>$task['description'],'entryType'=>$task['entry_type'],'priority'=>(int)$task['priority'],'tags'=>json_decode($task['tags_json'],true,64,JSON_THROW_ON_ERROR),'assigneeKey'=>$task['assignee_id'],'labelKeys'=>$labelIds,'dependsOnKeys'=>$dependencies,'dueDate'=>$task['due_date'],'startDate'=>$task['start_date'],'startTime'=>$task['start_time'],'endTime'=>$task['end_time'],'checklists'=>$lists,'customValues'=>(object)$values,'approvals'=>$approvals,'completedAt'=>$task['completed_at'],'archivedAt'=>$task['archived_at'],'createdAt'=>$task['created_at'],'updatedAt'=>$task['updated_at']];
        $out['tasks'][array_key_last($out['tasks'])]['archiveRootKey']=$archiveRoot;
        $out['tasks'][array_key_last($out['tasks'])]+=array_intersect_key(genesisPlanningTaskValues($id),['storyPoints'=>true,'estimateHours'=>true]);
        foreach(genesisDataRows('SELECT c.*,u.display_name AS author_title FROM shared_comments_read c LEFT JOIN users u ON u.id=c.author_id WHERE c.task_id=? ORDER BY c.created_at,c.id',[$id]) as $comment){$out['comments'][]=['key'=>$comment['id'],'taskKey'=>$id,'authorKey'=>$comment['author_id'],'authorTitle'=>$comment['author_title']??'','body'=>$comment['body'],'createdAt'=>$comment['created_at']];}
        foreach(genesisDataRows('SELECT id,filename_ciphertext,mime_type,byte_size FROM shared_task_attachments WHERE task_id=? ORDER BY id',[$id]) as $file)$out['attachments'][]=['key'=>$file['id'],'projectKey'=>$task['project_id'],'taskKey'=>$id,'name'=>genesisDecrypt($file['filename_ciphertext'])??'attachment','mimeType'=>$file['mime_type'],'size'=>(int)$file['byte_size'],'url'=>null];
        if(genesisDataRows('SELECT task_id FROM shared_task_images WHERE task_id=?',[$id]))$out['notices'][]=['code'=>'DATA_VISUAL_ASSET_EXCLUDED','field'=>'task.image'];
    }
    foreach(array_keys($labels) as $id){$rows=genesisDataRows('SELECT title,color FROM shared_space_labels WHERE id=? AND space_id=?',[$id,$spaceId]);if($rows)$out['labels'][]=['key'=>$id,...$rows[0]];}
    foreach(array_keys($memberIds) as $id){$rows=genesisDataRows('SELECT display_name FROM users WHERE id=?',[$id]);$out['members'][]=['key'=>$id,'title'=>$rows[0]['display_name']??''];}
    foreach(array_keys($projects) as $id){
        foreach(genesisDataRows('SELECT c.*,u.display_name AS author_title FROM shared_project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.project_id=? ORDER BY c.created_at,c.id',[$id]) as $comment)$out['comments'][]=['key'=>$comment['id'],'projectKey'=>$id,'taskKey'=>null,'boardStatusKey'=>$comment['board_id'],'authorKey'=>$comment['author_id'],'authorTitle'=>$comment['author_title']??'','body'=>$comment['body'],'createdAt'=>$comment['created_at']];
        foreach(genesisDataRows('SELECT e.*,u.display_name AS actor_title FROM shared_audit_events_read e LEFT JOIN users u ON u.id=e.actor_id WHERE e.project_id=? ORDER BY e.created_at,e.id',[$id]) as $event){if($event['task_id']!==null&&!isset($keys[$event['task_id']]))continue;$safe=genesisSharedSafeActivityRow($actor,$id,['taskId'=>$event['task_id'],'boardId'=>$event['board_id'],'details'=>json_decode($event['details_json'],true,128,JSON_THROW_ON_ERROR)]);$details=$safe['details'];
            // Store only reviewable history, never arbitrary transport/job payloads or hidden reference IDs.
            $details=array_intersect_key($details,array_flip(['changes','objectTitle','referenceIds','customFieldDefinitions']));$out['history'][]=['key'=>$event['id'],'projectKey'=>$id,'taskKey'=>$safe['taskId'],'actorTitle'=>$event['actor_title']??'','action'=>$event['action'],'createdAt'=>$event['created_at'],'details'=>$details];}
        foreach(genesisDataRows('SELECT * FROM shared_task_series WHERE project_id=? ORDER BY id',[$id]) as $series){if($series['source_task_id']!==null&&!isset($keys[$series['source_task_id']]))continue;$out['series'][]=['key'=>$series['id'],'projectKey'=>$id,'taskKey'=>$series['source_task_id'],'settings'=>json_decode(genesisSharedContentDecrypt($series['rule_json']),true,128,JSON_THROW_ON_ERROR)];}
        foreach(genesisDataRows('SELECT id FROM shared_templates WHERE project_id=? AND deleted_at IS NULL ORDER BY id',[$id]) as $template){try{$source=genesisSharedTemplateSource($actor,$template['id']);$out['templates'][]=['key'=>$template['id'],'projectKey'=>$id,'title'=>$source['title'],'manifest'=>$source['manifest']];}catch(GenesisSharedAccessException){$out['notices'][]=['code'=>'DATA_EXTERNAL_REFERENCE_EXCLUDED','field'=>'template'];}}
        foreach(genesisDataRows("SELECT r.* FROM shared_data_import_records r JOIN shared_data_imports i ON i.id=r.import_id WHERE r.project_id=? AND i.state='active' ORDER BY r.import_id,r.kind,r.source_key",[$id]) as $record){$payload=genesisDataOpen($record['payload_json']);$kind=$record['kind'];$task=$payload['taskKey']??null;if($task!==null&&!isset($keys[$task]))continue;
            if(in_array($kind,['history','attachments','series','templates'],true)){$payload['key']='import:'.substr(hash('sha256',$record['import_id'].'|'.$kind.'|'.$record['source_key']),0,48);$payload['projectKey']=$id;$out[$kind][]=$payload;}
            elseif($kind==='comment')foreach($out['comments'] as &$comment){if($comment['key']===$record['target_id']){$comment['authorKey']=$payload['authorKey'];$comment['authorTitle']=$payload['authorTitle'];}}unset($comment);
            if($kind==='task'&&isset($taskRows[$record['target_id']])&&(int)$taskRows[$record['target_id']]['revision']===(int)$record['initial_revision']){
                foreach($out['tasks'] as &$exportedTask)if($exportedTask['key']===$record['target_id']){$exportedTask['approvals']=$payload['approvals'];$exportedTask['completedAt']=$payload['sourceCompletedAt'];}unset($exportedTask);
                $existing=array_fill_keys(array_column($out['members'],'key'),true);foreach($payload['approvals'] as $approval)if(!isset($existing[$approval['memberKey']])){$out['members'][]=['key'=>$approval['memberKey'],'title'=>$payload['memberTitles'][$approval['memberKey']]??''];$existing[$approval['memberKey']]=true;}
            }
            elseif($kind==='task'&&$payload['approvals']&&isset($keys[$record['target_id']]))$out['history'][]=['key'=>'import-approvals:'.substr(hash('sha256',$record['import_id'].'|'.$record['source_key']),0,40),'projectKey'=>$id,'taskKey'=>$record['target_id'],'actorTitle'=>'','action'=>'import.approvals','createdAt'=>null,'details'=>['approvals'=>$payload['approvals'],'memberTitles'=>$payload['memberTitles']]];
        }
    }
    if($out['attachments'])$out['notices'][]=['code'=>'DATA_ATTACHMENTS_METADATA_ONLY','field'=>''];if($out['series']||$out['templates'])$out['notices'][]=['code'=>'DATA_SCHEDULES_METADATA_ONLY','field'=>''];
    $out['notices']=array_values(array_unique($out['notices'],SORT_REGULAR));return genesisDataManifest($out);
}

function genesisDataCommentProvenance(array $row):array{
    $records=genesisDataRows("SELECT r.payload_json FROM shared_data_import_records r JOIN shared_data_imports i ON i.id=r.import_id WHERE r.kind='comment' AND r.target_id=? AND i.state='active'",[$row['id']]);
    if($records){$source=genesisDataOpen($records[0]['payload_json']);$row['importedAuthorName']=$source['authorTitle'];}return $row;
}

function genesisSharedDataExport(string $actor,string $spaceId,array $input):array{
    genesisRequireFeature($actor,'data-export');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();try{$data=genesisDataExportManifest($actor,$spaceId,$input);$format=$input['format']??'json';if(!in_array($format,['json','csv'],true))genesisDataInvalid();$content=$format==='csv'?genesisDataToCsv($data,genesisDataObject($input['titles']??[],genesisDataCsvColumnKeys())):genesisDataJson($data);
        if(strlen($content)>GENESIS_DATA_FILE_LIMIT)throw new GenesisResourceLimitException(413,'DATA_FILE_TOO_LARGE');$notices=$data['notices'];if($format==='csv')$notices[]=['code'=>'DATA_CSV_LIMITATIONS','field'=>''];$result=['format'=>$format,'content'=>$content,'projectCount'=>count($data['projects']),'taskCount'=>count($data['tasks']),'notices'=>$notices];if($owns)$db->commit();return $result;
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
