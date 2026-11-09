<?php
declare(strict_types=1);

/** Durable task selections use bounded batches and the existing ACL/receipt contracts. */
function genesisSharedBulkAction(mixed $value): array
{
    if(!is_array($value)||!is_string($value['kind']??null))throw new InvalidArgumentException('BULK_INVALID');
    $kind=$value['kind'];
    switch($kind){
        case 'priority':
            if(!is_int($value['priority']??null)||$value['priority']<0||$value['priority']>3)throw new InvalidArgumentException('BULK_INVALID');
            return ['kind'=>$kind,'priority'=>$value['priority']];
        case 'assignee':
            if(!array_key_exists('assigneeId',$value)||($value['assigneeId']!==null&&(!is_string($value['assigneeId'])||$value['assigneeId']===''||strlen($value['assigneeId'])>100)))throw new InvalidArgumentException('BULK_INVALID');
            return ['kind'=>$kind,'assigneeId'=>$value['assigneeId']];
        case 'status':
            $map=$value['statusIds']??null;
            if(!is_array($map)||!$map||array_is_list($map)||count($map)>1000)throw new InvalidArgumentException('BULK_INVALID');
            foreach($map as$project=>$status)if(!is_string($project)||!is_string($status)||$project===''||$status===''||strlen($project)>100||strlen($status)>100)throw new InvalidArgumentException('BULK_INVALID');
            return ['kind'=>$kind,'statusIds'=>$map];
        case 'due':
            if(!in_array($value['mode']??null,['set','shift','clear'],true))throw new InvalidArgumentException('BULK_INVALID');
            $result=['kind'=>$kind,'mode'=>$value['mode']];
            if($value['mode']==='set'){$result['date']=genesisSharedTaskDate($value['date']??null);if(!$result['date'])throw new InvalidArgumentException('BULK_INVALID');}
            if($value['mode']==='shift'){
                if(!is_int($value['days']??null)||$value['days']===0||abs($value['days'])>36600)throw new InvalidArgumentException('BULK_INVALID');
                $result['days']=$value['days'];
            }
            return $result;
        case 'labels':
            if(!in_array($value['mode']??null,['add','remove'],true))throw new InvalidArgumentException('BULK_INVALID');
            $ids=genesisSharedQueryIds($value['labelIds']??null);if(!$ids)throw new InvalidArgumentException('BULK_INVALID');
            return ['kind'=>$kind,'mode'=>$value['mode'],'labelIds'=>$ids];
        case 'move':
            foreach(['projectId','statusId']as$key)if(!is_string($value[$key]??null)||$value[$key]===''||strlen($value[$key])>100)throw new InvalidArgumentException('BULK_INVALID');
            return ['kind'=>$kind,'projectId'=>$value['projectId'],'statusId'=>$value['statusId']];
        case 'archive': return ['kind'=>$kind];
        case 'trash': return ['kind'=>$kind,'retentionDays'=>genesisSharedTrashDays($value['retentionDays']??30)];
        default: throw new InvalidArgumentException('BULK_INVALID');
    }
}

function genesisSharedBulkAccess(string $actor,string $id): array
{
    genesisSharedRequireEnabled($actor);
    $q=genesisDb()->prepare('SELECT * FROM shared_bulk_operations WHERE id=? AND actor_id=?');$q->execute([$id,$actor]);$row=$q->fetch();$q->closeCursor();
    if(!$row)throw new GenesisSharedAccessException();
    return $row;
}

