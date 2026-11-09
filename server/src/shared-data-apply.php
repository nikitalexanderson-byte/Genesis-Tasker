<?php
declare(strict_types=1);
require_once __DIR__.'/shared-data-plan.php';

function genesisDataRecord(string $import,string $kind,string $key,?string $target,?string $project,array $payload,?int $revision=null):void{
    genesisDb()->prepare('INSERT INTO shared_data_import_records(import_id,kind,source_key,target_id,project_id,payload_json,initial_revision) VALUES(?,?,?,?,?,?,?)')->execute([$import,$kind,$key,$target,$project,genesisDataSeal($payload),$revision]);
}
function genesisDataReceiptAccess(string $actor,array $receipt,string $permission='read'):void{
    foreach(array_unique(array_values($receipt['projectIds'])) as $id)genesisSharedProjectAccess($id,$actor,$permission,true);
}
/** Hard deletion of all imported content permits a fresh explicit apply; trash still counts as present. */
function genesisDataImportContentRemoved(array $receipt):bool{
    if(!$receipt['createdProjectIds']&&!$receipt['taskIds'])return false;
    foreach($receipt['createdProjectIds'] as $id)if(genesisDataRows('SELECT id FROM shared_projects WHERE id=?',[$id]))return false;
    foreach($receipt['taskIds'] as $id)if(genesisDataRows('SELECT id FROM shared_tasks WHERE id=?',[$id]))return false;
    return !genesisDataRows("SELECT r.target_id FROM shared_data_import_records r WHERE r.import_id=? AND r.kind='comment' AND (r.target_id IN(SELECT id FROM shared_comments) OR r.target_id IN(SELECT id FROM shared_project_comments)) LIMIT 1",[$receipt['importId']]);
}
/** Hash all owned rows AND incoming references. A later collaborator's work must never be cascaded away. */
function genesisDataImportSnapshot(array $receipt):string{
    $db=genesisDb();$db->exec('CREATE TEMP TABLE IF NOT EXISTS genesis_data_undo_ids(kind TEXT,id TEXT,PRIMARY KEY(kind,id))');$db->exec('DELETE FROM genesis_data_undo_ids');
    foreach(['project'=>$receipt['createdProjectIds'],'task'=>array_values($receipt['taskIds']),'label'=>$receipt['createdLabelIds'],'field'=>array_values($receipt['fieldIds']),'category'=>array_values($receipt['categoryIds'])] as $kind=>$ids)foreach(array_unique($ids) as $id)$db->prepare('INSERT INTO genesis_data_undo_ids VALUES(?,?)')->execute([$kind,$id]);
    $ids=static fn(string $kind):string=>"(SELECT id FROM genesis_data_undo_ids WHERE kind='".$kind."')";$p=$ids('project');$t=$ids('task');$l=$ids('label');$f=$ids('field');
    $conditions=[
        'shared_projects'=>"id IN $p OR parent_id IN $p",'shared_project_members'=>"project_id IN $p",'shared_project_statuses'=>"project_id IN $p",'shared_project_categories'=>"project_id IN $p OR id IN ".$ids('category'),
        'shared_tasks'=>"id IN $t OR project_id IN $p OR parent_task_id IN $t",'shared_comments'=>"task_id IN $t",'shared_comment_mentions'=>"comment_id IN (SELECT id FROM shared_comments WHERE task_id IN $t)",
        'shared_task_dependencies'=>"task_id IN $t OR predecessor_id IN $t",'shared_task_approvals'=>"task_id IN $t",'shared_task_reviews'=>"task_id IN $t",'shared_task_attachments'=>"task_id IN $t",'shared_task_images'=>"task_id IN $t",'shared_task_watchers'=>"task_id IN $t",
        'shared_space_labels'=>"id IN $l",'shared_project_labels'=>"project_id IN $p OR label_id IN $l",'shared_task_labels'=>"task_id IN $t OR label_id IN $l",'shared_custom_fields'=>"id IN $f OR project_id IN $p OR predecessor_id IN $f",'shared_custom_field_values'=>"task_id IN $t OR field_id IN $f",'shared_custom_field_versions'=>"field_id IN $f",
        'shared_task_series'=>"project_id IN $p OR source_task_id IN $t",'shared_series_instances'=>"task_id IN $t",'shared_templates'=>"project_id IN $p",'shared_template_sources'=>"project_id IN $p",'shared_automation_rules'=>"project_id IN $p",'shared_automation_runs'=>"task_id IN $t",'shared_audit_events'=>"project_id IN $p OR task_id IN $t OR object_id IN $t",'shared_project_comments'=>"project_id IN $p",'shared_member_project_grants'=>"project_id IN $p",'shared_notification_task_state'=>"task_id IN $t",'shared_notification_recipients'=>"task_id IN $t",'shared_mindmap_conversions'=>"project_id IN $p OR task_id IN $t",'shared_google_projection_links'=>"task_id IN $t",'shared_task_transfers'=>"target_task_id IN $t",'shared_data_import_records'=>"import_id=".$db->quote($receipt['importId']),
        'shared_trash'=>"object_id IN $p OR object_id IN $t",'shared_project_review_policies'=>"project_id IN $p",'shared_google_preferences'=>"project_id IN $p",'shared_mindmaps'=>"project_id IN $p",'shared_mindmap_versions'=>"project_id IN $p",
    ];$state=[];foreach($conditions as $table=>$condition){$rows=genesisDataRows('SELECT * FROM '.$table.' WHERE '.$condition);$encoded=array_map('genesisDataJson',$rows);sort($encoded,SORT_STRING);$state[$table]=$encoded;}
    $state['importedProjectComments']=genesisDataRows("SELECT * FROM shared_project_comments WHERE id IN (SELECT target_id FROM shared_data_import_records WHERE import_id=? AND kind='comment') ORDER BY id",[$receipt['importId']]);
    $external=[];foreach(genesisDataRows("SELECT id,checklists_json FROM shared_tasks_history_read WHERE id NOT IN $t AND project_id IN (SELECT id FROM shared_projects WHERE space_id=?)",[$receipt['spaceId']]) as $row){foreach(json_decode($row['checklists_json'],true,128,JSON_THROW_ON_ERROR) as $list)foreach($list['items'] as $item)if(in_array($item['linkedTaskId']??null,$receipt['taskIds'],true))$external[]=$row;}
    $state['incomingChecklists']=$external;return genesisDataHash($state);
}

