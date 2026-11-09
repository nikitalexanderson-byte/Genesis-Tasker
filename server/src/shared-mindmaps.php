<?php
declare(strict_types=1);

function genesisSharedMindmapAccess(string $userId, string $spaceId, bool $write = false): array
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    $permissions = genesisSharedPermissions($space['member_role'], $space['permissions_json'], (int)$space['can_organize_tasks'] === 1);
    if ($write && !$permissions['editTasks']) throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN', 403);
    return $space;
}

function genesisSharedMindmapProjectScope(string $userId,string $spaceId,?string $projectId,bool $write=false):void
{
    $space=genesisSharedSpaceAccess($spaceId,$userId);
    if($projectId!==null){
        $project=genesisSharedProjectAccess($projectId,$userId,$write?'write':'read',true);
        if($project['space_id']!==$spaceId)throw new GenesisSharedAccessException();
    }elseif((bool)$space['project_access_restricted']&&!in_array($space['member_role'],['owner','admin'],true))throw new GenesisSharedAccessException();
    elseif($write&&!genesisSharedSpacePermission($space,'editTasks'))throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN',403);
}

function genesisSharedMapLength(string $value):int {return intdiv(strlen(mb_convert_encoding($value,"UTF-16LE","UTF-8")),2);}
function genesisSharedMapId(mixed $id):string {if(!is_string($id))throw new InvalidArgumentException('INVALID_MINDMAP');genesisMindmapId($id);return $id;}
function genesisSharedMapColors(mixed $value,array $keys):array {
 if(!is_array($value))throw new InvalidArgumentException('INVALID_MINDMAP');
 foreach($value as $key=>$color)if(!in_array($key,$keys,true)||!is_string($color)||!preg_match('/^#[0-9a-f]{6}$/i',$color))throw new InvalidArgumentException('INVALID_MINDMAP');return $value;
}
function genesisSharedMapPresentation(mixed $value,bool $root):array {
 if(!is_array($value)||array_diff(array_keys($value),$root?['icon','align','width','layout','showNote','image']:['icon']))throw new InvalidArgumentException('INVALID_MINDMAP');
 $icons=json_decode('["activity","alarm-clock","apple","archive","atom","bike","book-open","box","brain-circuit","brain","briefcase-business","building-2","calculator","calendar-check","calendar-days","camera","car","chart-column-increasing","circle-check","clapperboard","clipboard-list","clock-3","cloud","coins","compass","contact","credit-card","cup-soda","database","dumbbell","earth","file-text","flag","flame","focus","folder","gem","graduation-cap","handshake","headphones","heart-handshake","heart-pulse","hourglass","image","key-round","languages","library-big","lightbulb","link-2","list-checks","lock-keyhole","mail","map-pin","map","megaphone","message-circle","messages-square","mic-vocal","microscope","milestone","moon","mountain","music","network","notebook-pen","package","paintbrush","palette","pen-tool","pencil","person-standing","phone","piggy-bank","pill","plane","presentation","puzzle","repeat-2","route","search","server","shapes","shield-check","ship","sparkles","sprout","star","stethoscope","sun","target","timer","train-front","tree-pine","trophy","user-round","users","video","wallet","wand-sparkles","workflow"]',true);
 if(isset($value['icon'])&&(!is_string($value['icon'])||!in_array($value['icon'],$icons,true)))throw new InvalidArgumentException('INVALID_MINDMAP');
 if(isset($value['align'])&&!in_array($value['align'],['left','center','right'],true))throw new InvalidArgumentException('INVALID_MINDMAP');
 if(isset($value['width'])&&!in_array($value['width'],[240,320,400],true))throw new InvalidArgumentException('INVALID_MINDMAP');
 if(isset($value['layout'])&&!in_array($value['layout'],['stack','side'],true))throw new InvalidArgumentException('INVALID_MINDMAP');
 if(array_key_exists('showNote',$value)&&!is_bool($value['showNote']))throw new InvalidArgumentException('INVALID_MINDMAP');
 if(isset($value['image'])){$image=$value['image'];if(!is_array($image)||!is_string($image['data']??null)||strlen($image['data'])>350000||!is_string($image['alt']??null)||genesisSharedMapLength($image['alt'])>240||!in_array($image['fit']??'',['contain','cover'],true)||!preg_match('/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+\/]+={0,2})$/',$image['data'],$match))throw new InvalidArgumentException('INVALID_MINDMAP');
  $bytes=base64_decode($match[2],true);$info=$bytes===false?false:@getimagesizefromstring($bytes);$mime='image/'.($match[1]==='jpeg'?'jpeg':$match[1]);if(!$info||$info['mime']!==$mime||$info[0]*$info[1]>4000000)throw new InvalidArgumentException('INVALID_MINDMAP');
 }
 foreach($value as $field=>$item)if($item===null)throw new InvalidArgumentException('INVALID_MINDMAP');return $value;
}