/** One ACL-bound predicate powers metadata and durable snapshots; no task collection reaches PHP. */
function genesisSharedBulkSelectionScope(string $actor,array $selection): array
{
    if(($selection['mode']??null)==='all'){
        if(array_diff(array_keys($selection),['mode','filter','sort','queryVersion'])||!is_array($selection['filter']??null)||!is_string($selection['queryVersion']??null)||!is_string($selection['sort']??'position'))throw new InvalidArgumentException('BULK_INVALID');
        [$filter,$sort,$viewSignature]=genesisSharedViewQuery($actor,$selection['filter'],$selection['sort']??'position');$scope=genesisSharedQueryScope($actor,$filter);
        $signature=hash('sha256',json_encode([$actor,$filter,$sort,$scope,$viewSignature],JSON_THROW_ON_ERROR));
        if(!hash_equals($signature,$selection['queryVersion']))throw new GenesisSharedAccessException('SHARED_QUERY_CHANGED',409);
        [$where,$values]=genesisSharedTaskPredicate($actor,$filter,$scope);
    }elseif(($selection['mode']??null)==='page'){
        $items=$selection['items']??null;
        if(array_diff(array_keys($selection),['mode','items'])||!is_array($items)||!array_is_list($items)||!$items||count($items)>1000)throw new InvalidArgumentException('BULK_INVALID');
        $projects=[];$ids=[];
        foreach($items as$item){
            if(!is_array($item)||!is_string($item['id']??null)||!is_string($item['projectId']??null)||strlen($item['id'])>100||strlen($item['projectId'])>100||!is_int($item['revision']??null)||$item['revision']<1)throw new InvalidArgumentException('BULK_INVALID');
            genesisSharedProjectAccess($item['projectId'],$actor);
            $q=genesisDb()->prepare('SELECT revision FROM shared_tasks_history_read WHERE id=? AND project_id=?');$q->execute([$item['id'],$item['projectId']]);$revision=$q->fetchColumn();$q->closeCursor();
            if($revision===false)throw new GenesisSharedAccessException();
            if((int)$revision!==$item['revision'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
            $projects[]=$item['projectId'];$ids[]=$item['id'];
        }
        $filter=['projectIds'=>array_values(array_unique($projects)),'includeArchived'=>true];$scope=genesisSharedQueryScope($actor,$filter);
        [$where,$values]=genesisSharedTaskPredicate($actor,$filter,$scope);
        $where.=' AND t.id IN (SELECT value FROM json_each(?))';$values[]=json_encode(array_values(array_unique($ids)),JSON_THROW_ON_ERROR);
        $signature=hash('sha256',json_encode([$actor,$selection,$scope],JSON_THROW_ON_ERROR));
    }else throw new InvalidArgumentException('BULK_INVALID');
    return [$where,$values,$signature];
}

/** Bounded project/status metadata lets mixed-project actions be configured explicitly. */
function genesisSharedBulkScope(string $actor,array $selection,?string $cursor=null): array
{
    genesisSharedRequireEnabled($actor);[$where,$values,$signature]=genesisSharedBulkSelectionScope($actor,$selection);$after=null;
    if($cursor!==null&&$cursor!==''){
        $state=strlen($cursor)<16000?json_decode(genesisDecrypt($cursor)??'',true):null;
        if(!is_array($state)||!is_string($state['signature']??null)||!is_string($state['id']??null))throw new InvalidArgumentException('BULK_PAGE_INVALID');
        if(!hash_equals($signature,$state['signature']))throw new GenesisSharedAccessException('SHARED_QUERY_CHANGED',409);
        $after=$state['id'];
    }
    $db=genesisDb();$q=$db->prepare('SELECT COUNT(*) FROM shared_tasks_history_read t WHERE '.$where);$q->execute($values);$total=(int)$q->fetchColumn();$q->closeCursor();
    $q=$db->prepare('SELECT p.id,p.space_id AS spaceId,p.title,COUNT(*) AS taskCount FROM shared_tasks_history_read t JOIN shared_projects p ON p.id=t.project_id WHERE '.$where.($after===null?'':' AND p.id>?').' GROUP BY p.id ORDER BY p.id LIMIT 101');
    $q->execute($after===null?$values:[...$values,$after]);$projects=$q->fetchAll();$q->closeCursor();$hasMore=count($projects)>100;if($hasMore)array_pop($projects);
    foreach($projects as&$project){
        $q=$db->prepare('SELECT id,title,is_done AS isDone FROM shared_project_statuses WHERE project_id=? AND is_chaos=0 ORDER BY position,id');$q->execute([$project['id']]);$project['statuses']=$q->fetchAll();$q->closeCursor();$project['taskCount']=(int)$project['taskCount'];
        foreach($project['statuses']as&$status)$status['isDone']=(bool)$status['isDone'];unset($status);
    }unset($project);
    $nextCursor=$hasMore?genesisEncrypt(json_encode(['signature'=>$signature,'id'=>end($projects)['id']],JSON_THROW_ON_ERROR)):null;
    return compact('total','projects','hasMore','nextCursor');
}

/** Selection and action are durable; the browser never has to fetch all matching task pages. */
function genesisSharedBulkPreview(string $actor,array $input): array
{
    genesisSharedRequireEnabled($actor);
    $request=genesisSharedRequestId($input);if(!$request)throw new InvalidArgumentException('BULK_INVALID');
    $action=genesisSharedBulkAction($input['action']??null);$selection=$input['selection']??null;
    if(!is_array($selection)||!in_array($selection['mode']??null,['page','all'],true))throw new InvalidArgumentException('BULK_INVALID');
    $canonical=['action'=>$action,'selection'=>$selection];$serialized=json_encode($canonical,JSON_THROW_ON_ERROR);
    if(strlen($serialized)>1_048_576)throw new InvalidArgumentException('BULK_INVALID');$hash=hash('sha256',$serialized);
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT id,payload_hash FROM shared_bulk_operations WHERE actor_id=? AND request_id=?');$q->execute([$actor,$request]);$previous=$q->fetch();$q->closeCursor();
        if($previous){if(!hash_equals($previous['payload_hash'],$hash))throw new GenesisSharedAccessException('SHARED_REQUEST_ID_CONFLICT',409);$db->commit();return genesisSharedBulkReport($actor,$previous['id']);}
        $id=genesisUuid();$now=genesisNow();$expires=gmdate('Y-m-d\TH:i:s\Z',time()+600);
        $db->prepare('INSERT INTO shared_bulk_operations(id,actor_id,request_id,payload_hash,payload,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
            ->execute([$id,$actor,$request,$hash,genesisSharedContentEncrypt($serialized),$expires,$now,$now]);
        [$where,$values]=genesisSharedBulkSelectionScope($actor,$selection);
        $db->prepare('INSERT INTO shared_bulk_items(operation_id,task_id,project_id,root_id,expected_revision,expected_parent_id,selected) SELECT ?,t.id,t.project_id,t.id,t.revision,t.parent_task_id,1 FROM shared_tasks_history_read t WHERE '.$where)->execute([$id,...$values]);
        $cascade=in_array($action['kind'],['archive','trash'],true);
        $ancestry='WITH RECURSIVE ancestors(task_id,id,parent_id,depth) AS (SELECT i.task_id,t.id,t.parent_task_id,0 FROM shared_bulk_items i JOIN shared_tasks_history_read t ON t.id=i.task_id WHERE i.operation_id=? UNION ALL SELECT a.task_id,t.id,t.parent_task_id,a.depth+1 FROM ancestors a JOIN shared_tasks_history_read t ON t.id=a.parent_id WHERE a.depth<1000) ';
        $db->prepare($ancestry.'UPDATE shared_bulk_items SET depth=(SELECT MAX(depth) FROM ancestors a WHERE a.task_id=shared_bulk_items.task_id) WHERE operation_id=?')->execute([$id,$id]);
        if($cascade){
            $db->prepare($ancestry.'UPDATE shared_bulk_items SET root_id=(SELECT a.id FROM ancestors a JOIN shared_bulk_items i ON i.task_id=a.id AND i.operation_id=? WHERE a.task_id=shared_bulk_items.task_id ORDER BY a.depth DESC LIMIT 1) WHERE operation_id=?')->execute([$id,$id,$id]);
            $db->prepare('WITH RECURSIVE branch(root_id,task_id,project_id,revision,parent_id,depth) AS (SELECT root_id,task_id,project_id,expected_revision,expected_parent_id,depth FROM shared_bulk_items WHERE operation_id=? AND task_id=root_id UNION ALL SELECT b.root_id,t.id,t.project_id,t.revision,t.parent_task_id,b.depth+1 FROM branch b CROSS JOIN shared_tasks_history_read t ON t.parent_task_id=b.task_id AND t.project_id=b.project_id) INSERT OR IGNORE INTO shared_bulk_items(operation_id,task_id,project_id,root_id,expected_revision,expected_parent_id,depth,selected) SELECT ?,task_id,project_id,root_id,revision,parent_id,depth,0 FROM branch')->execute([$id,$id]);
        }
        $db->commit();return genesisSharedBulkReport($actor,$id);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedBulkCounts(string $id): array
{
    $q=genesisDb()->prepare('SELECT state,selected,COUNT(*) AS n FROM shared_bulk_items WHERE operation_id=? GROUP BY state,selected');$q->execute([$id]);$counts=['selected'=>0,'affected'=>0,'pending'=>0,'succeeded'=>0,'skipped'=>0,'failed'=>0,'cancelled'=>0];
    foreach($q->fetchAll()as$count){$n=(int)$count['n'];$counts['affected']+=$n;$counts[$count['state']]+=$n;if((int)$count['selected'])$counts['selected']+=$n;}$q->closeCursor();return $counts;
}

/** Names are resolved with current read access, never copied from a cached task or old report. */
function genesisSharedBulkActionInfo(string $actor,array $action,array $items): array
{
    $db=genesisDb();$info=['unavailable'=>false];$kind=$action['kind'];
    if($kind==='move'){
        try{
            $project=genesisSharedProjectAccess($action['projectId'],$actor);
            $q=$db->prepare('SELECT title FROM shared_project_statuses WHERE id=? AND project_id=?');$q->execute([$action['statusId'],$project['id']]);$title=$q->fetchColumn();$q->closeCursor();
            return ['projectTitle'=>$project['title'],'statusTitle'=>$title===false?null:$title,'unavailable'=>$title===false];
        }catch(GenesisSharedAccessException){return ['unavailable'=>true];}
    }
    if($kind==='status'){
        $projects=array_values(array_unique(array_column($items,'projectId')));$q=$db->prepare('SELECT s.id,s.title AS statusTitle,s.project_id AS projectId,p.title AS projectTitle FROM json_each(?) choice JOIN shared_project_statuses s ON s.id=choice.value AND s.project_id=choice.key JOIN shared_projects p ON p.id=s.project_id WHERE s.project_id IN (SELECT value FROM json_each(?))');
        $q->execute([json_encode($action['statusIds'],JSON_THROW_ON_ERROR),json_encode($projects,JSON_THROW_ON_ERROR)]);$info['statuses']=$q->fetchAll();$q->closeCursor();
        $info['unavailable']=count($info['statuses'])<count(array_intersect($projects,array_keys($action['statusIds'])));return $info;
    }
    if($kind==='assignee'&&$action['assigneeId']===null)return $info+['assigneeName'=>null];
    if(!in_array($kind,['assignee','labels'],true))return $info;
    $scope=genesisSharedQueryScope($actor,[]);
    if($kind==='assignee'){
        $q=$db->prepare("SELECT COALESCE(NULLIF(u.display_name,''),'—') FROM users u WHERE u.id=? AND EXISTS(SELECT 1 FROM shared_project_members m WHERE m.user_id=u.id AND m.project_id IN (SELECT value FROM json_each(?)))");
        $q->execute([$action['assigneeId'],json_encode(array_column($scope,'id'),JSON_THROW_ON_ERROR)]);$name=$q->fetchColumn();$q->closeCursor();return ['assigneeName'=>$name===false?null:$name,'unavailable'=>$name===false];
    }
    $spaces=array_values(array_unique(array_column($scope,'space_id')));$q=$db->prepare('SELECT l.id,l.title,s.title AS spaceTitle FROM shared_space_labels l JOIN shared_spaces s ON s.id=l.space_id WHERE l.id IN (SELECT value FROM json_each(?)) AND l.space_id IN (SELECT value FROM json_each(?)) ORDER BY l.id');
    $q->execute([json_encode($action['labelIds'],JSON_THROW_ON_ERROR),json_encode($spaces,JSON_THROW_ON_ERROR)]);$labels=$q->fetchAll();$q->closeCursor();return ['labels'=>$labels,'unavailable'=>count($labels)!==count($action['labelIds'])];
}

/** Recent operations can be recovered after logout without retaining private drafts on the device. */
function genesisSharedBulkOperations(string $actor,?string $cursor=null): array
{
    genesisSharedRequireEnabled($actor);$db=genesisDb();$values=[$actor];$where='actor_id=?';$signature=hash('sha256',$actor.':bulk-operations-v1');
    if($cursor!==null&&$cursor!==''){
        $state=strlen($cursor)<16000?json_decode(genesisDecrypt($cursor)??'',true):null;
        if(!is_array($state)||!is_string($state['signature']??null)||!hash_equals($signature,$state['signature'])||!is_string($state['id']??null)||!is_string($state['date']??null))throw new InvalidArgumentException('BULK_PAGE_INVALID');
        $where.=' AND (created_at<? OR (created_at=? AND id<?))';array_push($values,$state['date'],$state['date'],$state['id']);
    }
    $q=$db->prepare('SELECT id,state,payload,created_at,error_code FROM shared_bulk_operations WHERE '.$where.' ORDER BY created_at DESC,id DESC LIMIT 21');$q->execute($values);$rows=$q->fetchAll();$q->closeCursor();$hasMore=count($rows)>20;if($hasMore)array_pop($rows);$operations=[];
    foreach($rows as$row){
        try{$payload=json_decode(genesisSharedContentDecrypt($row['payload']),true,32,JSON_THROW_ON_ERROR);}catch(Throwable){$payload=[];}
        $operations[]=['id'=>$row['id'],'state'=>$row['state'],'createdAt'=>$row['created_at'],'errorCode'=>$row['error_code'],'action'=>$payload['action']??null,'mode'=>$payload['selection']['mode']??null,'counts'=>genesisSharedBulkCounts($row['id'])];
    }
    $last=$rows?end($rows):null;$nextCursor=$hasMore?genesisEncrypt(json_encode(['signature'=>$signature,'id'=>$last['id'],'date'=>$last['created_at']],JSON_THROW_ON_ERROR)):null;
    return compact('operations','hasMore','nextCursor');
}

function genesisSharedBulkReport(string $actor,string $id,int $after=0): array
{
    $row=genesisSharedBulkAccess($actor,$id);$db=genesisDb();
    $counts=genesisSharedBulkCounts($id);
    $payload=json_decode(genesisSharedContentDecrypt($row['payload']),true,32,JSON_THROW_ON_ERROR);
    $q=$db->prepare('SELECT id,task_id,project_id,selected,state,error_code FROM shared_bulk_items WHERE operation_id=? AND id>? ORDER BY id LIMIT 101');$q->execute([$id,max(0,$after)]);$items=$q->fetchAll();$q->closeCursor();$hasMore=count($items)>100;if($hasMore)array_pop($items);
    $results=[];
    foreach($items as$item){
        $result=['cursor'=>(int)$item['id'],'selected'=>(bool)$item['selected'],'state'=>$item['state'],'code'=>$item['error_code']];
        try{
            $readProject=$item['state']==='succeeded'&&$payload['action']['kind']==='move'?$payload['action']['projectId']:$item['project_id'];
            $readAccess=genesisSharedProjectAccess($readProject,$actor);
            $q=$db->prepare('SELECT title FROM shared_tasks_history_read WHERE id=? AND project_id=?');$q->execute([$item['task_id'],$readProject]);$title=$q->fetchColumn();$q->closeCursor();
            $result+=['id'=>$item['task_id'],'projectId'=>$readProject,'projectTitle'=>$readAccess['title'],'available'=>$title!==false];
            if($title===false&&$payload['action']['kind']==='trash'&&$item['state']==='succeeded'){
                $q=$db->prepare("SELECT genesis_content_decrypt(t.title) FROM shared_tasks t JOIN shared_trash tr ON tr.kind='task' AND tr.object_id=t.id AND tr.expires_at>? WHERE t.id=? AND t.project_id=?");
                $q->execute([genesisNow(),$item['task_id'],$readProject]);$title=$q->fetchColumn();$q->closeCursor();
                if($title!==false)$result['trashed']=true;
            }
            if($title!==false)$result['title']=$title;
        }catch(GenesisSharedAccessException){/* Counts remain, revoked content never does. */}
        $results[]=$result;
    }
    $q=$db->prepare('SELECT state,available_at,error_code FROM background_jobs WHERE unique_key=?');$q->execute(['bulk:'.$id.':'.$row['batch_number']]);$job=$q->fetch();$q->closeCursor();
    return ['id'=>$id,'state'=>$row['state'],'mode'=>$payload['selection']['mode'],'action'=>$payload['action'],'expiresAt'=>$row['expires_at'],
        'errorCode'=>$row['error_code'],'retryAt'=>$job&&$job['state']==='pending'&&$job['error_code']!==null?$job['available_at']:null,'actionInfo'=>genesisSharedBulkActionInfo($actor,$payload['action'],$results),
        'counts'=>$counts,'items'=>$results,'hasMore'=>$hasMore,'nextCursor'=>$hasMore?(int)end($items)['id']:null];
}

function genesisSharedBulkConfirm(string $actor,string $id): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $row=genesisSharedBulkAccess($actor,$id);
        if($row['state']==='preview'){
            if($row['expires_at']<genesisNow())throw new GenesisSharedAccessException('BULK_PREVIEW_EXPIRED',409);
            $db->prepare("UPDATE shared_bulk_operations SET state='running',updated_at=? WHERE id=?")->execute([genesisNow(),$id]);
            genesisBackgroundEnqueue('shared-bulk','bulk:'.$id.':0',['operationId'=>$id]);
        }
        $db->commit();return genesisSharedBulkReport($actor,$id);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedBulkCancel(string $actor,string $id): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $row=genesisSharedBulkAccess($actor,$id);
        if(in_array($row['state'],['preview','running'],true)){
            $db->prepare("UPDATE shared_bulk_operations SET state='cancelled',updated_at=? WHERE id=?")->execute([genesisNow(),$id]);
            $db->prepare("UPDATE shared_bulk_items SET state='cancelled' WHERE operation_id=? AND state='pending'")->execute([$id]);
            $db->prepare("UPDATE background_jobs SET state='cancelled',updated_at=? WHERE kind='shared-bulk' AND state='pending' AND unique_key LIKE ?")->execute([genesisNow(),'bulk:'.$id.':%']);
        }
        $db->commit();return genesisSharedBulkReport($actor,$id);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** HTTP progress and cron claim the same job, with the same lease and retry backoff. */
function genesisSharedBulkAdvance(string $actor,string $id): array
{
    $row=genesisSharedBulkAccess($actor,$id);
    if($row['state']==='running'){
        $job=genesisBackgroundClaim(null,'bulk:'.$id.':'.$row['batch_number']);
        if($job)genesisBackgroundPerform($job);
    }
    return genesisSharedBulkReport($actor,$id);
}

/** A terminal background failure is visible and recoverable; it never leaves a running UI forever. */
function genesisSharedBulkJobFailed(array $job,string $code): void
{
    if(!preg_match('/\Abulk:([a-f0-9-]{36}):([0-9]+)\z/',$job['unique_key']??'',$match))return;
    $db=genesisDb();$q=$db->prepare('SELECT state,batch_number FROM shared_bulk_operations WHERE id=?');$q->execute([$match[1]]);$row=$q->fetch();$q->closeCursor();
    if(!$row||$row['state']!=='running'||(int)$row['batch_number']!==(int)$match[2])return;
    $db->prepare("UPDATE shared_bulk_items SET state='failed',error_code='BACKGROUND_RETRY' WHERE operation_id=? AND state='pending'")->execute([$match[1]]);
    $db->prepare("UPDATE shared_bulk_operations SET state='failed',error_code=?,updated_at=? WHERE id=?")->execute([$code,genesisNow(),$match[1]]);
}

function genesisSharedBulkResume(string $actor,string $id): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $row=genesisSharedBulkAccess($actor,$id);
        if($row['state']==='failed'){
            $db->prepare("UPDATE shared_bulk_items SET state='pending',error_code=NULL WHERE operation_id=? AND state='failed' AND error_code='BACKGROUND_RETRY'")->execute([$id]);
            $next=(int)$row['batch_number']+1;
            $db->prepare("UPDATE shared_bulk_operations SET state='running',error_code=NULL,batch_number=?,updated_at=? WHERE id=?")->execute([$next,genesisNow(),$id]);
            genesisBackgroundEnqueue('shared-bulk','bulk:'.$id.':'.$next,['operationId'=>$id]);
        }
        $db->commit();return genesisSharedBulkReport($actor,$id);
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Fixed cause vocabulary; never persist raw exceptions containing user content or infrastructure. */
function genesisSharedBulkError(Throwable $error): string
{
    if(preg_match('/^WORKFLOW_[A-Z_]+$/D',$error->getMessage()))return $error->getMessage();
    $known=['SHARED_TASK_CONFLICT','SHARED_PROJECT_NOT_FOUND','SHARED_PROJECT_FORBIDDEN','INVALID_ASSIGNEE','INVALID_STATUS','TASK_MOVE_RELATIONS','TASK_PARENT_COMPLETED','TASK_CHILDREN_INCOMPLETE','TASK_APPROVAL_REQUIRED','INVALID_LABEL','INVALID_DUE_DATE','BULK_TREE_CHANGED','BULK_NO_DUE','BULK_STATUS_REQUIRED','CUSTOM_FIELD_MOVE_REQUIRES_MAPPING'];
    return in_array($error->getMessage(),$known,true)?$error->getMessage():($error instanceof GenesisSharedAccessException?'BULK_NOT_ALLOWED':($error instanceof InvalidArgumentException?'BULK_INVALID_ITEM':'BULK_RETRY'));
}

function genesisSharedBulkApply(string $actor,array $item,array $action): void
{
    genesisSharedRequireEnabled($actor);
    $project=$item['project_id'];$id=$item['task_id'];genesisSharedProjectAccess($project,$actor);
    $db=genesisDb();$q=$db->prepare('SELECT * FROM shared_tasks_history_read WHERE id=? AND project_id=?');$q->execute([$id,$project]);$task=$q->fetch();$q->closeCursor();
    if(!$task)throw new GenesisSharedAccessException();
    if((int)$task['revision']!==(int)$item['expected_revision']||$task['parent_task_id']!==$item['expected_parent_id'])throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT',409);
    $request=['requestId'=>genesisSharedBulkItemRequest($item),'expectedRevision'=>(int)$item['expected_revision']];
    if(in_array($action['kind'],['archive','trash'],true)){
        $q=$db->prepare('WITH RECURSIVE branch(id) AS (SELECT ? UNION SELECT t.id FROM branch b CROSS JOIN shared_tasks_history_read t ON t.parent_task_id=b.id WHERE t.project_id=?) SELECT t.id,t.revision,t.parent_task_id FROM branch b CROSS JOIN shared_tasks_history_read t ON b.id=t.id ORDER BY t.id');$q->execute([$id,$project]);$current=$q->fetchAll();$q->closeCursor();
        $q=$db->prepare('SELECT task_id AS id,expected_revision AS revision,expected_parent_id AS parent_task_id FROM shared_bulk_items WHERE operation_id=? AND root_id=? ORDER BY task_id');$q->execute([$item['operation_id'],$id]);$snapshot=$q->fetchAll();$q->closeCursor();
        if($snapshot!==$current)throw new GenesisSharedAccessException('BULK_TREE_CHANGED',409);
        if($action['kind']==='archive')genesisSharedArchiveTask($actor,$project,$id,$request+['archived'=>true]);
        else genesisSharedTrashTask($actor,$project,$id,$request+['retentionDays'=>$action['retentionDays']]);
        return;
    }
    if($action['kind']==='move'){
        genesisSharedMoveTask($actor,$project,$id,$request+['destinationProjectId'=>$action['projectId'],'statusId'=>$action['statusId'],'position'=>0]);return;
    }
    if($task['archived_at']!==null)throw new GenesisSharedAccessException('BULK_NOT_ALLOWED',409);
    switch($action['kind']){
        case 'priority':$request['priority']=$action['priority'];break;
        case 'assignee':$request['assigneeId']=$action['assigneeId'];break;
        case 'status':
            if(!isset($action['statusIds'][$project]))throw new InvalidArgumentException('BULK_STATUS_REQUIRED');
            $request['statusId']=$action['statusIds'][$project];break;
        case 'labels':
            $old=genesisSharedLabelIds('task',$id);$request['labelIds']=$action['mode']==='add'?array_values(array_unique([...$old,...$action['labelIds']])):array_values(array_diff($old,$action['labelIds']));break;
        case 'due':
            if($action['mode']==='shift'){
                if($task['due_date']===null)throw new InvalidArgumentException('BULK_NO_DUE');
                $date=new DateTimeImmutable($task['due_date'],new DateTimeZone('UTC'));
                $request['dueDate']=genesisSharedTaskDate($date->modify(($action['days']>0?'+':'').$action['days'].' days')->format('Y-m-d'));
            }else $request['dueDate']=$action['mode']==='set'?$action['date']:null;
            break;
    }
    genesisSharedTask($actor,$project,$request,$id);
}

/** Stable per-item UUID, shared with the existing mutation receipt protocol. */
function genesisSharedBulkItemRequest(array $item): string
{
    $hex=hash('sha256',$item['operation_id'].':'.$item['id']);
    return substr($hex,0,8).'-'.substr($hex,8,4).'-4'.substr($hex,13,3).'-8'.substr($hex,17,3).'-'.substr($hex,20,12);
}

/** Called within backgroundPerform's result+ack transaction or an explicit bounded HTTP advance. */
function genesisSharedBulkBatch(array $payload,int $limit=100): string
{
    $id=$payload['operationId']??'';$db=genesisDb();if(!$db->inTransaction())throw new LogicException('Bulk batch requires transaction');
    $q=$db->prepare('SELECT * FROM shared_bulk_operations WHERE id=?');$q->execute([$id]);$operation=$q->fetch();$q->closeCursor();
    if(!$operation||$operation['state']!=='running')return 'cancelled';
    $definition=json_decode(genesisSharedContentDecrypt($operation['payload']),true,32,JSON_THROW_ON_ERROR);$action=$definition['action'];
    // Reopening is parent-first; completion is child-first. Other scalar actions may use child-first as well.
    $order='-depth';$orderValues=[];
    if($action['kind']==='status'){
        $order='CASE project_id';
        foreach($action['statusIds']as$project=>$status){$q=$db->prepare('SELECT is_done FROM shared_project_statuses WHERE id=? AND project_id=?');$q->execute([$status,$project]);$done=(int)$q->fetchColumn()===1;$q->closeCursor();$order.=' WHEN ? THEN '.($done?'-depth':'depth');$orderValues[]=$project;}
        $order.=' ELSE -depth END';
    }
    $q=$db->prepare("SELECT * FROM shared_bulk_items WHERE operation_id=? AND state='pending' AND task_id=root_id ORDER BY ".$order.',id LIMIT '.max(1,min(100,$limit)));$q->execute([$id,...$orderValues]);$items=$q->fetchAll();$q->closeCursor();$deadline=microtime(true)+5;
    foreach($items as$item){
        if(microtime(true)>$deadline)break;
        $db->exec('SAVEPOINT bulk_item');
        try{
            genesisSharedBulkApply($operation['actor_id'],$item,$action);
            $db->exec('RELEASE SAVEPOINT bulk_item');$state='succeeded';$code=null;
        }catch(GenesisSharedAccessException|InvalidArgumentException $error){
            $db->exec('ROLLBACK TO SAVEPOINT bulk_item');$db->exec('RELEASE SAVEPOINT bulk_item');
            $state=$error instanceof GenesisSharedAccessException||in_array($error->getMessage(),['BULK_NO_DUE','BULK_STATUS_REQUIRED'],true)?'skipped':'failed';$code=genesisSharedBulkError($error);
        }
        $db->prepare("UPDATE shared_bulk_items SET state=?,error_code=? WHERE operation_id=? AND root_id=? AND state='pending'")->execute([$state,$code,$id,$item['task_id']]);
    }
    $q=$db->prepare("SELECT COUNT(*) FROM shared_bulk_items WHERE operation_id=? AND state='pending'");$q->execute([$id]);$remaining=(int)$q->fetchColumn();$q->closeCursor();$next=(int)$operation['batch_number']+1;
    $db->prepare('UPDATE shared_bulk_operations SET state=?,batch_number=?,updated_at=? WHERE id=?')->execute([$remaining?'running':'done',$next,genesisNow(),$id]);
    $db->prepare("UPDATE background_jobs SET state='cancelled',updated_at=? WHERE kind='shared-bulk' AND state='pending' AND unique_key LIKE ?")->execute([genesisNow(),'bulk:'.$id.':%']);
    if($remaining)genesisBackgroundEnqueue('shared-bulk','bulk:'.$id.':'.$next,['operationId'=>$id]);
    return 'succeeded';
}
