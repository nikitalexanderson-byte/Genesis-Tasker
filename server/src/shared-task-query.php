<?php
declare(strict_types=1);

function genesisSharedReadTaskFilter(mixed $value): array
{
    if ($value === null || $value === '') return [];
    if (!is_string($value) || strlen($value)>8000) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    try { $filter=json_decode($value,true,16,JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw new InvalidArgumentException('INVALID_TASK_FILTER'); }
    if (!is_array($filter) || ($filter && array_is_list($filter))) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    return $filter;
}

function genesisSharedQueryIds(mixed $value): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > 100
        || array_filter($value, static fn($id) => !is_string($id) || $id === '' || strlen($id) > 100)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    return array_values(array_unique($value));
}

/** Only accessible projects enter the cursor fingerprint; permissions are rechecked on every page. */
function genesisSharedQueryScope(string $userId, array $filter): array
{
    $sql = 'SELECT p.id,p.revision,p.space_id,m.role,sm.role AS spaceRole,sm.permissions_json,sm.can_organize_tasks,sm.project_access_restricted,
        COALESCE(v.version,0) AS version FROM shared_projects p
        JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=?
        JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id
        LEFT JOIN shared_task_query_versions v ON v.project_id=p.id
        WHERE p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind=\'project\' AND tr.object_id=p.id)';
    $values = [$userId];
    if (isset($filter['spaceId'])) { genesisSharedSpaceAccess((string)$filter['spaceId'], $userId); $sql .= ' AND p.space_id=?'; $values[] = $filter['spaceId']; }
    if (isset($filter['projectIds'])) {
        $ids = genesisSharedQueryIds($filter['projectIds']);
        if (!$ids) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        // Explicit inaccessible IDs fail, rather than quietly changing a saved filter's meaning.
        foreach ($ids as $id) genesisSharedProjectAccess($id, $userId);
        $sql .= ' AND p.id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
        array_push($values, ...$ids);
    }
    $q = genesisDb()->prepare($sql . ' ORDER BY p.id'); $q->execute($values); return $q->fetchAll();
}