function genesisSharedMindmapDocument(string $spaceId, string $id, mixed $value): array
{
    if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1 || ($value['id'] ?? null) !== $id
        || !is_string($value['title'] ?? null) || trim($value['title']) === '' || genesisSharedMapLength($value['title']) > 2000
        || !is_bool($value['pinned'] ?? null) || !is_bool($value['archived'] ?? null)) throw new InvalidArgumentException('INVALID_MINDMAP');
    if(array_key_exists('description',$value)&&(!is_string($value['description'])||genesisSharedMapLength($value['description'])>12000))throw new InvalidArgumentException('INVALID_MINDMAP');
    $value['projectId']??=null;
    $nodes = $value['nodes'] ?? null; $links = $value['links'] ?? null;
    if (!is_array($nodes) || !array_is_list($nodes) || count($nodes) < 1 || count($nodes) > 1000
        || !is_array($links) || !array_is_list($links) || count($links) > 2000
        || strlen(json_encode($value, JSON_THROW_ON_ERROR)) > 2_000_000) throw new InvalidArgumentException('INVALID_MINDMAP');
    $ids = []; $roots = 0;
    foreach ($nodes as $node) {
        if (!is_array($node)) throw new InvalidArgumentException('INVALID_MINDMAP');
        genesisSharedMapId($node['id'] ?? '');
        if (isset($ids[$node['id']]) || !array_key_exists('parentId', $node)
            || !in_array($node['kind'] ?? '', ['idea','task','project'], true)
            || !is_string($node['note'] ?? null) || genesisSharedMapLength($node['note']) > 12000
            || ($node['kind'] === 'idea' && (!is_string($node['text'] ?? null) || genesisSharedMapLength($node['text']) > 2000))) throw new InvalidArgumentException('INVALID_MINDMAP');
        if ($node['parentId'] === null) $roots++;
        elseif (!is_string($node['parentId'])) throw new InvalidArgumentException('INVALID_MINDMAP');
        if(array_key_exists('tags',$node)){if(!is_array($node['tags'])||!array_is_list($node['tags'])||count($node['tags'])>8||count(array_unique($node['tags'],SORT_REGULAR))!==count($node['tags']))throw new InvalidArgumentException('INVALID_MINDMAP');foreach($node['tags'] as $tag)if(!is_string($tag)||trim($tag)===''||genesisSharedMapLength($tag)>32)throw new InvalidArgumentException('INVALID_MINDMAP');}
        if(array_key_exists('occurrenceDate',$node)&&(!is_string($node['occurrenceDate'])||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$node['occurrenceDate'])||date('Y-m-d',strtotime($node['occurrenceDate'])?:0)!==$node['occurrenceDate']||$node['kind']!=='task'))throw new InvalidArgumentException('INVALID_MINDMAP');
        if(array_key_exists('style',$node))$node['style']=genesisSharedMapColors($node['style'],['fill','border']);
        if(array_key_exists('presentation',$node))$node['presentation']=genesisSharedMapPresentation($node['presentation'],$node['parentId']===null);
        $ids[$node['id']] = $node;
        if ($node['kind'] !== 'idea') {
            genesisSharedMapId($node['refId'] ?? '');
            $sql = $node['kind'] === 'project' ? 'SELECT space_id FROM shared_projects WHERE id=?'
                : 'SELECT p.space_id FROM shared_tasks t JOIN shared_projects p ON p.id=t.project_id WHERE t.id=?';
            $q = genesisDb()->prepare($sql); $q->execute([$node['refId']]); $sourceSpace = $q->fetchColumn();
            if ($sourceSpace !== false && $sourceSpace !== $spaceId) throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN', 403);
            // Reference titles are resolved from accessible live tasks, never copied into maps.
            unset($ids[$node['id']]['text']);
        }
    }
    if ($roots !== 1) throw new InvalidArgumentException('INVALID_MINDMAP');
    foreach ($ids as $node) {
        $seen = [$node['id']=>true]; $cursor = $node;
        while ($cursor['parentId'] !== null) {
            if (isset($seen[$cursor['parentId']]) || !isset($ids[$cursor['parentId']]) || count($seen) >= 32) throw new InvalidArgumentException('INVALID_MINDMAP');
            $seen[$cursor['parentId']] = true; $cursor = $ids[$cursor['parentId']];
        }
    }
    $linkIds = [];
    foreach ($links as $link) {
        if (!is_array($link)) throw new InvalidArgumentException('INVALID_MINDMAP');
        genesisSharedMapId($link['id'] ?? '');
        if (isset($linkIds[$link['id']]) || !isset($ids[$link['from'] ?? ''], $ids[$link['to'] ?? ''])
            || $link['from'] === $link['to'] || !is_string($link['label'] ?? null) || genesisSharedMapLength($link['label']) > 240) throw new InvalidArgumentException('INVALID_MINDMAP');
        if(array_key_exists('color',$link))genesisSharedMapColors(['lineColor'=>$link['color']],['lineColor']);
        $linkIds[$link['id']] = true;
    }
    if(array_key_exists('appearance',$value))$value['appearance']=genesisSharedMapColors($value['appearance'],['lineColor']);
    if (($value['projectId'] ?? null) !== null) {
        genesisSharedMapId($value['projectId']);
        $q = genesisDb()->prepare('SELECT space_id FROM shared_projects WHERE id=?'); $q->execute([$value['projectId']]);
        if ($q->fetchColumn() !== $spaceId) throw new GenesisSharedAccessException();
    }
    if (!empty($value['projectId']) && array_filter($nodes, static fn(array $n):bool => isset($n['presentation']['image']))) {
        $q=genesisDb()->prepare("SELECT 1 FROM shared_projects WHERE id=? AND archived_at IS NOT NULL AND julianday(archived_at)<=julianday('now','-30 days')");$q->execute([$value['projectId']]);
        if ($q->fetchColumn()) throw new InvalidArgumentException('PROJECT_FILES_EXPIRED');
    }
    $value['nodes'] = array_values($ids); return $value;
}