function genesisSharedDataApply(string $actor,array $input):array{
    genesisRequireFeature($actor,'data-export');
    $parsed=genesisDataImportInput($input);$operation=genesisDataKey($input['operationId']??null);$expected=$input['fingerprint']??null;if(!is_string($expected)||!preg_match('/^[a-f0-9]{64}$/D',$expected))genesisDataInvalid('DATA_PREVIEW_REQUIRED');
    $hash=genesisDataHash([$parsed,$expected]);$db=genesisDb();$owns=!$db->inTransaction();$savepoint='data_import_'.bin2hex(random_bytes(6));if($owns)genesisBeginWriteTransaction($db);else $db->exec('SAVEPOINT '.$savepoint);
    try{
        genesisSharedRequireEnabled($actor);genesisSharedSpaceAccess($parsed['options']['spaceId'],$actor);
        $previous=genesisDataRows('SELECT * FROM shared_data_imports WHERE actor_id=? AND operation_id=?',[$actor,$operation]);
        if($previous){$row=$previous[0];if(!hash_equals($row['request_hash'],$hash))throw new GenesisSharedAccessException('DATA_OPERATION_REUSED',409);if($row['state']!=='active')throw new GenesisSharedAccessException('DATA_IMPORT_UNDONE',409);$receipt=genesisDataOpen($row['receipt_json']);genesisDataReceiptAccess($actor,$receipt);if($owns)$db->commit();else $db->exec('RELEASE '.$savepoint);return $receipt;}
        $plan=genesisDataImportPlan($actor,$parsed);
        $previous=genesisDataRows("SELECT * FROM shared_data_imports WHERE space_id=? AND destination_key=? AND source_hash=? AND state='active'",[$plan['options']['spaceId'],$plan['destinationKey'],$plan['sourceHash']]);
        if($previous){$receipt=genesisDataOpen($previous[0]['receipt_json']);if(genesisDataImportContentRemoved($receipt)){$db->prepare("UPDATE shared_data_imports SET state='removed',undone_at=? WHERE id=? AND state='active'")->execute([genesisNow(),$receipt['importId']]);}
            else{genesisDataReceiptAccess($actor,$receipt);$receipt['duplicate']=true;if($owns)$db->commit();else $db->exec('RELEASE '.$savepoint);return $receipt;}}
        if(!hash_equals($expected,$plan['fingerprint']))throw new GenesisSharedAccessException('DATA_PREVIEW_CHANGED',409);if(!$plan['canApply'])throw new GenesisSharedAccessException('DATA_APPLY_BLOCKED',409);
        $import=genesisUuid();$spaceId=$plan['options']['spaceId'];$now=genesisNow();
        $db->prepare('INSERT INTO shared_data_imports(id,actor_id,space_id,operation_id,source_hash,destination_key,request_hash,receipt_json,baseline_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')->execute([$import,$actor,$spaceId,$operation,$plan['sourceHash'],$plan['destinationKey'],$hash,genesisDataSeal([]),genesisDataSeal([]),$now]);
        $receipt=GenesisDataHistoricalScope::run(static function()use($actor,$plan,$import,$operation,$spaceId,$now,$db):array{
            $data=$plan['data'];$new=$plan['options']['projectId']===null;$projectIds=[];$statusIds=[];$categoryIds=[];$labelIds=[];$createdLabels=[];$createdProjects=[];$fieldIds=[];$createdFields=[];$optionIds=[];$taskIds=[];$checklistIds=[];
            foreach($plan['newLabels'] as $label){$id=genesisSharedSaveLabel($actor,$spaceId,null,$label)['id'];$labelIds[$label['key']]=$id;$createdLabels[]=$id;}
            foreach($plan['labelMap'] as $key=>$id)if($id!==null&&$id!=='new')$labelIds[$key]=$id;$labels=static fn(array $keys):array=>array_values(array_intersect_key($labelIds,array_fill_keys($keys,true)));
            foreach($data['projects'] as $project){$key=$project['key'];if($new){$parent=$project['parentKey']===null?$plan['options']['parentProjectId']:$projectIds[$project['parentKey']];$boardStatuses=array_values(array_filter($project['statuses'],static fn($s)=>!$s['isChaos']));$statuses=array_map(static function($status){unset($status['key'],$status['isChaos']);return $status;},$boardStatuses);
                    $created=genesisSharedCreateProject($actor,$spaceId,['title'=>$project['title'],'description'=>$project['description'],'kind'=>$project['kind'],'layout'=>$project['layout'],'parentId'=>$parent,'boardStatusId'=>$project['parentKey']===null?null:($statusIds[$project['boardStatusKey']]??null),'tags'=>$project['tags'],'labelIds'=>$labels($project['labelKeys']),'statuses'=>$statuses]);$id=$created['id'];$createdProjects[]=$id;
                    $ids=array_column(genesisDataRows('SELECT id FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id',[$id]),'id');foreach($boardStatuses as $index=>$status)$statusIds[$status['key']]=$ids[$index];foreach($project['statuses'] as $status)if($status['isChaos'])$statusIds[$status['key']]=genesisSharedProjectInboxStatus($db,$id,$status['isDone']);
                    foreach($project['categories'] as $category)$categoryIds[$category['key']]=genesisSharedCreateCategory($actor,$id,$category)['id'];
                }else{$id=$plan['options']['projectId'];foreach($plan['statusMap'] as $source=>$target)$statusIds[$source]=$target;foreach($project['categories'] as $category)$categoryIds[$category['key']]=genesisSharedCreateCategory($actor,$id,$category)['id'];}
                $projectIds[$key]=$id;genesisDataRecord($import,'project',$key,$id,$id,['calendarMode'=>$data['calendarMode'],'calendarContext'=>$data['calendarContext'],'source'=>$project]);
            }
            foreach($plan['fields'] as $projectKey=>$fields)foreach($fields as $key=>$field){$ref=$projectKey.'|'.$key;if($field['targetId']!==null){$fieldIds[$ref]=$field['targetId'];$optionIds[$ref]=$plan['optionMap'][$key]??[];continue;}$id=genesisUuid();$createdFields[]=$id;$fieldIds[$ref]=$id;$choices=[];foreach($field['options'] as $choice){$choiceId=genesisUuid();$optionIds[$ref][$choice['id']]=$choiceId;$choices[]=[...$choice,'id'=>$choiceId,'archived'=>false];}
                $definition=['id'=>$id,'projectId'=>$projectIds[$projectKey],'title'=>$field['title'],'type'=>$field['type'],'options'=>$choices,'position'=>$field['position'],'required'=>$field['required'],'showCard'=>$field['showCard'],'showList'=>$field['showList'],'archived'=>$field['archived'],'expectedRevision'=>0];$preview=genesisSharedPreviewCustomField($actor,$spaceId,$definition);genesisSharedSaveCustomField($actor,$spaceId,[...$definition,'fingerprint'=>$preview['fingerprint'],'operationId'=>genesisUuid()]);
            }
            $createdTasks=[];$open=[];foreach($data['projects'] as $project){$id=$projectIds[$project['key']];$rows=genesisDataRows('SELECT id FROM shared_project_statuses WHERE project_id=? AND is_done=0 AND is_chaos=0 ORDER BY position,id LIMIT 1',[$id]);$open[$project['key']]=$rows[0]['id'];}
            foreach($data['tasks'] as $task){$key=$task['key'];$projectKey=$task['projectKey'];$values=$plan['targetValues'][$key];$historicalValues=[];foreach((array)$task['customValues'] as $field=>$value){$ref=$projectKey.'|'.$field;$spec=$plan['fields'][$projectKey][$field];if($spec['targetId']!==null)continue;if(in_array($spec['type'],['select','multi'],true))$value=$spec['type']==='select'?$optionIds[$ref][$value]:array_map(static fn($value)=>$optionIds[$ref][$value],$value);if($spec['archived'])$historicalValues[$fieldIds[$ref]]=$value;else $values[$fieldIds[$ref]]=$value;}
                $lists=[];foreach($task['checklists'] as $list){$listId=genesisUuid();$checklistIds[$list['key']]=$listId;$items=[];foreach($list['items'] as $item){$itemId=genesisUuid();$checklistIds[$item['key']]=$itemId;$items[]=['id'=>$itemId,'title'=>$item['title'],'done'=>$item['done'],'assigneeId'=>$plan['memberMap'][$item['assigneeKey']]??null,'dueDate'=>$item['dueDate']];}$lists[]=['id'=>$listId,'title'=>$list['title'],'items'=>$items];}
                $approvers=[];foreach($task['approvals'] as $approval)if(($plan['memberMap'][$approval['memberKey']]??null)!==null)$approvers[]=$plan['memberMap'][$approval['memberKey']];
                $sourceStatus=null;foreach($data['projects'] as $p)if($p['key']===$projectKey){foreach($p['statuses'] as $s)if($s['key']===$task['statusKey'])$sourceStatus=$s;break;}
                $created=GenesisPlanningSeedScope::run(fn()=>genesisSharedTask($actor,$projectIds[$projectKey],['title'=>$task['title'],'description'=>$task['description'],'entryType'=>$task['entryType'],'statusId'=>$open[$projectKey],'categoryId'=>$categoryIds[$task['categoryKey']]??null,'priority'=>$task['priority'],'tags'=>$task['tags'],'assigneeId'=>$plan['memberMap'][$task['assigneeKey']]??null,'labelIds'=>$labels($task['labelKeys']),'dueDate'=>$task['dueDate'],'startDate'=>$task['startDate'],'startTime'=>$task['startTime'],'endTime'=>$task['endTime'],'parentTaskId'=>$task['parentKey']===null?null:$taskIds[$task['parentKey']],'checklists'=>$lists,'customFields'=>$values,'approvalRequired'=>!$sourceStatus['isDone']&&(bool)$approvers,'approverIds'=>array_values(array_unique($approvers)),'storyPoints'=>$task['storyPoints'],'estimateHours'=>$task['estimateHours']]));
                if($historicalValues)genesisSharedSaveCustomTaskValues($created['id'],$values+$historicalValues);
                $taskIds[$key]=$created['id'];$createdTasks[$key]=$created;
            }
            foreach($data['tasks'] as $task){$key=$task['key'];$id=$taskIds[$key];$lists=$createdTasks[$key]['checklists'];foreach($task['checklists'] as $i=>$list)foreach($list['items'] as $j=>$item)if($item['linkedTaskKey']!==null){$lists[$i]['items'][$j]['linkedTaskId']=$taskIds[$item['linkedTaskKey']];$lists[$i]['items'][$j]['done']=false;}
                genesisSharedTaskDetailsSave($id,['priority'=>$task['priority'],'parentId'=>$task['parentKey']===null?null:$taskIds[$task['parentKey']],'checklists'=>$lists]);
                if($task['dependsOnKeys'])genesisSharedTask($actor,$projectIds[$task['projectKey']],['expectedRevision'=>$createdTasks[$key]['revision'],'dependsOnIds'=>array_map(static fn($key)=>$taskIds[$key],$task['dependsOnKeys'])],$id);
            }
            // Complete children/checklist targets/predecessors before their dependents, using the common mutation guards.
            $tasks=array_column($data['tasks'],null,'key');$edges=[];$pending=[];$ready=[];$children=[];foreach($tasks as $task)if($task['parentKey']!==null)$children[$task['parentKey']][]=$task['key'];
            foreach($tasks as $key=>$task){$refs=[...$task['dependsOnKeys'],...($children[$key]??[])];foreach($task['checklists'] as $list)foreach($list['items'] as $item)if($item['linkedTaskKey']!==null)$refs[]=$item['linkedTaskKey'];$refs=array_unique($refs);$pending[$key]=count($refs);if(!$refs)$ready[]=$key;foreach($refs as $ref)$edges[$ref][]=$key;}
            for($i=0;$i<count($ready);$i++){$key=$ready[$i];$task=$tasks[$key];$id=$taskIds[$key];$project=$projectIds[$task['projectKey']];$current=genesisSharedGetTask($actor,$project,$id);genesisSharedTask($actor,$project,['expectedRevision'=>$current['revision'],'statusId'=>$statusIds[$task['statusKey']]],$id);
                foreach($edges[$key]??[] as $dependent)if(--$pending[$dependent]===0)$ready[]=$dependent;
            }
            $sourceFields=array_column($data['fields'],null,'key');foreach($plan['fields'] as $projectKey=>$fields)foreach($fields as $key=>$field){if($field['targetId']!==null)continue;$ref=$projectKey.'|'.$key;$id=$fieldIds[$ref];$previous=$field['predecessorKey'];$predecessor=$previous===null?null:($fieldIds[($sourceFields[$previous]['projectKey']??$projectKey).'|'.$previous]??null);$choices=[];foreach($field['options'] as $choice)$choices[]=[...$choice,'id'=>$optionIds[$ref][$choice['id']]];
                $db->prepare('UPDATE shared_custom_fields SET definition_json=?,required=?,archived_at=?,predecessor_id=? WHERE id=?')->execute([genesisDataSeal(['title'=>$field['title'],'options'=>$choices]),(int)$field['required'],$field['archived']?$now:null,$predecessor,$id]);
                // Replace staged revision history with the final historical definition, without weakening normal mutations.
                $db->prepare('DELETE FROM shared_custom_field_versions WHERE field_id=?')->execute([$id]);genesisSharedCustomFieldVersion($id,$actor);
            }
            foreach($data['tasks'] as $task){$id=$taskIds[$task['key']];$row=genesisDataRows('SELECT revision,completed_at,created_at,updated_at FROM shared_tasks WHERE id=?',[$id])[0];
                $db->prepare('UPDATE shared_tasks SET created_at=?,updated_at=?,completed_at=?,archived_at=?,archive_root_id=? WHERE id=?')->execute([$task['createdAt']??$row['created_at'],$task['updatedAt']??$row['updated_at'],$row['completed_at']===null?null:($task['completedAt']??$row['completed_at']),$task['archivedAt'],$task['archivedAt']!==null?($taskIds[$task['archiveRootKey']]??$id):null,$id]);
                $db->prepare('INSERT INTO shared_notification_task_state(task_id,due_date,completed,imported) VALUES(?,?,?,1)')->execute([$id,$task['dueDate'],$row['completed_at']===null?0:1]);
                $historicalApprovals=[];$sourceTitles=array_column($data['members'],'title','key');$memberTitles=[];foreach($task['approvals'] as $approval){$member=$plan['memberMap'][$approval['memberKey']]??$approval['memberKey'];$historicalApprovals[]=[...$approval,'memberKey'=>$member];$memberTitles[$member]=$sourceTitles[$approval['memberKey']]??'';}
                genesisDataRecord($import,'task',$task['key'],$id,$projectIds[$task['projectKey']],['approvals'=>$historicalApprovals,'memberTitles'=>$memberTitles,'sourceCompletedAt'=>$task['completedAt'],'sourceKey'=>$task['key']],(int)$row['revision']);
            }
            foreach($data['comments'] as $comment){$task=$comment['taskKey']===null?null:$taskIds[$comment['taskKey']];$project=$projectIds[$comment['projectKey']];genesisSharedProjectAccess($project,$actor,'comment');$id=genesisUuid();
                if($task!==null)$db->prepare('INSERT INTO shared_comments(id,task_id,author_id,body,created_at) VALUES(?,?,?,?,?)')->execute([$id,$task,$actor,$comment['body'],$comment['createdAt']??$now]);
                else $db->prepare('INSERT INTO shared_project_comments(id,project_id,board_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)')->execute([$id,$project,$statusIds[$comment['boardStatusKey']]??null,$actor,$comment['body'],$comment['createdAt']??$now]);
                genesisDataRecord($import,'comment',$comment['key'],$id,$project,[...$comment,'projectKey'=>$project,'taskKey'=>$task,'boardStatusKey'=>$statusIds[$comment['boardStatusKey']]??null]);}
            foreach(['history','attachments','series','templates'] as $kind)foreach($data[$kind] as $row){$project=$projectIds[$row['projectKey']];$row['projectKey']=$project;if(isset($row['taskKey']))$row['taskKey']=$taskIds[$row['taskKey']];genesisDataRecord($import,$kind,$row['key'],$row['taskKey']??null,$project,$row);}
            if($new)foreach($data['projects'] as $project)$db->prepare('UPDATE shared_projects SET archived_at=?,created_at=COALESCE(?,created_at) WHERE id=?')->execute([$project['archivedAt'],$project['createdAt'],$projectIds[$project['key']]]);
            return ['importId'=>$import,'operationId'=>$operation,'spaceId'=>$spaceId,'rootProjectId'=>reset($projectIds),'projectIds'=>$projectIds,'createdProjectIds'=>$createdProjects,'taskIds'=>$taskIds,'statusIds'=>$statusIds,'categoryIds'=>$categoryIds,'fieldIds'=>$fieldIds,'createdFieldIds'=>$createdFields,'optionIds'=>$optionIds,'labelIds'=>$labelIds,'createdLabelIds'=>$createdLabels,'checklistIds'=>$checklistIds,'projectCount'=>count($createdProjects),'taskCount'=>count($taskIds),'notices'=>$plan['notices'],'duplicate'=>false,'state'=>'active','canUndo'=>true];
        });
        foreach($receipt['taskIds'] as $id){$project=genesisDataRows('SELECT project_id FROM shared_tasks WHERE id=?',[$id])[0]['project_id'];genesisWorkflowTask($actor,$project,$id,null,false,false);}
        foreach(array_unique(array_values($receipt['projectIds'])) as $project)genesisWorkflowAssertWip($project,genesisWorkflowConfig($project));
        genesisSharedAudit($receipt['rootProjectId'],$actor,'data.imported',$import,['taskCount'=>$receipt['taskCount'],'projectCount'=>$receipt['projectCount']]);
        $baseline=genesisDataImportSnapshot($receipt);$db->prepare('UPDATE shared_data_imports SET receipt_json=?,baseline_json=? WHERE id=?')->execute([genesisDataSeal($receipt),genesisDataSeal(['hash'=>$baseline]),$import]);
        if($owns)$db->commit();else $db->exec('RELEASE '.$savepoint);return $receipt;
    }catch(Throwable $error){if($db->inTransaction()){if($owns)$db->rollBack();else{$db->exec('ROLLBACK TO '.$savepoint);$db->exec('RELEASE '.$savepoint);}}throw $error;}
}

