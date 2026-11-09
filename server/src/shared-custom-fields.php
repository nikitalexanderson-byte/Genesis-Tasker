<?php
declare(strict_types=1);

function genesisSharedCustomFieldRecord(array $row):array
{
    $definition=json_decode(genesisSharedContentDecrypt($row['definition_json']),true,64,JSON_THROW_ON_ERROR);
    return ['id'=>$row['id'],'spaceId'=>$row['space_id'],'projectId'=>$row['project_id'],'type'=>$row['type'],
        'title'=>$definition['title'],'options'=>$definition['options'],'position'=>(int)$row['position'],
        'required'=>(bool)$row['required'],'showCard'=>(bool)$row['show_card'],'showList'=>(bool)$row['show_list'],
        'archived'=>$row['archived_at']!==null,'predecessorId'=>$row['predecessor_id'],'revision'=>(int)$row['revision']];
}

function genesisSharedCustomFieldManage(string $actor,string $spaceId):void
{
    genesisSharedRequireEnabled($actor);$space=genesisSharedSpaceAccess($spaceId,$actor);
    if(!in_array($space['member_role'],['owner','admin'],true))throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN',403);
}

/** Reading a definition does not grant access to any task or its values. */
function genesisSharedCustomFields(string $actor,string $spaceId,?string $projectId=null,bool $archived=false):array
{
    genesisSharedRequireEnabled($actor);genesisSharedSpaceAccess($spaceId,$actor);
    if($projectId!==null&&genesisSharedProjectAccess($projectId,$actor,'read',true)['space_id']!==$spaceId)throw new GenesisSharedAccessException();
    $sql='SELECT f.* FROM shared_custom_fields f WHERE f.space_id=?';$values=[$spaceId];
    if($projectId!==null){$sql.=' AND (f.project_id IS NULL OR f.project_id=?)';$values[]=$projectId;}
    else{$sql.=' AND (f.project_id IS NULL OR f.project_id IN (SELECT p.id FROM shared_projects p JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? WHERE NOT EXISTS(SELECT 1 FROM shared_trash t WHERE t.kind=\'project\' AND t.object_id=p.id)))';$values[]=$actor;}
    if(!$archived)$sql.=' AND f.archived_at IS NULL';
    $q=genesisDb()->prepare($sql.' ORDER BY f.position,f.id');$q->execute($values);
    return array_map('genesisSharedCustomFieldRecord',$q->fetchAll());
}

function genesisSharedCustomFieldInput(string $spaceId,array $input,?array $old):array
{
    $known=['id','title','type','projectId','options','position','required','showCard','showList','archived','expectedRevision','fingerprint','operationId','replaceType'];
    if(array_diff(array_keys($input),$known)||!is_string($input['id']??null)||!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$input['id'])
        ||!in_array($input['type']??null,['text','number','date','select','multi','checkbox','url'],true))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    foreach(['required','showCard','showList','archived'] as $key)if(!is_bool($input[$key]??null))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    if(!is_int($input['position']??null)||abs($input['position'])>100000)throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    $project=$input['projectId']??null;
    if($project!==null&&!is_string($project))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    if($project!==null){$q=genesisDb()->prepare('SELECT 1 FROM shared_projects WHERE id=? AND space_id=?');$q->execute([$project,$spaceId]);if(!$q->fetchColumn())throw new GenesisSharedAccessException();}
    $options=$input['options']??null;
    // Old normalization could retain archived IDs beyond 200. Preserve that history without allowing further growth.
    // Only the existing transactional import scope may temporarily unarchive historical choices while restoring values.
    $historicalRestore=class_exists(GenesisDataHistoricalScope::class,false)&&GenesisDataHistoricalScope::active();
    $optionLimit=$historicalRestore?10000:($old&&$old['type']===$input['type']?max(200,count($old['options'])):200);
    if(!is_array($options)||!array_is_list($options))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    if(count($options)>$optionLimit)throw new InvalidArgumentException('CUSTOM_FIELD_OPTIONS_LIMIT');
    if(!in_array($input['type'],['select','multi'],true)&&$options)throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    $normalized=[];
    foreach($options as $option){
        if(!is_array($option)||!is_bool($option['archived']??null)||!is_string($option['id']??null)
            ||!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$option['id'])||isset($normalized[$option['id']])||array_diff(array_keys($option),['id','title','archived']))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
        $normalized[$option['id']]=['id'=>$option['id'],'title'=>genesisSharedTitle($option['title']??null,160),'archived'=>$option['archived']];
    }
    if(!$historicalRestore&&count(array_filter($normalized,static fn($option)=>!$option['archived']))>200)throw new InvalidArgumentException('CUSTOM_FIELD_OPTIONS_LIMIT');
    if($old&&$old['type']===$input['type'])foreach($old['options'] as $option){
        if(!isset($normalized[$option['id']]))$normalized[$option['id']]=[...$option,'archived'=>true];
    }
    if(count($normalized)>$optionLimit)throw new InvalidArgumentException('CUSTOM_FIELD_OPTIONS_LIMIT');
    return ['id'=>$input['id'],'spaceId'=>$spaceId,'projectId'=>$project,'title'=>genesisSharedTitle($input['title']??null,160),
        'type'=>$input['type'],'options'=>array_values($normalized),'position'=>$input['position'],'required'=>$input['required'],
        'showCard'=>$input['showCard'],'showList'=>$input['showList'],'archived'=>$input['archived']];
}