function genesisSharedMindmapRecord(array $row): array
{
    return ['id' => $row['id'] ?? $row['map_id'], 'schemaVersion' => 1, 'revision' => (int)$row['revision'],
        'updatedAt' => $row['updated_at'], 'document' => json_decode(genesisSharedContentDecrypt($row['content']), true, 64, JSON_THROW_ON_ERROR)];
}

function genesisSharedMindmaps(string $userId, string $spaceId, ?string $historyId = null): array
{
    genesisSharedMindmapAccess($userId, $spaceId);
    if ($historyId !== null) genesisMindmapId($historyId);
    $space=genesisSharedSpaceAccess($spaceId,$userId);
    // PDO execute(array) binds scalar values as strings; SQLite does not coerce a bare parameter in ?=0.
    $access=' AND ((project_id IS NULL AND CAST(? AS INTEGER)=0) OR project_id IN (SELECT p.id FROM shared_projects p JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=m.user_id WHERE p.space_id=? AND NOT EXISTS(SELECT 1 FROM shared_trash t WHERE t.kind=\'project\' AND t.object_id=p.id)))';
    $q=genesisDb()->prepare($historyId===null?'SELECT * FROM shared_mindmaps WHERE space_id=?'.$access.' ORDER BY updated_at DESC'
        :'SELECT * FROM shared_mindmap_versions WHERE space_id=? AND map_id=?'.$access.' ORDER BY revision DESC LIMIT 20');
    $values=$historyId===null?[$spaceId]:[$spaceId,$historyId];array_push($values,(int)((bool)$space['project_access_restricted']&&!in_array($space['member_role'],['owner','admin'],true)),$userId,$spaceId);$q->execute($values);
    return array_map('genesisSharedMindmapRecord', $q->fetchAll());
}

