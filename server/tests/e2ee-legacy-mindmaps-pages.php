<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-mindmaps.php';

function mapsPage(array $fixture,string $table,int $offset=0):array
{
    global $owner,$session;
    return genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']+['table'=>$table,'offset'=>$offset]),$session);
}
$fixture=legacyMindmapsFixture();$source=$fixture['payload']['sourceHash'];$full=genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']),$session);
foreach(['maps','versions','receipts','deletions']as $name){
    $page=mapsPage($fixture,$name);storeCheck($page['rows']===$full[$name]&&$page['table']===$name&&$page['offset']===0&&$page['nextOffset']===null);
    storeCheck($page['totals']===['maps'=>1,'versions'=>25,'receipts'=>1,'deletions'=>1]&&$page['sourceHash']===$source);
    storeCheck($page['legacyKey']===(in_array($name,['maps','versions'],true)?$full['legacyKey']:['keyMode'=>'empty','key'=>null]));
}
$packet=storeCommand('legacy-mindmaps',$fixture['payload']+['table'=>'versions','offset'=>0]);$packet['command']['payload']['offset']=1;
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_UNTRUSTED_COMMAND');
foreach([['table'=>'users','offset'=>0],['table'=>'versions','offset'=>26]]as $invalid)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$fixture['payload']+$invalid),$session),'E2EE_INVALID_ENVELOPE');
$big=legacyMindmapsFixture(static function(string $id)use($db):void{
    genesisBeginWriteTransaction($db);try{
        $cipher=base64_encode(str_repeat('synthetic original encrypted version-',21000));$iv=base64_encode(random_bytes(12));
        $q=$db->prepare('INSERT INTO personal_mindmap_versions VALUES(?,?,?,?,?,?,?)');
        for($i=26;$i<=50;$i++)$q->execute([$id,'private-map',$i,2,$cipher,$iv,'2026-11-19T00:00:00Z']);
        $db->prepare('UPDATE personal_mindmaps SET revision=50,ciphertext=?,iv=? WHERE user_id=?')->execute([$cipher,$iv,$id]);
        $db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=(int)$db->query('SELECT total_changes()')->fetchColumn();
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-mindmaps',$big['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
$seen=[];$offset=0;$pages=0;$bytes=0;
do{
    $page=mapsPage($big,'versions',$offset);$pages++;storeCheck(strlen(genesisE2eeJson($page))<16*1024*1024&&$page['totals']['versions']===50&&$page['sourceHash']===$before);
    foreach($page['rows']as $row){storeCheck(!isset($seen[$row['revision']]));$seen[$row['revision']]=true;$bytes+=strlen($row['ciphertext']);}
    storeCheck($page['nextOffset']===null||$page['nextOffset']===$offset+count($page['rows']));$offset=$page['nextOffset'];
}while($offset!==null);
storeCheck(count($seen)===50&&$pages>1&&$bytes>16*1024*1024&&$bytes<40000000);
// One technical writer acquisition for every page; no content/history mutation.
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&(int)$db->query('SELECT total_changes()')->fetchColumn()-$changes===$pages+1);
storeCheck(mapsPage($big,'versions',50)['rows']===[]&&mapsPage($big,'versions',50)['nextOffset']===null);
echo 'PASS e2ee-legacy-mindmaps-pages '.$checks.' cumulative assertions; bounded signed complete history above the old message cap, exact small-source compatibility and no truncation'.PHP_EOL;