function genesisSharedPreviewCustomField(string $actor,string $spaceId,array $input):array
{
    genesisSharedCustomFieldManage($actor,$spaceId);$db=genesisDb();
    $q=$db->prepare('SELECT * FROM shared_custom_fields WHERE id=?');$q->execute([$input['id']??'']);$row=$q->fetch();
    if($row&&$row['space_id']!==$spaceId)throw new GenesisSharedAccessException();
    $old=$row?genesisSharedCustomFieldRecord($row):null;$next=genesisSharedCustomFieldInput($spaceId,$input,$old);
    $q=$db->prepare('SELECT t.id,t.project_id,t.revision FROM shared_tasks t JOIN shared_custom_field_values v ON v.task_id=t.id WHERE v.field_id=? ORDER BY t.id');
    $q->execute([$next['id']]);$tasks=$q->fetchAll();
    if($tasks&&$next['projectId']!==null&&array_filter($tasks,static fn($task)=>$task['project_id']!==$next['projectId']))throw new GenesisSharedAccessException('CUSTOM_FIELD_SCOPE_HAS_VALUES',409);
    $replace=$old&&$old['type']!==$next['type']&&count($tasks)>0;
    if($old&&(int)($input['expectedRevision']??-1)!==$old['revision']||!$old&&($input['expectedRevision']??0)!==0)throw new GenesisSharedAccessException('CUSTOM_FIELD_CONFLICT',409);
    $fingerprint=hash('sha256',json_encode([$old,$next,$tasks],JSON_THROW_ON_ERROR));
    return ['field'=>$next,'fingerprint'=>$fingerprint,'valueCount'=>count($tasks),'replaceType'=>(bool)$replace,
        'previousRevision'=>$old['revision']??0,'preservesPreviousValues'=>true];
}

