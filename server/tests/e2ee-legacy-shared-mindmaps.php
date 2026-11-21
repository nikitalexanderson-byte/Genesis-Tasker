<?php
declare(strict_types=1);
require __DIR__.'/e2ee-store.php';
require_once dirname(__DIR__).'/src/shared-projects.php';

// Real migrated SQLite, real signed E2EE read dispatch, synthetic identities.
// No HTTP, user accounts, active generation, restore, file or provider writes.
function sharedMapFixture(string $kind,?callable $beforeLease=null,bool $start=true):array
{
    global $db,$owner,$scopeId,$device,$authority,$kit,$now,$session;
    static $number=0;$suffix=(string)++$number;$owner='shared-map-owner-'.$suffix;$other='shared-map-other-'.$suffix;
    $space='shared-map-space-'.$suffix;$project='shared-map-project-'.$suffix;$foreign='shared-map-foreign-'.$suffix;
    foreach([$owner,$other]as$id)$db->prepare("INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,'business','2035-01-01T00:00:00Z',1,?,?)")
        ->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now]);
    $db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$space,'Synthetic',$owner,$now,$now]);
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space,$owner,$kind==='space'?'owner':'member',$now]);
    foreach([$project,$foreign]as$id)$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$space,'Synthetic',$id===$project?$owner:$other,$now,$now]);
    $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$project,$owner,'owner',$now]);
    $targetProject=$kind==='project'?$project:null;$otherProject=$kind==='project'?$foreign:$project;
    $original="\xEF\xBB\xBF {\r\n\"id\":\"owned-map\",\"projectId\":".genesisE2eeJson($targetProject).",\"private\":\"SYNTHETIC OWNED ORIGINAL\"}\r\n";
    $foreignOriginal=genesisE2eeJson(['id'=>'foreign-map','projectId'=>$otherProject,'private'=>'OTHER_SCOPE_BODY']);
    foreach([['owned-map',$targetProject,$original],['foreign-map',$otherProject,$foreignOriginal]]as[$id,$parent,$raw]){
        $stored=genesisSharedContentEncrypt($raw);
        $db->prepare('INSERT INTO shared_mindmaps(space_id,id,revision,content,updated_at,project_id) VALUES(?,?,25,?,?,?)')->execute([$space,$id,$stored,$now,$parent]);
        for($revision=1;$revision<=25;$revision++)$db->prepare('INSERT INTO shared_mindmap_versions(space_id,map_id,revision,content,updated_at,project_id) VALUES(?,?,?,?,?,?)')->execute([$space,$id,$revision,$stored,$now,$parent]);
        $db->prepare('INSERT INTO shared_mindmap_receipts VALUES(?,?,?,?,25)')->execute([$space,$id,'saved-'.$id,str_repeat('a',64)]);
        $db->prepare('INSERT INTO shared_mindmap_deletions VALUES(?,?)')->execute([$space,'removed-'.$id]);
        $db->prepare('INSERT INTO shared_mindmap_deletion_scopes VALUES(?,?,?)')->execute([$space,'removed-'.$id,$parent]);
    }
    // The current map has moved to another scope. Its original version and
    // receipt still belong to the old owner, including an explicit null space.
    $db->prepare('INSERT INTO shared_mindmaps(space_id,id,revision,content,updated_at,project_id) VALUES(?,?,2,?,?,?)')->execute([$space,'moving-map',genesisSharedContentEncrypt($foreignOriginal),$now,$otherProject]);
    $db->prepare('INSERT INTO shared_mindmap_versions(space_id,map_id,revision,content,updated_at,project_id) VALUES(?,?,1,?,?,?)')->execute([$space,'moving-map',genesisSharedContentEncrypt($original),$now,$targetProject]);
    $db->prepare('INSERT INTO shared_mindmap_receipts VALUES(?,?,?,?,1)')->execute([$space,'moving-map','old-original',str_repeat('b',64)]);
    foreach([$project,$foreign]as$index=>$parent)$db->prepare('INSERT INTO shared_mindmap_conversions VALUES(?,?,?,?,?)')->execute([$space,'owned-map','node-'.$index,$parent,'historical-task-reference-'.$index]);
    $db->prepare('INSERT INTO shared_mindmap_conversions VALUES(?,?,?,?,?)')->execute([$space,'foreign-map','foreign-node',$project,'foreign-source-reference']);
    $fixture=compact('kind','space','project','foreign','targetProject','otherProject','original','other');
    if($beforeLease)$beforeLease($fixture);
    $device=storePair();$authority=storePair();$scopeId=$kind.':shared-map-source-'.$suffix;
    $kit['ownerId']=$owner;$kit['authority']=['signingKey'=>$authority['signingKey'],'receivingKey'=>$authority['receivingKey']];$kit['protectedKeys']['ownerId']=$owner;
    $command=['protocol'=>1,'ownerId'=>$owner,'scopeId'=>$scopeId,'deviceId'=>'device-a','action'=>'bootstrap','expectedRevision'=>0,'checkpointHash'=>'genesis','securityEpoch'=>1,
        'operationId'=>'shared-map-bootstrap-'.$suffix,'payload'=>['kind'=>$kind,'resourceId'=>$kind==='project'?$project:$space,'keyId'=>'fresh-shared-map-root-'.$suffix,'generation'=>1,
        'recoveryKit'=>$kit,'recoveryCapsule'=>storeCapsule($authority),'deviceKeys'=>['signingKey'=>$device['signingKey'],'receivingKey'=>$device['receivingKey']],'deviceCapsule'=>storeCapsule($device)]];
    $command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
    genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
    $source=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$migration='shared-map-attempt-'.$suffix;
    $lease=$start?genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>$migration,'sourceHash'=>$source]),$session):['fence'=>1];
    return$fixture+['payload'=>['migrationId'=>$migration,'fence'=>$lease['fence'],'sourceHash'=>$source]];
}
function sharedMapPage(array $fixture,string $table,int $offset=0):array
{
    global $owner,$session;
    return genesisE2eeRead($owner,storeCommand('legacy-shared-mindmaps',$fixture['payload']+['table'=>$table,'offset'=>$offset]),$session);
}
function sharedMapInventoryHash(string $space):string
{
    global $db;$hash=hash_init('sha256');
    foreach(['shared_mindmaps','shared_mindmap_versions','shared_mindmap_receipts','shared_mindmap_deletions','shared_mindmap_deletion_scopes','shared_mindmap_conversions']as$table){
        $q=$db->prepare('SELECT * FROM '.$table.' WHERE space_id=? ORDER BY rowid');$q->execute([$space]);
        try{while($row=$q->fetch())hash_update($hash,serialize($row));}finally{$q->closeCursor();}
    }
    return hash_final($hash);
}