function genesisSaveSharedMindmap(string $userId, string $spaceId, string $id, array $input): array
{
    genesisMindmapId($id); genesisSharedMapId($input['operationId'] ?? '');
    if (($input['schemaVersion'] ?? null) !== 1 || !is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] < 0) throw new InvalidArgumentException('INVALID_MINDMAP');
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        genesisSharedMindmapAccess($userId, $spaceId);
        $document = genesisSharedMindmapDocument($spaceId, $id, $input['document'] ?? null);
        genesisSharedMindmapProjectScope($userId,$spaceId,$document['projectId'],true);
        $q=$db->prepare('SELECT project_id FROM shared_mindmaps WHERE space_id=? AND id=?');$q->execute([$spaceId,$id]);
        if($row=$q->fetch())genesisSharedMindmapProjectScope($userId,$spaceId,$row['project_id'],true);
        $plain = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $hash = hash('sha256', $input['expectedRevision'] . ':' . $plain);
        $q = $db->prepare('SELECT 1 FROM shared_mindmap_deletions WHERE space_id=? AND map_id=?'); $q->execute([$spaceId,$id]);
        if ($q->fetchColumn()) throw new GenesisResourceLimitException(409, 'MAP_REVISION_CONFLICT');
        $q = $db->prepare('SELECT * FROM shared_mindmap_receipts WHERE space_id=? AND map_id=? AND operation_id=?'); $q->execute([$spaceId,$id,$input['operationId']]);
        if ($receipt = $q->fetch()) {
            if (!hash_equals($receipt['payload_hash'],$hash)) throw new GenesisResourceLimitException(409,'MAP_OPERATION_REUSED');
            $db->commit(); return ['revision'=>(int)$receipt['revision']];
        }
        $q = $db->prepare('SELECT revision FROM shared_mindmaps WHERE space_id=? AND id=?'); $q->execute([$spaceId,$id]); $current = $q->fetchColumn();
        if ((int)($current === false ? 0 : $current) !== $input['expectedRevision']) throw new GenesisResourceLimitException(409,'MAP_REVISION_CONFLICT');
        if ($current===false) genesisRequireSharedOwnerQuota($spaceId,'shared-mindmaps');
        $q = $db->prepare('SELECT COUNT(*) FROM shared_mindmaps WHERE space_id=?'); $q->execute([$spaceId]);
        if ($current === false && (int)$q->fetchColumn() >= 200) throw new GenesisResourceLimitException(413,'MAP_LIMIT_200');
        $revision = $input['expectedRevision'] + 1; $now = genesisNow(); $encrypted = genesisSharedContentEncrypt($plain);
        $q = $db->prepare('SELECT COALESCE(SUM(length(content)),0) FROM shared_mindmap_versions WHERE space_id=? AND NOT (map_id=? AND revision<=?)'); $q->execute([$spaceId,$id,$revision-20]);
        if ((int)$q->fetchColumn() + strlen($encrypted) > 40_000_000) throw new GenesisResourceLimitException(413,'MAP_STORAGE_LIMIT');
        $db->prepare('INSERT INTO shared_mindmaps(space_id,id,revision,content,updated_at,project_id) VALUES(?,?,?,?,?,?) ON CONFLICT(space_id,id) DO UPDATE SET revision=excluded.revision,content=excluded.content,updated_at=excluded.updated_at,project_id=excluded.project_id')->execute([$spaceId,$id,$revision,$encrypted,$now,$document["projectId"]]);
        $db->prepare('INSERT INTO shared_mindmap_versions(space_id,map_id,revision,content,updated_at,project_id) VALUES(?,?,?,?,?,?)')->execute([$spaceId,$id,$revision,$encrypted,$now,$document["projectId"]]);
        $db->prepare('INSERT INTO shared_mindmap_receipts VALUES(?,?,?,?,?)')->execute([$spaceId,$id,$input['operationId'],$hash,$revision]);
        $db->prepare('DELETE FROM shared_mindmap_versions WHERE space_id=? AND map_id=? AND revision<=?')->execute([$spaceId,$id,$revision-20]);
        $db->commit(); return ['revision'=>$revision,'updatedAt'=>$now];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisDeleteSharedMindmap(string $userId, string $spaceId, string $id, array $input): array
{
    genesisMindmapId($id);
    if (!is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] < 0) throw new InvalidArgumentException('INVALID_MINDMAP');
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        genesisSharedMindmapAccess($userId,$spaceId);
        $q=$db->prepare('SELECT d.map_id,s.project_id FROM shared_mindmap_deletions d LEFT JOIN shared_mindmap_deletion_scopes s ON s.space_id=d.space_id AND s.map_id=d.map_id WHERE d.space_id=? AND d.map_id=?'); $q->execute([$spaceId,$id]);
        if($deleted=$q->fetch()){genesisSharedMindmapProjectScope($userId,$spaceId,$deleted['project_id'],true);$db->commit();return ['deleted'=>true];}
        $q=$db->prepare('SELECT revision,project_id FROM shared_mindmaps WHERE space_id=? AND id=?'); $q->execute([$spaceId,$id]);$map=$q->fetch();
        if(!$map)throw new GenesisSharedAccessException();
        genesisSharedMindmapProjectScope($userId,$spaceId,$map['project_id'],true);
        if ((int)$map['revision'] !== $input['expectedRevision']) throw new GenesisResourceLimitException(409,'MAP_REVISION_CONFLICT');
        $db->prepare('INSERT INTO shared_mindmap_deletions(space_id,map_id) VALUES(?,?)')->execute([$spaceId,$id]);
        $db->prepare('INSERT INTO shared_mindmap_deletion_scopes(space_id,map_id,project_id) VALUES(?,?,?)')->execute([$spaceId,$id,$map['project_id']]);
        $db->prepare('DELETE FROM shared_mindmaps WHERE space_id=? AND id=?')->execute([$spaceId,$id]);
        $db->commit(); return ['deleted'=>true];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** Runs inside the ordinary shared-task transaction, so two members cannot duplicate one thought. */
