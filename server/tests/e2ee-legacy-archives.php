<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyArchivesFixture(?callable $extra=null):array
{
    global $db;
    return legacyWorkspaceFixture('account',true,null,static function(string $id)use($db,$extra):void{
        $raw='[ { "section":"workspace", "id":"old", "input":{"expectedRevision":7,"ciphertext":"old-client-ciphertext","iv":"old-client-iv"} } ]';
        $safety='{ "workspace_blobs":[{"version":7,"ciphertext":"old-safety-ciphertext","iv":"old-safety-iv"}], "personal_diary_notes":[] }';
        $db->prepare('INSERT INTO backup_stages VALUES(?,?,?,?,?,?,?,?)')->execute(['stage-'.$id,$id,hash('sha256',$raw),0,str_repeat('a',64),genesisEncrypt($raw),'2020-01-01T00:00:00Z',1]);
        $db->prepare('INSERT INTO backup_safety_snapshots VALUES(?,?,?,?,?)')->execute(['safety-'.$id,$id,genesisEncrypt($safety),'2020-01-01T00:00:00Z',1]);
        $db->prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?)')->execute([$id,'exact-uncertain-restore-operation',hash('sha256',$raw),0,'2020-01-01T00:00:00Z']);
        if($extra)$extra($id,$raw,$safety);
    });
}
function archivePage(array $fixture,string $table,int $offset=0):array
{
    global $owner,$session;
    return genesisE2eeRead($owner,storeCommand('legacy-archives',$fixture['payload']+['table'=>$table,'offset'=>$offset]),$session);
}

$fixture=legacyArchivesFixture();$boundOwner=$owner;$foreign=legacyArchivesFixture();
$owner=$boundOwner;$scopeId='personal:'.$owner;
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$user=genesisFindUser($owner);
$totals=['stages'=>1,'safety'=>1,'receipts'=>1];
foreach(array_keys($totals)as $table){
    $page=archivePage($fixture,$table);storeCheck($page['totals']===$totals&&$page['offset']===0&&$page['nextOffset']===null&&count($page['rows'])===1);
    $row=$page['rows'][0];storeCheck(!isset($row['user_id'])&&!str_contains(genesisE2eeJson($page),$foreign['payload']['migrationId']));
    if($table==='receipts')storeCheck($row['operation_id']==='exact-uncertain-restore-operation'&&$row['generation']===0&&$page['legacyKey']===['keyMode'=>'empty','key'=>null]);
    else{storeCheck($row['expires_at']===1&&$page['legacyKey']===['keyMode'=>'account','key'=>$fixture['raw']]);
        $stored=$table==='stages'?'payload_enc':'snapshot_enc';$plain=$table==='stages'?'payload_json':'snapshot_json';
        storeCheck(genesisDecrypt($row[$stored])===$row[$plain]);}
    storeCheck(archivePage($fixture,$table)===$page);
}
storeCheck(genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))===$before&&genesisFindUser($owner)===$user);
foreach(['backup_stages','backup_safety_snapshots','backup_receipts']as $table)
    storeReject(fn()=>$db->prepare('DELETE FROM '.$table.' WHERE user_id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
$packet=storeCommand('legacy-archives',$fixture['payload']+['table'=>'stages','offset'=>0]);
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
$tampered=$packet;$tampered['command']['payload']['table']='safety';storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
foreach(['migrationId'=>'foreign','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $name=>$value)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-archives',array_replace($fixture['payload'],[$name=>$value])+['table'=>'stages','offset'=>0]),$session),'E2EE_MIGRATION_FENCED');
foreach([['users',0],['backup_notices',0],['stages',2]]as [$table,$offset])storeReject(fn()=>archivePage($fixture,$table,$offset),'E2EE_INVALID_ENVELOPE');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>archivePage($fixture,'stages'),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);
storeReject(fn()=>archivePage($fixture,'stages'),'E2EE_MIGRATION_FENCED');