// A personal scope cannot turn this new action into a shared export.
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-shared-mindmaps',['migrationId'=>'wrong-kind','fence'=>1,'sourceHash'=>storeB64(random_bytes(32)),'table'=>'maps','offset'=>0]),$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['project','space']as$kind){
    $fixture=sharedMapFixture($kind);$before=sharedMapInventoryHash($fixture['space']);
    $totals=['maps'=>1,'versions'=>26,'receipts'=>2,'deletions'=>1,'deletionScopes'=>1,'conversions'=>2];
    foreach(array_keys($totals)as$table){
        $page=sharedMapPage($fixture,$table);
        storeCheck($page['kind']===$kind&&$page['scopeId']===$scopeId&&$page['spaceId']===$fixture['space']&&$page['totals']===$totals);
        storeCheck(count($page['rows'])===$totals[$table]&&$page['nextOffset']===null&&$page['sourceHash']===$fixture['payload']['sourceHash']);
        storeCheck(!str_contains(genesisE2eeJson($page),'OTHER_SCOPE_BODY'));
        if($table==='maps')storeCheck($page['rows'][0]['id']==='owned-map'&&$page['rows'][0]['originalJson']===$fixture['original']&&genesisSharedContentDecrypt($page['rows'][0]['content'])===$fixture['original']);
        if($table==='versions')storeCheck(count(array_filter($page['rows'],static fn(array $row):bool=>$row['map_id']==='moving-map'))===1);
        if($table==='conversions')storeCheck(count(array_filter($page['rows'],static fn(array $row):bool=>$row['map_id']==='owned-map'))===2);
    }
    storeCheck(sharedMapInventoryHash($fixture['space'])===$before);
    if($kind==='project'){
        storeReject(fn()=>$db->prepare('UPDATE shared_mindmap_receipts SET payload_hash=? WHERE space_id=? AND map_id=? AND operation_id=?')->execute([str_repeat('d',64),$fixture['space'],'moving-map','old-original']),'E2EE_LEGACY_WRITE_FORBIDDEN');
        storeReject(fn()=>$db->prepare('UPDATE shared_mindmap_conversions SET task_id=? WHERE space_id=? AND map_id=? AND node_id=?')->execute(['changed-reference',$fixture['space'],'owned-map','node-1']),'E2EE_LEGACY_WRITE_FORBIDDEN');
    }
    foreach([['table'=>'users','offset'=>0],['table'=>'versions','offset'=>27]]as$invalid)
        storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-shared-mindmaps',$fixture['payload']+$invalid),$session),'E2EE_INVALID_ENVELOPE');
    foreach([['fence'=>$fixture['payload']['fence']+1],['sourceHash'=>storeB64(random_bytes(32))],['migrationId'=>'foreign-attempt']]as$changed){
        $payload=array_replace($fixture['payload'],$changed)+['table'=>'maps','offset'=>0];
        storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-shared-mindmaps',$payload),$session),'E2EE_MIGRATION_FENCED');
    }
    $packet=storeCommand('legacy-shared-mindmaps',$fixture['payload']+['table'=>'versions','offset'=>0]);$packet['command']['payload']['offset']=1;
    storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_UNTRUSTED_COMMAND');
    storeReject(fn()=>genesisE2eeRead($fixture['other'],storeCommand('legacy-shared-mindmaps',$fixture['payload']+['table'=>'maps','offset'=>0]),$session),'SHARED_PROJECT_NOT_FOUND');
    $db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
    storeReject(fn()=>sharedMapPage($fixture,'maps'),'E2EE_MIGRATION_FENCED');
    if($kind==='project'){
        $old=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));
        $db->prepare('UPDATE shared_mindmap_receipts SET payload_hash=? WHERE space_id=? AND map_id=? AND operation_id=?')->execute([str_repeat('d',64),$fixture['space'],'moving-map','old-original']);
        storeCheck($old!==genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
    }
}
$fixture=sharedMapFixture('project',start:false);
storeReject(fn()=>sharedMapPage($fixture,'maps'),'E2EE_MIGRATION_FENCED');

