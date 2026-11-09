<?php
declare(strict_types=1);

/** Saved definitions contain encrypted text/filter values; indexed metadata carries no task content. */
function genesisSharedViewCanEdit(array $row, string $actor): bool
{
    if ($row['visibility'] === 'personal') return $row['owner_id'] === $actor;
    if ($row['visibility'] !== 'shared' || $row['space_id'] === null) return false;
    return in_array(genesisSharedSpaceAccess($row['space_id'], $actor)['member_role'], ['owner','admin'], true);
}

function genesisSharedViewAccess(string $actor, string $id, bool $write = false, bool $deleted = false): array
{
    genesisSharedRequireEnabled($actor);
    $q = genesisDb()->prepare('SELECT * FROM shared_saved_views WHERE id=?'); $q->execute([$id]); $row=$q->fetch(); $q->closeCursor();
    if (!$row || (!$deleted && $row['deleted_at'] !== null) || ($row['visibility']==='personal' && $row['owner_id']!==$actor)) throw new GenesisSharedAccessException();
    if ($row['space_id'] !== null) genesisSharedSpaceAccess($row['space_id'], $actor);
    if ($write && !genesisSharedViewCanEdit($row,$actor)) throw new GenesisSharedAccessException('SHARED_FORBIDDEN',403);
    return $row;
}

function genesisSharedViewDefinition(mixed $value, string $actor, ?string $space): array
{
    if (!is_array($value) || ($value['version'] ?? null)!==1 || !is_string($value['title']??null)
        || ($title=trim($value['title']))==='' || mb_strlen($title)>160 || !is_array($value['filter']??null)
        || (($value['filter']??[]) && array_is_list($value['filter']))) throw new InvalidArgumentException('VIEW_INVALID');
    $filter=$value['filter'];
    if (isset($filter['savedViewId']) || isset($filter['viewDefinition']) || isset($filter['overdueDate']) || isset($filter['overdueTime'])
        || (isset($filter['spaceId']) && $filter['spaceId']!==$space)) throw new InvalidArgumentException('VIEW_INVALID');
    if ($space !== null) $filter['spaceId']=$space; else unset($filter['spaceId']);
    $sort=$value['sort']??null; $relative=$value['relative']??null; $mode=$value['calendarMode']??null;
    if (!is_string($sort)||!in_array($sort,['position','priority','dueDate','title','updatedAt','createdAt','createdAtAsc'],true)&&!str_starts_with($sort,'custom:')
        || !in_array($relative,['none','overdue','this-week','this-month'],true)
        || !in_array($mode,['profane','sacred','lunar'],true)) throw new InvalidArgumentException('VIEW_INVALID');
    // A saved view must keep its explicit calendar semantics, even if a stored payload is damaged.
    $rawContext=$value['calendarContext']??null;
    if (!is_array($rawContext) || ($rawContext['version']??null)!==2 || !is_string($rawContext['timeZone']??null)
        || !in_array($rawContext['gregorianYearStart']??null,['january','march'],true)) throw new InvalidArgumentException('VIEW_INVALID');
    $context=genesisCalendarContext($rawContext,'Europe/Moscow',2);
    if ($context['version']!==2) throw new InvalidArgumentException('VIEW_INVALID');
    if ($relative!=='none' && (isset($filter['dueFrom']) || isset($filter['dueTo']))) throw new InvalidArgumentException('VIEW_INVALID');
    if ($relative==='overdue' && ($filter['completion']??'any')==='completed') throw new InvalidArgumentException('VIEW_INVALID');
    if (isset($filter['dueFrom'],$filter['dueTo']) && $filter['dueFrom']>$filter['dueTo']) throw new InvalidArgumentException('VIEW_INVALID');
    // Validate syntax and explicit object references before committing a definition.
    $scope=genesisSharedQueryScope($actor,$filter); genesisSharedTaskPredicate($actor,$filter,$scope);
    if(str_starts_with($sort,'custom:'))genesisSharedCustomFieldSort($actor,$sort);
    genesisSharedViewReferences($filter,$scope);
    return ['version'=>1,'title'=>$title,'filter'=>$filter,'sort'=>$sort,'relative'=>$relative,'calendarMode'=>$mode,'calendarContext'=>$context];
}