$empty=legacyWorkspaceFixture('legacy',false);foreach(array_keys($totals)as $table){$page=archivePage($empty,$table);storeCheck($page['rows']===[]&&$page['totals']===array_fill_keys(array_keys($totals),0));}
foreach(['backup_stages'=>'payload_enc','backup_safety_snapshots'=>'snapshot_enc']as $table=>$field){
    $bad=legacyArchivesFixture(static fn(string $id)=>$db->prepare('UPDATE '.$table.' SET '.$field.'=? WHERE user_id=?')->execute(['broken-old-wrapper',$id]));
    storeReject(fn()=>archivePage($bad,$table==='backup_stages'?'stages':'safety'),'E2EE_ARCHIVE_SOURCE_CORRUPT');storeCheck(!$db->inTransaction());
}
$duplicate=legacyArchivesFixture(static fn(string $id)=>$db->prepare('UPDATE backup_safety_snapshots SET snapshot_enc=? WHERE user_id=?')->execute([genesisEncrypt('{"workspace_blobs":[],"workspace_blobs":[1]}'),$id]));
storeCheck(archivePage($duplicate,'safety')['rows'][0]['snapshot_json']==='{"workspace_blobs":[],"workspace_blobs":[1]}');
$large=legacyArchivesFixture(static function(string $id)use($db):void{
    $q=$db->prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?)');for($i=0;$i<140;$i++)$q->execute([$id,'history-'.str_pad((string)$i,4,'0',STR_PAD_LEFT),hash('sha256',(string)$i),$i,'2020-01-01T00:00:00Z']);
});
$offset=0;$ids=[];$pages=0;
do{$page=archivePage($large,'receipts',$offset);++$pages;storeCheck($page['totals']['receipts']===141&&count($page['rows'])<=128);
    foreach($page['rows']as $row){storeCheck(!isset($ids[$row['operation_id']]));$ids[$row['operation_id']]=true;}$offset=$page['nextOffset'];
}while($offset!==null);
storeCheck($pages===2&&count($ids)===141);
$oversize=legacyArchivesFixture(static fn(string $id)=>$db->prepare('UPDATE backup_stages SET payload_enc=? WHERE user_id=?')->execute([genesisEncrypt('["'.str_repeat('x',5*1024*1024).'"]'),$id]));
storeReject(fn()=>archivePage($oversize,'stages'),'E2EE_SOURCE_TOO_LARGE');storeCheck(!$db->inTransaction());
$parts=[];$position=0;$rowHash=null;$rowBytes=null;
do{
    $page=genesisE2eeRead($owner,storeCommand('legacy-archives',$oversize['payload']+['table'=>'stages','offset'=>0,'byteOffset'=>$position]),$session);
    storeCheck($page['encoding']==='utf8-json-fragments-v1'&&$page['offset']===0&&$page['byteOffset']===$position&&$page['totals']===['stages'=>1,'safety'=>1,'receipts'=>1]);
    $part=genesisE2eeDecode($page['chunk'],1,1024*1024);$parts[]=$part;
    if($rowHash===null){$rowHash=$page['rowHash'];$rowBytes=$page['rowBytes'];}else storeCheck($rowHash===$page['rowHash']&&$rowBytes===$page['rowBytes']);
    if($page['nextByteOffset']!==null)storeCheck($page['nextOffset']===0&&$page['nextByteOffset']===$position+strlen($part));
    else storeCheck($page['nextOffset']===null&&$position+strlen($part)===$rowBytes);
    $position=$page['nextByteOffset'];
}while($position!==null);
$joined=implode('',$parts);storeCheck(count($parts)>8&&strlen($joined)===$rowBytes&&storeB64(hash('sha256',$joined,true))===$rowHash);
$restored=json_decode($joined,true,64,JSON_THROW_ON_ERROR);storeCheck(strlen(json_decode($restored['payload_json'],true,64,JSON_THROW_ON_ERROR)[0])===5*1024*1024);
storeCheck(genesisDecrypt($restored['payload_enc'])===$restored['payload_json']);
foreach([-1,$rowBytes,64*1024*1024+1]as $wrong)storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-archives',$oversize['payload']+['table'=>'stages','offset'=>0,'byteOffset'=>$wrong]),$session),'E2EE_INVALID');
$empty=legacyWorkspaceFixture('legacy',false);
$emptyPage=genesisE2eeRead($owner,storeCommand('legacy-archives',$empty['payload']+['table'=>'stages','offset'=>0,'byteOffset'=>0]),$session);
storeCheck($emptyPage['rowBytes']===0&&$emptyPage['rowHash']===null&&$emptyPage['chunk']===''&&$emptyPage['nextByteOffset']===null&&$emptyPage['nextOffset']===null);
echo 'PASS e2ee-legacy-archives '.$checks.' cumulative assertions; signed retained owner archives, no restore/prune/authority writes, raw JSON and bounded pages'.PHP_EOL;