// Missing original lineage refuses before trying to open a corrupt body.
foreach(['receipt','deletion','conflicting-null','foreign-space','unknown-conversion','moved-conversion']as$mode){
    $fixture=sharedMapFixture('project',static function(array $f)use($db,$mode):void{
        $db->prepare('UPDATE shared_mindmaps SET content=? WHERE space_id=? AND id=?')->execute(['genesis-content-v1:unopenable',$f['space'],'owned-map']);
        if($mode==='receipt')$db->prepare('INSERT INTO shared_mindmap_receipts VALUES(?,?,?,?,999)')->execute([$f['space'],'owned-map','unknown-original',str_repeat('c',64)]);
        elseif($mode==='deletion')$db->prepare('DELETE FROM shared_mindmap_deletion_scopes WHERE space_id=? AND map_id=?')->execute([$f['space'],'removed-owned-map']);
        elseif($mode==='conflicting-null')$db->prepare('UPDATE shared_mindmap_versions SET project_id=NULL WHERE space_id=? AND map_id=? AND revision=25')->execute([$f['space'],'owned-map']);
        elseif($mode==='foreign-space'){
            $db->prepare('INSERT INTO shared_spaces(id,title,created_at,updated_at) VALUES(?,?,?,?)')->execute(['unrelated-space-'.$f['space'],'Unrelated','2026-11-21','2026-11-21']);
            $db->prepare('INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')->execute(['unrelated-project-'.$f['space'],'unrelated-space-'.$f['space'],'Unrelated','2026-11-21','2026-11-21']);
            $db->prepare('UPDATE shared_mindmap_versions SET project_id=? WHERE space_id=? AND map_id=? AND revision=1')->execute(['unrelated-project-'.$f['space'],$f['space'],'owned-map']);
        }
        elseif($mode==='unknown-conversion')$db->prepare('INSERT INTO shared_mindmap_conversions VALUES(?,?,?,?,?)')->execute([$f['space'],'unknown-original-map','unbound-node',$f['project'],'inert-reference']);
        else $db->prepare('UPDATE shared_mindmap_versions SET project_id=? WHERE space_id=? AND map_id=? AND revision=1')->execute([$f['otherProject'],$f['space'],'owned-map']);
    });
    $before=sharedMapInventoryHash($fixture['space']);storeReject(fn()=>sharedMapPage($fixture,'maps'),'E2EE_SHARED_SOURCE_LINEAGE_REVIEW_REQUIRED');storeCheck($before===sharedMapInventoryHash($fixture['space']));
}
$fixture=sharedMapFixture('project',static function(array $f)use($db):void{
    $db->prepare('UPDATE shared_mindmaps SET content=? WHERE space_id=? AND id=?')->execute(['genesis-content-v1:unopenable',$f['space'],'owned-map']);
});
storeReject(fn()=>sharedMapPage($fixture,'maps'),'E2EE_SHARED_SOURCE_CONTENT_UNAVAILABLE');

$large=sharedMapFixture('project',static function(array $f)use($db):void{
    $raw=genesisE2eeJson(['id'=>'owned-map','projectId'=>$f['project'],'private'=>'SYNTHETIC LARGE ORIGINAL','padding'=>str_repeat('z',512*1024+7)]);
    $db->prepare('UPDATE shared_mindmap_versions SET content=? WHERE space_id=? AND map_id=?')->execute([genesisSharedContentEncrypt($raw),$f['space'],'owned-map']);
});
$before=sharedMapInventoryHash($large['space']);$offset=0;$seen=[];$pages=0;$bytes=0;
do{
    $page=sharedMapPage($large,'versions',$offset);$pages++;storeCheck(strlen(genesisE2eeJson($page))<=8*1024*1024&&$page['totals']['versions']===26);
    foreach($page['rows']as$row){$id=$row['map_id'].':'.$row['revision'];storeCheck(!isset($seen[$id]));$seen[$id]=true;$bytes+=strlen($row['originalJson']);}
    storeCheck($page['nextOffset']===null||$page['nextOffset']===$offset+count($page['rows']));$offset=$page['nextOffset'];
}while($offset!==null);
storeCheck(count($seen)===26&&$pages>1&&$bytes>12*1024*1024&&sharedMapInventoryHash($large['space'])===$before);
storeCheck(sharedMapPage($large,'versions',26)['rows']===[]);
echo 'PASS e2ee-legacy-shared-mindmaps '.$checks.' cumulative assertions; exact project/space indexed grants, original moved/null lineage, all retained versions, bounded pages and no legacy mutation. Source adapters/custody remain pending.'.PHP_EOL;