function genesisSharedViewReferences(array $filter, array $scope): void
{
    $projects=array_column($scope,'id'); $spaces=array_values(array_unique(array_column($scope,'space_id')));
    foreach (['statusIds','labelIds','assigneeIds'] as $kind) foreach ($filter[$kind]??[] as $id) {
        if ($kind==='assigneeIds' && in_array($id,['me','unassigned'],true)) continue;
        $ids=$kind==='labelIds'?$spaces:$projects;
        if (!$ids) throw new InvalidArgumentException('VIEW_FILTER_UNAVAILABLE');
        $marks=implode(',',array_fill(0,count($ids),'?'));
        $sql=match($kind) {
            'statusIds'=>"SELECT 1 FROM shared_project_statuses WHERE id=? AND project_id IN ($marks)",
            'labelIds'=>"SELECT 1 FROM shared_space_labels WHERE id=? AND space_id IN ($marks)",
            default=>"SELECT 1 FROM shared_project_members WHERE user_id=? AND project_id IN ($marks)"
        };
        $q=genesisDb()->prepare($sql);$q->execute([$id,...$ids]);$found=$q->fetchColumn();$q->closeCursor();
        if (!$found) throw new InvalidArgumentException('VIEW_FILTER_UNAVAILABLE');
    }
}

/** Relative criteria are resolved on every page using the saved zone; display choices cannot rewrite them. */
function genesisSharedViewResolve(array $definition, ?DateTimeImmutable $instant = null): array
{
    $filter=$definition['filter'];$context=$definition['calendarContext'];
    $now=($instant??new DateTimeImmutable('now'))->setTimezone(new DateTimeZone($context['timeZone']));$today=$now->format('Y-m-d');
    switch($definition['relative']) {
        case 'overdue': $filter['overdueDate']=$today;$filter['overdueTime']=$now->format('H:i');$filter['completion']='open';break;
        case 'this-week':
            // Existing weekday schedules/week summaries use the civil Monday–Sunday week in all display calendars.
            $start=genesisCalendarAddDays($today,1-(int)$now->format('N'));$filter['dueFrom']=$start;$filter['dueTo']=genesisCalendarAddDays($start,6);break;
        case 'this-month':
            $period=genesisCalendarPeriod($today,$definition['calendarMode'],'month',$context);
            $filter['dueFrom']=$period['start'];$filter['dueTo']=genesisCalendarAddDays($period['end'],-1);break;
    }
    return $filter;
}

function genesisSharedViewRead(array $row, string $actor): array
{
    $result=['id'=>$row['id'],'spaceId'=>$row['space_id'],'visibility'=>$row['visibility'],'revision'=>(int)$row['revision'],
        'canEdit'=>genesisSharedViewCanEdit($row,$actor),'updatedAt'=>$row['updated_at']];
    try {
        $definition=json_decode(genesisSharedContentDecrypt($row['payload']),true,32,JSON_THROW_ON_ERROR);
        if (!is_array($definition) || ($definition['version']??null)!==1) throw new InvalidArgumentException('VIEW_INVALID');
        try { $definition=genesisSharedViewDefinition($definition,$actor,$row['space_id']); }
        catch(Throwable) { return $result+['definition'=>$definition,'invalid'=>true]; }
        return $result+['definition'=>$definition,'invalid'=>false];
    } catch (Throwable) { return $result+['definition'=>null,'invalid'=>true]; }
}

function genesisSharedViews(string $actor, ?string $space, ?string $cursor=null, int $limit=100): array
{
    genesisSharedRequireEnabled($actor);if($space!==null)genesisSharedSpaceAccess($space,$actor);
    if($limit<1 || $limit>100)throw new InvalidArgumentException('VIEW_PAGE_INVALID');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try {
    $sql="SELECT v.* FROM shared_saved_views v LEFT JOIN shared_space_members sm ON sm.space_id=v.space_id AND sm.user_id=?
        WHERE v.deleted_at IS NULL AND ((v.owner_id=? AND v.visibility='personal') OR (v.visibility='shared' AND sm.user_id IS NOT NULL))
        AND (v.space_id IS NULL OR sm.user_id IS NOT NULL)";$values=[$actor,$actor];
    if($space!==null){$sql.=' AND (v.space_id=? OR v.space_id IS NULL)';$values[]=$space;}
    // Only authorized indexed metadata enters this fingerprint, never definitions or task content.
    $q=$db->prepare('SELECT v.id,v.revision'.substr($sql,strpos($sql,' FROM')).' ORDER BY v.id');$q->execute($values);$metadata=$q->fetchAll();$q->closeCursor();
    $signature=hash('sha256',json_encode([$actor,$space,$metadata],JSON_THROW_ON_ERROR));$total=count($metadata);
    if($cursor!==null && $cursor!=='') {
        $state=strlen($cursor)<16000?json_decode(genesisDecrypt($cursor)??'',true):null;
        if(!is_array($state) || !isset($state['signature'],$state['updatedAt'],$state['id']))throw new InvalidArgumentException('VIEW_PAGE_INVALID');
        if(!hash_equals($signature,(string)$state['signature']))throw new GenesisSharedAccessException('VIEW_LIST_CHANGED',409);
        $sql.=' AND (v.updated_at < ? OR (v.updated_at = ? AND v.id > ?))';array_push($values,$state['updatedAt'],$state['updatedAt'],$state['id']);
    }
    $q=$db->prepare($sql.' ORDER BY v.updated_at DESC,v.id LIMIT '.($limit+1));$q->execute($values);$rows=$q->fetchAll();$q->closeCursor();
    $hasMore=count($rows)>$limit;if($hasMore)array_pop($rows);$last=$rows?end($rows):null;
    $nextCursor=$hasMore?genesisEncrypt(json_encode(['signature'=>$signature,'updatedAt'=>$last['updated_at'],'id'=>$last['id']],JSON_THROW_ON_ERROR)):null;
    $views=array_map(static fn($row)=>genesisSharedViewRead($row,$actor),$rows);
    if($owns)$db->commit();return compact('views','total','hasMore','nextCursor');
    }catch(Throwable $e){if($owns&&$db->inTransaction())$db->rollBack();throw $e;}
}