function genesisSharedDataUndo(string $actor,string $import):array{
    genesisSharedRequireEnabled($actor);$db=genesisDb();genesisBeginWriteTransaction($db);
    try{$rows=genesisDataRows('SELECT * FROM shared_data_imports WHERE id=? AND actor_id=?',[$import,$actor]);if(!$rows)throw new GenesisSharedAccessException();$row=$rows[0];genesisSharedSpaceAccess($row['space_id'],$actor);$receipt=genesisDataOpen($row['receipt_json']);
        if($row['state']==='undone'){$db->commit();return ['importId'=>$import,'state'=>'undone'];}if($row['state']==='removed')throw new GenesisSharedAccessException('DATA_IMPORT_REMOVED',409);genesisDataReceiptAccess($actor,$receipt,'write');
        if($receipt['createdFieldIds'])genesisSharedCustomFieldManage($actor,$row['space_id']);if($receipt['createdLabelIds'])genesisSharedLabelAccess($actor,$row['space_id']);if($receipt['categoryIds'])foreach(array_unique(array_values($receipt['projectIds'])) as $project)genesisSharedProjectAccess($project,$actor,'manage',true);
        foreach($receipt['createdProjectIds'] as $project)genesisSharedProjectAccess($project,$actor,'owner',true);
        if(!hash_equals(genesisDataOpen($row['baseline_json'])['hash'],genesisDataImportSnapshot($receipt)))throw new GenesisSharedAccessException('DATA_UNDO_CONFLICT',409);
        foreach($receipt['taskIds'] as $task)$db->prepare('DELETE FROM shared_tasks WHERE id=?')->execute([$task]);
        foreach(array_reverse($receipt['createdProjectIds']) as $project)$db->prepare('DELETE FROM shared_projects WHERE id=?')->execute([$project]);
        foreach($receipt['createdFieldIds'] as $field)$db->prepare('DELETE FROM shared_custom_fields WHERE id=?')->execute([$field]);
        foreach($receipt['createdLabelIds'] as $label)$db->prepare('DELETE FROM shared_space_labels WHERE id=?')->execute([$label]);
        if(!$receipt['createdProjectIds']){foreach($receipt['categoryIds'] as $category)$db->prepare('DELETE FROM shared_project_categories WHERE id=?')->execute([$category]);$db->prepare("DELETE FROM shared_project_comments WHERE id IN (SELECT target_id FROM shared_data_import_records WHERE import_id=? AND kind='comment')")->execute([$import]);}
        $db->prepare('DELETE FROM shared_data_import_records WHERE import_id=?')->execute([$import]);$db->prepare("UPDATE shared_data_imports SET state='undone',undone_at=? WHERE id=?")->execute([genesisNow(),$import]);$db->commit();return ['importId'=>$import,'state'=>'undone'];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedDataImports(string $actor,string $spaceId,?string $cursor=null):array{
    genesisSharedRequireEnabled($actor);genesisSharedSpaceAccess($spaceId,$actor);$values=[$spaceId,$actor];$where='';
    if($cursor!==null){$rows=genesisDataRows('SELECT created_at FROM shared_data_imports WHERE id=? AND space_id=? AND actor_id=?',[$cursor,$spaceId,$actor]);if(!$rows)genesisDataInvalid('DATA_CURSOR_INVALID');$where=' AND (created_at<? OR (created_at=? AND id<?))';array_push($values,$rows[0]['created_at'],$rows[0]['created_at'],$cursor);}
    $rows=genesisDataRows('SELECT * FROM shared_data_imports WHERE space_id=? AND actor_id=?'.$where.' ORDER BY created_at DESC,id DESC LIMIT 51',$values);$items=[];
    foreach(array_slice($rows,0,50) as $row){$receipt=genesisDataOpen($row['receipt_json']);try{if($row['state']==='active')genesisDataReceiptAccess($actor,$receipt);}catch(GenesisSharedAccessException){continue;}$items[]=[...$receipt,'state'=>$row['state'],'createdAt'=>$row['created_at'],'canUndo'=>$row['state']==='active'];}
    return ['imports'=>$items,'nextCursor'=>count($rows)>50?$rows[49]['id']:null];
}

function genesisSharedDataHistory(string $actor,string $project,?string $task=null,?string $cursor=null):array{
    genesisSharedRequireEnabled($actor);genesisSharedProjectAccess($project,$actor,'read',true);$values=[$project];$where='';
    if($task!==null){if(!genesisDataRows('SELECT id FROM shared_tasks_history_read WHERE id=? AND project_id=?',[$task,$project]))throw new GenesisSharedAccessException();$where.=' AND r.target_id=?';$values[]=$task;}
    if($cursor!==null){if(!preg_match('/^[0-9]{1,18}$/D',$cursor))genesisDataInvalid('DATA_CURSOR_INVALID');$where.=' AND r.rowid>?';$values[]=(int)$cursor;}
    $rows=genesisDataRows("SELECT r.rowid AS cursor_id,r.kind,r.target_id,r.payload_json FROM shared_data_import_records r JOIN shared_data_imports i ON i.id=r.import_id WHERE r.project_id=? AND i.state='active' AND r.kind IN('task','history','series','templates','attachments') AND (r.target_id IS NULL OR r.target_id IN(SELECT id FROM shared_tasks_history_read WHERE project_id=r.project_id))".$where.' ORDER BY r.rowid LIMIT 51',$values);$items=[];
    foreach(array_slice($rows,0,50) as $row){$source=genesisDataOpen($row['payload_json']);if($row['kind']==='task'&&!$source['approvals'])continue;$items[]=['id'=>(string)$row['cursor_id'],'kind'=>$row['kind'],'source'=>$source];}
    return ['records'=>$items,'nextCursor'=>count($rows)>50?(string)$rows[49]['cursor_id']:null];
}