/** All text predicates execute in SQLite, before pagination, on the encrypted-content read view. */
function genesisSharedTaskPredicate(string $userId, array $filter, array $scope): array
{
    $known = ['spaceId','projectIds','statusIds','assigneeIds','createdBy','priority','labelIds','tags','q','from','to','dueFrom','dueTo','undated','unscheduled','scheduled','completion','approvalPending','archived','includeArchived','parentTaskId','ids','overdueDate','overdueTime','customFields','sprintId','backlog'];
    if (array_diff(array_keys($filter), $known)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    $where = $scope ? ['t.project_id IN (' . implode(',', array_fill(0, count($scope), '?')) . ')'] : ['0=1'];
    $values = array_column($scope, 'id');
    if(array_key_exists('sprintId',$filter)){
        if($filter['sprintId']===null)$where[]='NOT EXISTS(SELECT 1 FROM shared_task_planning a WHERE a.task_id=t.id AND a.sprint_id IS NOT NULL)';
        else{
            if(!is_string($filter['sprintId']))throw new InvalidArgumentException('INVALID_TASK_FILTER');
            $sprints=genesisPlanningRows('SELECT project_id FROM shared_sprints WHERE id=?',[$filter['sprintId']]);
            if(!$sprints)throw new GenesisSharedAccessException('SPRINT_NOT_FOUND',404);
            genesisSharedProjectAccess($sprints[0]['project_id'],$userId);
            $where[]='EXISTS(SELECT 1 FROM shared_task_planning a WHERE a.task_id=t.id AND a.sprint_id=?)';$values[]=$filter['sprintId'];
        }
    }
    if(array_key_exists('backlog',$filter)){
        if(!is_bool($filter['backlog']))throw new InvalidArgumentException('INVALID_TASK_FILTER');
        if($filter['backlog'])$where[]="t.completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM shared_task_planning a JOIN shared_sprints s ON s.id=a.sprint_id WHERE a.task_id=t.id AND s.state IN ('planning','active'))";
    }
    if(isset($filter['customFields'])){[$customWhere,$customValues]=genesisSharedCustomFieldPredicates($userId,$filter['customFields']);array_push($where,...$customWhere);array_push($values,...$customValues);}
    if (empty($filter['includeArchived'])) $where[] = !empty($filter['archived']) ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL';
    foreach (['statusIds'=>'t.status_id', 'assigneeIds'=>'t.assignee_id', 'ids'=>'t.id'] as $field=>$column) if (isset($filter[$field])) {
        $ids = genesisSharedQueryIds($filter[$field]);
        if (!$ids) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[] = "COALESCE($column,'unassigned') IN (" . implode(',', array_fill(0, count($ids), '?')) . ')';
        array_push($values, ...array_map(static fn($id) => $id === 'me' ? $userId : $id, $ids));
    }
    if (isset($filter['createdBy'])) { $where[] = 't.created_by=?'; $values[] = $filter['createdBy'] === 'me' ? $userId : $filter['createdBy']; }
    if (array_key_exists('parentTaskId', $filter)) {
        if ($filter['parentTaskId'] === null) $where[] = 't.parent_task_id IS NULL';
        elseif (is_string($filter['parentTaskId'])) { $where[] = 't.parent_task_id=?'; $values[] = $filter['parentTaskId']; }
        else throw new InvalidArgumentException('INVALID_TASK_FILTER');
    }
    if (isset($filter['priority'])) {
        if (!is_array($filter['priority']) || !$filter['priority'] || count($filter['priority']) > 4
            || array_filter($filter['priority'], static fn($p) => !is_int($p) || $p<0 || $p>3)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[] = 't.priority IN (' . implode(',', array_fill(0, count($filter['priority']), '?')) . ')'; array_push($values, ...$filter['priority']);
    }
    foreach (['labelIds','tags'] as $field) if (isset($filter[$field])) foreach (genesisSharedQueryIds($filter[$field]) as $value) {
        $where[] = $field === 'labelIds' ? 'EXISTS(SELECT 1 FROM shared_task_labels l WHERE l.task_id=t.id AND l.label_id=?)'
            : 'EXISTS(SELECT 1 FROM json_each(t.tags_json) tag WHERE genesis_fold(tag.value)=genesis_fold(?))';
        $values[] = $value;
    }
    $completion = $filter['completion'] ?? 'any';
    if (!in_array($completion, ['any','open','completed'], true)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    if ($completion !== 'any') $where[] = 't.completed_at IS ' . ($completion === 'completed' ? 'NOT ' : '') . 'NULL';
    if (!empty($filter['approvalPending'])) $where[] = 'EXISTS(SELECT 1 FROM shared_task_approvals a WHERE a.task_id=t.id AND a.approved_at IS NULL)';
    foreach (['archived','includeArchived','undated','approvalPending'] as $key) if (isset($filter[$key]) && !is_bool($filter[$key])) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    if (isset($filter['undated'])) $where[] = 't.due_date IS ' . ($filter['undated'] ? '' : 'NOT ') . 'NULL';
    if (isset($filter['unscheduled'])) {
        if (!in_array($filter['unscheduled'],['date','time'],true)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[] = $filter['unscheduled']==='time' ? '(COALESCE(t.start_date,t.due_date) IS NULL OR t.start_time IS NULL OR t.end_time IS NULL)' : 'COALESCE(t.start_date,t.due_date) IS NULL';
    }
    if (isset($filter['scheduled'])) {
        if (!in_array($filter['scheduled'],['date','time'],true)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[] = $filter['scheduled']==='time' ? '(COALESCE(t.start_date,t.due_date) IS NOT NULL AND t.start_time IS NOT NULL AND t.end_time IS NOT NULL)' : 'COALESCE(t.start_date,t.due_date) IS NOT NULL';
    }
    foreach (['from','to','dueFrom','dueTo'] as $field) if (isset($filter[$field])) {
        $date = genesisSharedTaskDate($filter[$field]); if ($date === null) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[] = match ($field) {
            'from' => 'COALESCE(t.due_date,t.start_date)>=?', 'to' => 'COALESCE(t.start_date,t.due_date)<=?',
            'dueFrom' => 't.due_date>=?', 'dueTo' => 't.due_date<=?'
        }; $values[] = $date;
    }
    if (isset($filter['overdueDate']) || isset($filter['overdueTime'])) {
        $date=genesisSharedTaskDate($filter['overdueDate']??null);$time=$filter['overdueTime']??null;
        if (!$date || !is_string($time) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/',$time)) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $where[]='t.completed_at IS NULL AND (t.due_date < ? OR (t.due_date = ? AND COALESCE(t.end_time,t.start_time) <= ?))';
        array_push($values,$date,$date,$time);
    }
    if (isset($filter['q'])) {
        if (!is_string($filter['q']) || mb_strlen($filter['q']) > 200) throw new InvalidArgumentException('INVALID_SEARCH');
        $tokens = preg_split('/[\s,;]+/u', trim($filter['q']), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (count($tokens) > 20) throw new InvalidArgumentException('INVALID_SEARCH');
        foreach ($tokens as $token) {
            $tagOnly = str_starts_with($token, '#'); $term = ltrim($token, '#');
            if ($term === '') continue;
            $tagSql = 'EXISTS(SELECT 1 FROM json_each(t.tags_json) tag WHERE instr(genesis_fold(tag.value),genesis_fold(?))>0)';
            if ($tagOnly) { $where[] = $tagSql; $values[] = $term; }
            else { $where[] = '(instr(genesis_fold(t.title),genesis_fold(?))>0 OR instr(genesis_fold(t.description),genesis_fold(?))>0 OR ' . $tagSql . ' OR '.genesisSharedCustomFieldSearchSql().')'; array_push($values, $term, $term, $term,$term,$term); }
        }
    }
    return [implode(' AND ', $where), $values];
}

/** A bounded month preview for every date, including days beyond a dense first page. */
function genesisSharedCalendarPreviews(string $userId, string $from, string $to, array $filter = []): array
{
    genesisSharedRequireEnabled($userId);
    if (array_diff(array_keys($filter), ['projectIds', 'priority', 'customFields'])) throw new InvalidArgumentException('INVALID_TASK_FILTER');
    try { $valid = genesisSharedTaskDate($from) === $from && genesisSharedTaskDate($to) === $to; }
    catch (InvalidArgumentException) { $valid = false; }
    if (!$valid || $from > $to
        || (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days > 41) {
        throw new InvalidArgumentException('INVALID_SHARED_CALENDAR_RANGE');
    }
    $db = genesisDb(); $owns = !$db->inTransaction();
    if ($owns) $db->beginTransaction();
    try {
        $filter = [...$filter, 'dueFrom'=>$from, 'dueTo'=>$to, 'completion'=>'open'];
        $scope = genesisSharedQueryScope($userId, $filter);
        [$where, $values] = genesisSharedTaskPredicate($userId, $filter, $scope);
        $q = $db->prepare('SELECT t.due_date,COUNT(*) AS n FROM shared_tasks_history_read t WHERE ' . $where . ' GROUP BY t.due_date');
        $q->execute($values);
        $dateCounts = array_map('intval', array_column($q->fetchAll(), 'n', 'due_date'));
        $q = $db->prepare("SELECT * FROM (SELECT t.id,t.project_id,t.title,t.due_date,t.entry_type,
            ROW_NUMBER() OVER (PARTITION BY t.due_date ORDER BY COALESCE(t.start_time,'24:00'),t.position,t.id) AS day_rank
            FROM shared_tasks_history_read t WHERE $where) WHERE day_rank<=3 ORDER BY due_date,day_rank");
        $q->execute($values);
        $rows = $q->fetchAll(); $projects = []; $tasks = [];
        foreach ($rows as $row) {
            $project = $projects[$row['project_id']] ??= genesisSharedProjectAccess($row['project_id'], $userId);
            $tasks[] = ['id'=>$row['id'], 'title'=>$row['title'], 'dueDate'=>$row['due_date'], 'completedAt'=>null,
                'entryType'=>$row['entry_type'], 'projectId'=>$row['project_id'], 'projectTitle'=>$project['title'],
                'spaceId'=>$project['space_id'], 'isInbox'=>(int)$project['is_inbox']];
        }
        if ($owns) $db->commit();
        return ['tasks'=>$tasks, 'dateCounts'=>$dateCounts];
    } catch (Throwable $error) {
        if ($owns && $db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisSharedHydrateTasks(string $userId, array $rows, array $projects = []): array
{
    if (!$rows) return [];
    $db = genesisDb(); $result = []; $ids = array_column($rows, 'id');$customDefinitionsByProject=[];
    $page = implode(',', array_fill(0, count($ids), '?'));
    $childQuery = $db->prepare('SELECT parent_task_id AS id,COUNT(*) AS total,SUM(completed_at IS NOT NULL) AS done FROM shared_tasks_history_read
        WHERE parent_task_id IN (' . $page . ') GROUP BY parent_task_id'); $childQuery->execute($ids);
    $childCounts = array_column($childQuery->fetchAll(), null, 'id');
    $unreadQuery=$db->prepare("SELECT c.task_id AS id,COUNT(DISTINCT c.id) AS total FROM shared_comments_read c
        JOIN shared_audit_events_read e ON e.object_id=c.id AND e.action='comment.created'
        LEFT JOIN shared_notification_reads r ON r.event_id=e.id AND r.user_id=?
        WHERE c.task_id IN ($page) AND c.author_id<>? AND r.event_id IS NULL GROUP BY c.task_id");
    $unreadQuery->execute([$userId,...$ids,$userId]);$unreadComments=array_column($unreadQuery->fetchAll(),'total','id');$unreadQuery->closeCursor();
    foreach ($rows as $row) {
        $projectId = $row['project_id'];
        $project = $projects[$projectId] ??= genesisSharedProjectAccess($projectId, $userId);
        $task = ['id'=>$row['id'],'projectId'=>$projectId,'projectTitle'=>$project['title'],'spaceId'=>$project['space_id'],'isInbox'=>(int)$project['is_inbox'],
            'title'=>$row['title'],'description'=>$row['description'],'tags'=>json_decode($row['tags_json'],true),'entryType'=>$row['entry_type'],
            'statusId'=>$row['status_id'],'categoryId'=>$row['category_id'],'assigneeId'=>$row['assignee_id'],
            'createdBy'=>$row['created_by'],'updatedBy'=>$row['updated_by'],'completedBy'=>$row['completed_by'],'completedAt'=>$row['completed_at'],
            'dueDate'=>$row['due_date'],'startDate'=>$row['start_date'],'startTime'=>$row['start_time'],'endTime'=>$row['end_time'],
            'position'=>(int)$row['position'],'revision'=>(int)$row['revision'],'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at'],'unreadCommentCount'=>(int)($unreadComments[$row['id']]??0),
            'priority'=>(int)$row['priority'],'parentTaskId'=>$row['parent_task_id'],'archivedAt'=>$row['archived_at'],
            'checklists'=>json_decode($row['checklists_json'],true),'childCount'=>(int)($childCounts[$row['id']]['total']??0),'completedChildCount'=>(int)($childCounts[$row['id']]['done']??0)];
        $task['dependsOnIds'] = genesisSharedDependencyIds($row['id']);
        $seriesQuery=$db->prepare('SELECT i.series_id,i.original_date,s.project_id FROM shared_series_instances i JOIN shared_task_series s ON s.id=i.series_id WHERE i.task_id=?');
        $seriesQuery->execute([$row['id']]);$series=$seriesQuery->fetch();$seriesQuery->closeCursor();
        if($series) {
            try { genesisSharedProjectAccess($series['project_id'],$userId); $task['seriesId']=$series['series_id'];$task['seriesProjectId']=$series['project_id'];$task['seriesOriginalDate']=$series['original_date']; }
            catch(GenesisSharedAccessException) { /* A subscription or series link never grants access. */ }
        }
        $task['labelIds'] = genesisSharedLabelIds('task', $row['id']);
        $customDefinitions=$customDefinitionsByProject[$projectId]??=genesisSharedCustomFields($userId,$project['space_id'],$projectId,true);
        $task['customFields']=(object)array_intersect_key(genesisSharedCustomTaskValues($row['id']),array_column($customDefinitions,null,'id'));
        $task+=genesisPlanningTaskValues($row['id']);
        $task['approvals'] = genesisSharedTaskApprovals($row['id']); $task['approvalRequired'] = count($task['approvals']) > 0;
        $task['attachments'] = genesisSharedTaskAttachments($row['id']);
        $image = $db->prepare('SELECT 1 FROM shared_task_images WHERE task_id=?'); $image->execute([$row['id']]);
        $task['imageUrl'] = genesisSharedTaskImageUrl($row['id'], (bool)$image->fetchColumn());
        // Only this bounded page enters attachment/review payloads.
        $review = genesisSharedReviewIndex($userId, $project, [$row['id']]);
        $task['review'] = ['enabled'=>$review['enabled'],'allowed'=>$review['allowed'],'entries'=>$review['entries'][$row['id']]??[]];
        foreach ($task['checklists'] as &$list) foreach ($list['items'] as &$item) if ($item['linkedTaskId'] ?? null) {
            $link = $db->prepare('SELECT t.project_id,t.completed_at FROM shared_tasks_history_read t JOIN shared_projects p ON p.id=t.project_id AND p.archived_at IS NULL
                JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id WHERE t.id=?');
            $link->execute([$userId,$item['linkedTaskId']]); $linked = $link->fetch();
            $item['done'] = $linked && $linked['completed_at'] !== null;
            $item['linkedProjectId'] = $linked ? $linked['project_id'] : null;
            if (!$linked) { $item['linkedTaskId'] = null; $item['linkUnavailable'] = true; }
        }
        unset($list, $item);
        $result[] = $task;
    }
    return $result;
}

/** Snapshot-consistent counts/page. Mutations or access changes invalidate continuation, never silently duplicate/omit rows. */
function genesisSharedQueryTasks(string $userId, array $filter = [], ?string $cursor = null, int $limit = 100, string $sort = 'position'): array
{
    genesisSharedRequireEnabled($userId);
    if ($limit < 1 || $limit > 100) throw new InvalidArgumentException('INVALID_TASK_PAGE');
    $sorts = ['position'=>['t.position','ASC'],'dueDate'=>["COALESCE(t.due_date,'9999-12-31')",'ASC'],
        'priority'=>['t.priority','DESC'],'updatedAt'=>['t.updated_at','DESC'],'createdAt'=>['t.created_at','DESC'],'createdAtAsc'=>['t.created_at','ASC'],'title'=>['genesis_fold(t.title)','ASC']];
    $db = genesisDb(); $owns = !$db->inTransaction(); if ($owns) $db->beginTransaction();
    try {
        [$filter,$sort,$viewSignature]=genesisSharedViewQuery($userId,$filter,$sort);
        $customSort=str_starts_with($sort,'custom:');
        if($customSort)$sorts[$sort]=genesisSharedCustomFieldSort($userId,$sort);
        if (!isset($sorts[$sort])) throw new InvalidArgumentException('INVALID_TASK_FILTER');
        $scope = genesisSharedQueryScope($userId, $filter);
        [$where, $values] = genesisSharedTaskPredicate($userId, $filter, $scope);
        $signature = hash('sha256', json_encode([$userId, $filter, $sort, $scope,$viewSignature], JSON_THROW_ON_ERROR));
        $seek = ''; $seekValues = []; [$column,$direction] = $sorts[$sort];
        if ($cursor !== null && $cursor !== '') {
            $decoded = strlen($cursor)<16000 ? genesisDecrypt($cursor) : null;
            $state = $decoded ? json_decode($decoded,true) : null;
            if (!is_array($state) || ($state['v']??null)!==1 || !isset($state['signature'],$state['id'])||!array_key_exists('key',$state)) throw new InvalidArgumentException('INVALID_TASK_PAGE');
            if (!hash_equals($signature, $state['signature'])) throw new GenesisSharedAccessException('SHARED_QUERY_CHANGED',409);
            $operator = $direction === 'ASC' ? '>' : '<';
            if($customSort&&$state['key']===null){$seek=" AND ($column IS NULL AND t.id > ?)";$seekValues=[$state['id']];}
            else{$bind=$customSort?'CAST(? AS '.$sorts[$sort][2].')':'?';
                $seek = " AND ($column $operator $bind OR ($column = $bind AND t.id > ?)".($customSort?" OR $column IS NULL":'').')';
                $seekValues = [$state['key'],$state['key'],$state['id']];}
        }
        $from = ' FROM shared_tasks_history_read t WHERE ' . $where;
        $q = $db->prepare('SELECT COUNT(*)' . $from); $q->execute($values); $total = (int)$q->fetchColumn();
        $q = $db->prepare('SELECT MIN(COALESCE(t.start_date,t.due_date)) AS first,MAX(COALESCE(t.due_date,t.start_date)) AS last' . $from . ' AND t.completed_at IS NULL');
        $q->execute($values); $bounds = $q->fetch();
        $q = $db->prepare('SELECT status_id,COUNT(*) AS n' . $from . ' GROUP BY status_id'); $q->execute($values);
        $statusCounts = array_map('intval', array_column($q->fetchAll(), 'n', 'status_id'));
        $q = $db->prepare('SELECT due_date,COUNT(*) AS n' . $from . ' AND due_date IS NOT NULL GROUP BY due_date'); $q->execute($values);
        $dateCounts = array_map('intval', array_column($q->fetchAll(), 'n', 'due_date'));
        $q = $db->prepare('SELECT t.*, ' . $column . ' AS page_key' . $from . $seek . ' ORDER BY '.($customSort?"($column IS NULL) ASC,":'')."$column $direction,t.id ASC LIMIT " . ($limit+1));
        $q->execute([...$values,...$seekValues]); $rows = $q->fetchAll(); $hasMore = count($rows)>$limit;
        if ($hasMore) array_pop($rows);
        $last = $rows ? $rows[count($rows)-1] : null;
        $nextCursor = $hasMore && $last ? genesisEncrypt(json_encode(['v'=>1,'signature'=>$signature,'key'=>$last['page_key'],'id'=>$last['id']],JSON_THROW_ON_ERROR)) : null;
        $tasks = genesisSharedHydrateTasks($userId,$rows);
        if ($owns) $db->commit();
        return compact('tasks','total','hasMore','nextCursor','statusCounts','dateCounts','bounds') + ['consistency'=>'restart-on-change','queryVersion'=>$signature];
    } catch (Throwable $error) { if ($owns && $db->inTransaction()) $db->rollBack(); throw $error; }
}