function genesisSharedMindmapConversion(string $userId, array $project, array $source): ?array
{
    $spaceId=$project['space_id']; genesisSharedMindmapAccess($userId,$spaceId);
    genesisSharedMapId($source['mapId'] ?? ''); genesisSharedMapId($source['nodeId'] ?? '');
    $q=genesisDb()->prepare('SELECT * FROM shared_mindmap_conversions WHERE space_id=? AND map_id=? AND node_id=?');
    $q->execute([$spaceId,$source['mapId'],$source['nodeId']]); $existing=$q->fetch();
    if ($existing) {
        if ($existing['project_id'] !== $project['id']) throw new GenesisResourceLimitException(409,'MAP_REVISION_CONFLICT');
        try { return genesisSharedGetTask($userId,$project['id'],$existing['task_id']); }
        catch (GenesisSharedAccessException $error) {
            if ($error->status !== 404) throw $error;
            throw new GenesisResourceLimitException(409,'TASK_DELETED');
        }
    }
    $q=genesisDb()->prepare('SELECT content,project_id FROM shared_mindmaps WHERE space_id=? AND id=?'); $q->execute([$spaceId,$source['mapId']]); $map=$q->fetch();
    if (!$map) throw new GenesisSharedAccessException();
    genesisSharedMindmapProjectScope($userId,$spaceId,$map['project_id'],true);$content=$map['content'];
    $document=json_decode(genesisSharedContentDecrypt($content),true,64,JSON_THROW_ON_ERROR);
    foreach ($document['nodes'] as $node) if ($node['id']===$source['nodeId'] && $node['kind']==='idea') return null;
    throw new GenesisResourceLimitException(409,'MAP_REVISION_CONFLICT');
}