function genesisSharedViewSave(string $actor, array $input, ?string $id=null): array
{
    genesisSharedRequireEnabled($actor);$db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $old=$id?genesisSharedViewAccess($actor,$id,true,true):null;
        $space=$input['spaceId']??$old['space_id']??null;$visibility=$input['visibility']??$old['visibility']??'personal';
        if(($space!==null&&!is_string($space)) || !in_array($visibility,['personal','shared'],true))throw new InvalidArgumentException('VIEW_INVALID');
        $membership=$space!==null?genesisSharedSpaceAccess($space,$actor):null;
        if($visibility==='shared' && (!$membership || !in_array($membership['member_role'],['owner','admin'],true)))throw new GenesisSharedAccessException('SHARED_FORBIDDEN',403);
        if($old && ($old['space_id']!==$space || $old['visibility']!==$visibility))throw new InvalidArgumentException('VIEW_SCOPE_IMMUTABLE');
        $request=genesisSharedRequestId($input);if(!$request)throw new InvalidArgumentException('VIEW_REQUEST_REQUIRED');
        $resource=$id??($visibility.':'.($space??$actor));$action=$id?'view.update':'view.create';
        $payloadHash=genesisSharedMutationPayloadHash($action,$input);
        $receipt=genesisSharedMutationReceipt($db,$actor,$request,$action,$resource, $payloadHash);if($receipt!==null){$db->commit();return $receipt;}
        if($old && ($old['deleted_at']!==null || ($input['expectedRevision']??null)!==(int)$old['revision']))throw new GenesisSharedAccessException('VIEW_CONFLICT',409);
        $definition=genesisSharedViewDefinition($input['definition']??null,$actor,$space);$now=genesisNow();
        if(!$old) {
            $q=$db->prepare($visibility==='shared' ? "SELECT COUNT(*) FROM shared_saved_views WHERE space_id=? AND visibility='shared' AND deleted_at IS NULL"
                : "SELECT COUNT(*) FROM shared_saved_views WHERE owner_id=? AND visibility='personal' AND deleted_at IS NULL");
            $q->execute([$visibility==='shared'?$space:$actor]);$count=(int)$q->fetchColumn();$q->closeCursor();
            if($count>=100)throw new InvalidArgumentException('VIEW_LIMIT');
        }
        $id??=genesisUuid();$payload=genesisSharedContentEncrypt(json_encode($definition,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
        if($old)$db->prepare('UPDATE shared_saved_views SET payload=?,revision=revision+1,updated_at=? WHERE id=?')->execute([$payload,$now,$id]);
        else $db->prepare('INSERT INTO shared_saved_views(id,owner_id,space_id,visibility,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([$id,$actor,$space,$visibility,$payload,$now,$now]);
        $result=genesisSharedViewRead(genesisSharedViewAccess($actor,$id),$actor);
        genesisSharedSaveMutationReceipt($db,$actor,$request,$action,$resource,$result, $payloadHash);$db->commit();return $result;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

function genesisSharedViewDelete(string $actor, string $id, array $input): array
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $row=genesisSharedViewAccess($actor,$id,true,true);$request=genesisSharedRequestId($input);if(!$request)throw new InvalidArgumentException('VIEW_REQUEST_REQUIRED');
        $payloadHash=genesisSharedMutationPayloadHash('view.delete',$input);
        $receipt=genesisSharedMutationReceipt($db,$actor,$request,'view.delete',$id, $payloadHash);if($receipt!==null){$db->commit();return $receipt;}
        if($row['deleted_at']!==null || ($input['expectedRevision']??null)!==(int)$row['revision'])throw new GenesisSharedAccessException('VIEW_CONFLICT',409);
        $db->prepare('UPDATE shared_saved_views SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?')->execute([genesisNow(),genesisNow(),$id]);
        $result=['ok'=>true];genesisSharedSaveMutationReceipt($db,$actor,$request,'view.delete',$id,$result, $payloadHash);$db->commit();return $result;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** Both saved and unsaved definitions reuse the complete ACL/cursor task query. No client-side subset. */
function genesisSharedViewQuery(string $actor, array $filter, string $sort): array
{
    if(!array_key_exists('savedViewId',$filter) && !array_key_exists('viewDefinition',$filter))return [$filter,$sort,null];
    if(count($filter)!==1)throw new InvalidArgumentException('VIEW_INVALID');
    if(array_key_exists('savedViewId',$filter)) {
        if(!is_string($filter['savedViewId']) || $filter['savedViewId']==='')throw new InvalidArgumentException('VIEW_INVALID');
        $row=genesisSharedViewAccess($actor,$filter['savedViewId']);$view=genesisSharedViewRead($row,$actor);
        if($view['invalid'])throw new InvalidArgumentException('VIEW_FILTER_UNAVAILABLE');
        $definition=$view['definition'];$signature=[$row['id'],(int)$row['revision']];
    }else {
        $value=$filter['viewDefinition'];$space=is_array($value)?($value['filter']['spaceId']??null):null;
        if($space!==null&&!is_string($space))throw new InvalidArgumentException('VIEW_INVALID');
        $definition=genesisSharedViewDefinition($value,$actor,$space);$signature=null;
    }
    return [genesisSharedViewResolve($definition),$definition['sort'],$signature];
}

/** Picker pages only contain authorized metadata; they never load task payloads. */
function genesisSharedViewOptions(string $actor, string $kind, array $filter=[], ?string $cursor=null): array
{
    genesisSharedRequireEnabled($actor);
    if(array_diff(array_keys($filter),['spaceId','projectIds']) || !in_array($kind,['projects','statuses','assignees','labels'],true))throw new InvalidArgumentException('VIEW_INVALID');
    $scope=genesisSharedQueryScope($actor,$filter);$projects=array_column($scope,'id');$spaces=array_values(array_unique(array_column($scope,'space_id')));
    $ids=$kind==='labels'?$spaces:$projects;
    if(!$ids)return ['options'=>[],'hasMore'=>false,'nextCursor'=>null];
    $marks=implode(',',array_fill(0,count($ids),'?'));
    $sql=match($kind) {
        'projects'=>"SELECT p.id,s.title || ' · ' || p.title AS title FROM shared_projects p JOIN shared_spaces s ON s.id=p.space_id WHERE p.id IN ($marks)",
        'statuses'=>"SELECT s.id,p.title || ' · ' || s.title AS title FROM shared_project_statuses s JOIN shared_projects p ON p.id=s.project_id WHERE s.project_id IN ($marks) AND s.is_chaos=0",
        'labels'=>"SELECT l.id,s.title || ' · ' || l.title AS title FROM shared_space_labels l JOIN shared_spaces s ON s.id=l.space_id WHERE l.space_id IN ($marks)",
        default=>"SELECT DISTINCT u.id,COALESCE(NULLIF(u.display_name,''),'—') AS title FROM users u JOIN shared_project_members m ON m.user_id=u.id WHERE m.project_id IN ($marks)"
    };
    $sql='SELECT * FROM ('.$sql.') options WHERE 1=1';
    $signature=hash('sha256',json_encode([$actor,$kind,$filter,$scope],JSON_THROW_ON_ERROR));$values=$ids;
    if($cursor!==null && $cursor!=='') {
        $state=strlen($cursor)<16000?json_decode(genesisDecrypt($cursor)??'',true):null;
        if(!is_array($state)||!isset($state['signature'],$state['id']))throw new InvalidArgumentException('VIEW_PAGE_INVALID');
        if(!hash_equals($signature,(string)$state['signature']))throw new GenesisSharedAccessException('VIEW_LIST_CHANGED',409);
        $sql.=' AND id > ?';$values[]=$state['id'];
    }
    $q=genesisDb()->prepare($sql.' ORDER BY id LIMIT 101');$q->execute($values);$options=$q->fetchAll();$q->closeCursor();
    $hasMore=count($options)>100;if($hasMore)array_pop($options);$last=$options?end($options):null;
    $nextCursor=$hasMore?genesisEncrypt(json_encode(['signature'=>$signature,'id'=>$last['id']],JSON_THROW_ON_ERROR)):null;
    return compact('options','hasMore','nextCursor');
}