/** A type transition creates a successor and archives the original, preserving every old value and definition. */
function genesisSharedSaveCustomField(string $actor,string $spaceId,array $input):array
{
    genesisSharedCustomFieldManage($actor,$spaceId);$operation=$input['operationId']??null;
    if(!is_string($operation)||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$operation))throw new InvalidArgumentException('CUSTOM_FIELD_INVALID');
    $hash=hash('sha256',json_encode($input,JSON_THROW_ON_ERROR));$db=genesisDb();$ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try{
        genesisSharedCustomFieldManage($actor,$spaceId);
        $q=$db->prepare('SELECT * FROM shared_custom_field_receipts WHERE actor_id=? AND operation_id=?');$q->execute([$actor,$operation]);$receipt=$q->fetch();
        if($receipt){
            if($receipt['space_id']!==$spaceId||!hash_equals($receipt['payload_hash'],$hash))throw new GenesisSharedAccessException('CUSTOM_FIELD_OPERATION_REUSED',409);
            if($ownsTransaction)$db->commit();return json_decode(genesisSharedContentDecrypt($receipt['receipt_json']),true,64,JSON_THROW_ON_ERROR);
        }
        $preview=genesisSharedPreviewCustomField($actor,$spaceId,$input);
        if(!is_string($input['fingerprint']??null)||!hash_equals($preview['fingerprint'],$input['fingerprint']))throw new GenesisSharedAccessException('CUSTOM_FIELD_CONFLICT',409);
        if($preview['replaceType']&&($input['replaceType']??false)!==true)throw new GenesisSharedAccessException('CUSTOM_FIELD_TYPE_TRANSITION_REQUIRED',409);
        $field=$preview['field'];$previous=null;$revision=$preview['previousRevision'];$now=genesisNow();
        genesisWorkflowCustomFieldEdit($field['id'],$field['projectId'],$field['archived']||$preview['replaceType']);
        $count=$db->prepare('SELECT COUNT(*) FROM shared_custom_fields WHERE space_id=? AND archived_at IS NULL AND id<>?');$count->execute([$spaceId,$field['id']]);
        if(!$field['archived']&&(int)$count->fetchColumn()>=200)throw new GenesisResourceLimitException(409,'CUSTOM_FIELD_LIMIT');
        if($preview['replaceType']){
            $previous=$field['id'];$db->prepare('UPDATE shared_custom_fields SET archived_at=?,revision=revision+1,updated_at=? WHERE id=?')->execute([$now,$now,$previous]);
            genesisSharedCustomFieldVersion($previous,$actor);$field['id']=genesisUuid();$revision=0;
        }
        $definition=genesisSharedContentEncrypt(json_encode(['title'=>$field['title'],'options'=>$field['options']],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
        if($revision){
            $db->prepare('UPDATE shared_custom_fields SET project_id=?,type=?,definition_json=?,position=?,required=?,show_card=?,show_list=?,archived_at=?,revision=revision+1,updated_at=? WHERE id=?')
                ->execute([$field['projectId'],$field['type'],$definition,$field['position'],(int)$field['required'],(int)$field['showCard'],(int)$field['showList'],$field['archived']?$now:null,$now,$field['id']]);
        }else{
            $db->prepare('INSERT INTO shared_custom_fields(id,space_id,project_id,type,definition_json,position,required,show_card,show_list,archived_at,predecessor_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$field['id'],$spaceId,$field['projectId'],$field['type'],$definition,$field['position'],(int)$field['required'],(int)$field['showCard'],(int)$field['showList'],$field['archived']?$now:null,$previous,$actor,$now,$now]);
        }
        genesisSharedCustomFieldVersion($field['id'],$actor);
        // Definition and visibility changes invalidate paging even when no task row changed.
        $db->prepare('UPDATE shared_task_query_versions SET version=version+1 WHERE project_id IN (SELECT id FROM shared_projects WHERE space_id=?)')->execute([$spaceId]);
        $q=$db->prepare('SELECT * FROM shared_custom_fields WHERE id=?');$q->execute([$field['id']]);$result=['field'=>genesisSharedCustomFieldRecord($q->fetch()),'previousFieldId'=>$previous];
        $db->prepare('INSERT INTO shared_custom_field_receipts VALUES(?,?,?,?,?)')->execute([$actor,$operation,$spaceId,$hash,genesisSharedContentEncrypt(json_encode($result,JSON_THROW_ON_ERROR))]);
        if($ownsTransaction)$db->commit();return $result;
    }catch(Throwable $error){if($ownsTransaction&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSharedCustomFieldVersion(string $id,string $actor):void
{
    $q=genesisDb()->prepare('SELECT * FROM shared_custom_fields WHERE id=?');$q->execute([$id]);$field=genesisSharedCustomFieldRecord($q->fetch());
    genesisDb()->prepare('INSERT INTO shared_custom_field_versions VALUES(?,?,?,?,?)')->execute([$id,$field['revision'],genesisSharedContentEncrypt(json_encode($field,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)),$actor,genesisNow()]);
}

function genesisSharedCustomValue(array $field,mixed $value,mixed $previous=null):mixed
{
    if($value===null||$value===''||$value===[])return null;
    switch($field['type']){
        case 'text':case 'url':
            if(!is_string($value)||mb_strlen($value)>5000)throw new InvalidArgumentException('CUSTOM_FIELD_VALUE_INVALID');
            if(trim($value)==='')return null;
            if($field['type']==='url'&&(!filter_var($value,FILTER_VALIDATE_URL)||!in_array(strtolower((string)parse_url($value,PHP_URL_SCHEME)),['https','http'],true)))throw new InvalidArgumentException('CUSTOM_FIELD_URL_INVALID');
            break;
        case 'number':if((!is_int($value)&&!is_float($value))||!is_finite((float)$value)||abs($value)>1e15)throw new InvalidArgumentException('CUSTOM_FIELD_VALUE_INVALID');break;
        case 'date':$value=genesisSharedTaskDate($value);break;
        case 'checkbox':if(!is_bool($value))throw new InvalidArgumentException('CUSTOM_FIELD_VALUE_INVALID');break;
        case 'select':case 'multi':
            if($field['type']==='select'&&!is_string($value)||$field['type']==='multi'&&(!is_array($value)||!array_is_list($value)||count($value)>200))throw new InvalidArgumentException('CUSTOM_FIELD_VALUE_INVALID');
            $ids=$field['type']==='select'?[$value]:$value;$options=array_column($field['options'],null,'id');
            foreach($ids as $id)if(!is_string($id)||!isset($options[$id])||$options[$id]['archived']&&!in_array($id,is_array($previous)?$previous:[$previous],true))throw new InvalidArgumentException('CUSTOM_FIELD_OPTION_UNAVAILABLE');
            if($field['type']==='multi'){$value=array_values(array_unique($value));sort($value);}
            break;
    }
    return $value;
}

function genesisSharedCustomTaskValues(string $taskId):array
{
    $q=genesisDb()->prepare('SELECT field_id,value_json FROM shared_custom_field_values WHERE task_id=?');$q->execute([$taskId]);$values=[];
    foreach($q->fetchAll() as $row)$values[$row['field_id']]=json_decode(genesisSharedContentDecrypt($row['value_json']),true,32,JSON_THROW_ON_ERROR);
    return $values;
}

/** Patch semantics preserve values unknown to older clients; null explicitly clears, 0 and false are real values. */
function genesisSharedCustomTaskInput(string $actor,array $project,string $taskId,array $input,bool $creating,bool $completing=false):array
{
    $old=genesisSharedCustomTaskValues($taskId);$values=$old;$fields=genesisSharedCustomFields($actor,$project['space_id'],$project['id'],true);$byId=array_column($fields,null,'id');
    if(array_key_exists('customFields',$input)){
        $patch=$input['customFields'];
        if(!is_array($patch)||$patch&&array_is_list($patch)||count($patch)>200)throw new InvalidArgumentException('CUSTOM_FIELD_VALUE_INVALID');
        foreach($patch as $id=>$raw){
            $field=$byId[$id]??null;if(!$field||$field['archived']&&($old[$id]??null)!==$raw)throw new GenesisSharedAccessException('CUSTOM_FIELD_UNAVAILABLE',409);
            $value=genesisSharedCustomValue($field,$raw,$old[$id]??null);if($value===null)unset($values[$id]);else $values[$id]=$value;
        }
    }
    if($creating||$completing||array_key_exists('customFields',$input))foreach($fields as $field){
        if(!$field['archived']&&$field['required']&&!array_key_exists($field['id'],$values))throw new GenesisSharedAccessException('CUSTOM_FIELD_REQUIRED',409);
    }
    return ['old'=>$old,'values'=>$values];
}

function genesisSharedSaveCustomTaskValues(string $taskId,array $values):void
{
    $db=genesisDb();$db->prepare('DELETE FROM shared_custom_field_values WHERE task_id=?')->execute([$taskId]);
    foreach($values as $id=>$value)$db->prepare('INSERT INTO shared_custom_field_values VALUES(?,?,?)')->execute([$taskId,$id,genesisSharedContentEncrypt(json_encode($value,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR))]);
}

function genesisSharedCustomFieldAccess(string $actor,string $id):array
{
    $q=genesisDb()->prepare('SELECT * FROM shared_custom_fields WHERE id=?');$q->execute([$id]);$row=$q->fetch();
    if(!$row)throw new GenesisSharedAccessException();
    genesisSharedRequireEnabled($actor);genesisSharedSpaceAccess($row['space_id'],$actor);
    if($row['project_id']!==null)genesisSharedProjectAccess($row['project_id'],$actor,'read',true);
    return genesisSharedCustomFieldRecord($row);
}

function genesisSharedCustomFieldHistory(string $actor,string $id):array
{
    genesisSharedCustomFieldAccess($actor,$id);
    $q=genesisDb()->prepare('SELECT definition_json,created_at FROM shared_custom_field_versions WHERE field_id=? ORDER BY revision DESC');$q->execute([$id]);
    return array_map(static fn($row)=>['field'=>json_decode(genesisSharedContentDecrypt($row['definition_json']),true,64,JSON_THROW_ON_ERROR),'createdAt'=>$row['created_at']],$q->fetchAll());
}

/** The same typed predicate is shared by saved views, reports, templates and automation conditions. */
function genesisSharedCustomFieldPredicates(string $actor,mixed $filters):array
{
    if(!is_array($filters)||!array_is_list($filters)||count($filters)>20)throw new InvalidArgumentException('CUSTOM_FIELD_FILTER_INVALID');
    $clauses=[];$values=[];
    foreach($filters as $filter){
        if(!is_array($filter)||array_diff(array_keys($filter),['fieldId','op','value'])||!is_string($filter['fieldId']??null))throw new InvalidArgumentException('CUSTOM_FIELD_FILTER_INVALID');
        $field=genesisSharedCustomFieldAccess($actor,$filter['fieldId']);$op=$filter['op']??'';
        $clauses[]='t.project_id IN (SELECT id FROM shared_projects WHERE space_id=?'.($field['projectId']!==null?' AND id=?':'').')';
        $values[]=$field['spaceId'];if($field['projectId']!==null)$values[]=$field['projectId'];
        $base='SELECT 1 FROM shared_custom_field_values cv JOIN shared_custom_fields cf ON cf.id=cv.field_id WHERE cv.task_id=t.id AND cv.field_id=? AND cf.space_id=(SELECT space_id FROM shared_projects WHERE id=t.project_id) AND (cf.project_id IS NULL OR cf.project_id=t.project_id)';
        if(in_array($op,['missing','exists'],true)){
            $clauses[]=($op==='missing'?'NOT ':'').'EXISTS('.$base.')';$values[]=$field['id'];continue;
        }
        $value=genesisSharedCustomValue($field,$filter['value']??null,$filter['value']??null);
        if($value===null||!in_array($op,['eq','ne','contains','gt','gte','lt','lte'],true))throw new InvalidArgumentException('CUSTOM_FIELD_FILTER_INVALID');
        $expr="json_extract(genesis_content_decrypt(cv.value_json),'$')";
        if($op==='contains'&&$field['type']==='multi'){
            $predicate='NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE wanted.value NOT IN (SELECT value FROM json_each(genesis_content_decrypt(cv.value_json))))';$param=json_encode($value,JSON_THROW_ON_ERROR);
        }elseif($op==='contains'&&in_array($field['type'],['text','url'],true)){$predicate="instr(genesis_fold($expr),genesis_fold(?))>0";$param=$value;}
        elseif(in_array($op,['gt','gte','lt','lte'],true)){
            if(!in_array($field['type'],['number','date'],true))throw new InvalidArgumentException('CUSTOM_FIELD_FILTER_INVALID');
            $predicate=$expr.match($op){'gt'=>'>','gte'=>'>=','lt'=>'<',default=>'<='}.'CAST(? AS '.($field['type']==='number'?'REAL':'TEXT').')';$param=$value;
        }elseif(in_array($op,['eq','ne'],true)){
            // Compare canonical JSON to keep number zero, boolean false and text distinct.
            $predicate='genesis_content_decrypt(cv.value_json)=?';$param=json_encode($value,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        }else throw new InvalidArgumentException('CUSTOM_FIELD_FILTER_INVALID');
        if($op==='ne'){$clauses[]='EXISTS('.$base.')';$values[]=$field['id'];}
        $clauses[]=($op==='ne'?'NOT ':'').'EXISTS('.$base.' AND '.$predicate.')';array_push($values,$field['id'],$param);
    }
    return [$clauses,$values];
}

function genesisSharedCustomFieldSort(string $actor,string $sort):array
{
    if(!preg_match('/^custom:([a-zA-Z0-9_-]{1,100}):(asc|desc)$/D',$sort,$parts))throw new InvalidArgumentException('INVALID_TASK_FILTER');
    $field=genesisSharedCustomFieldAccess($actor,$parts[1]);
    if($field['type']==='multi')throw new InvalidArgumentException('CUSTOM_FIELD_SORT_INVALID');
    // ID is validated above and SQL-quoted. Values never enter SQL source.
    $id=genesisDb()->quote($field['id']);
    $expr="json_extract(genesis_content_decrypt(cv.value_json),'$')";
    if($field['type']==='select')$expr="(SELECT json_extract(choice.value,'$.title') FROM json_each(json_extract(genesis_content_decrypt(cf.definition_json),'$.options')) choice WHERE json_extract(choice.value,'$.id')=$expr)";
    if(in_array($field['type'],['text','url','select'],true))$expr='genesis_fold('.$expr.')';
    $column="(SELECT $expr FROM shared_custom_field_values cv JOIN shared_custom_fields cf ON cf.id=cv.field_id WHERE cv.task_id=t.id AND cv.field_id=$id AND (cf.project_id IS NULL OR cf.project_id=t.project_id))";
    return [$column,strtoupper($parts[2]),in_array($field['type'],['number','checkbox'],true)?'REAL':'TEXT'];
}

function genesisSharedCustomFieldSearchSql():string
{
    return "EXISTS(SELECT 1 FROM shared_custom_field_values cv JOIN shared_custom_fields cf ON cf.id=cv.field_id JOIN shared_projects cp ON cp.id=t.project_id
        WHERE cv.task_id=t.id AND cf.space_id=cp.space_id AND (cf.project_id IS NULL OR cf.project_id=t.project_id)
        AND (cf.type NOT IN ('select','multi') AND instr(genesis_fold(CAST(json_extract(genesis_content_decrypt(cv.value_json),'$') AS TEXT)),genesis_fold(?))>0
        OR cf.type IN ('select','multi') AND EXISTS(SELECT 1 FROM json_each(json_extract(genesis_content_decrypt(cf.definition_json),'$.options')) choice
            WHERE instr(genesis_fold(json_extract(choice.value,'$.title')),genesis_fold(?))>0
            AND (cf.type='select' AND json_extract(choice.value,'$.id')=json_extract(genesis_content_decrypt(cv.value_json),'$')
            OR cf.type='multi' AND json_extract(choice.value,'$.id') IN (SELECT value FROM json_each(genesis_content_decrypt(cv.value_json)))))))";
}

function genesisSharedCustomFieldsRequireMove(array $tasks,string $destinationId):void
{
    $q=genesisDb()->prepare('SELECT 1 FROM shared_custom_field_values v JOIN shared_custom_fields f ON f.id=v.field_id JOIN shared_projects p ON p.id=? WHERE v.task_id=? AND (f.space_id<>p.space_id OR f.project_id IS NOT NULL AND f.project_id<>p.id) LIMIT 1');
    foreach($tasks as $task){$q->execute([$destinationId,$task['id']]);if($q->fetchColumn())throw new GenesisSharedAccessException('CUSTOM_FIELD_MOVE_REQUIRES_MAPPING',409);}
}
