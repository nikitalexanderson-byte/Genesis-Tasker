<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyStoicheionFixture(string $mode='account',?callable $alter=null):array
{
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($alter):void {
        global $db;$now=genesisNow();
        $db->prepare('INSERT INTO stoicheion_workspaces VALUES(?,?,?,?,?,?)')->execute([$id,4,base64_encode(random_bytes(12)),base64_encode(random_bytes(48)),hash('sha256','synthetic'),$now]);
        $db->prepare("INSERT INTO stoicheion_draws VALUES(?,'2026-11-19','spread',123,2,?,?)")->execute([$id,$now,$now]);
        $db->prepare("INSERT INTO stoicheion_spread_cards VALUES(?,'2026-11-19',123,3,'[]',?)")->execute([$id,$now]);
        $db->prepare("INSERT INTO stoicheion_timeline_draws VALUES(?,'2026-11-19','timeline',456,2,?,?)")->execute([$id,$now,$now]);
        $db->prepare("INSERT INTO stoicheion_timeline_sessions VALUES(?,'2026-11-16','2026-11-19',456,2,?,?)")->execute([$id,$now,$now]);
        $db->prepare("INSERT INTO stoicheion_timeline_card_windows VALUES(?,'2026-11-16',0,?,?)")->execute([$id,$now,$now]);
        if($alter)$alter($id);
    });
}
$f=legacyStoicheionFixture();$p=$f['payload'];$packet=storeCommand('legacy-stoicheion',$p);
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=$db->query('SELECT total_changes()')->fetchColumn();
$source=genesisE2eeRead($owner,$packet,$session);
storeCheck($source['ownerId']===$owner&&$source['scopeId']===$scopeId&&$source['sourceHash']===$p['sourceHash']);
storeCheck($source['workspace']['revision']===4&&$source['legacyKey']===['keyMode'=>'account','key'=>$f['raw']]);
storeCheck(count($source['draws'])===2&&$source['draws'][0]['kind']==='spread'&&$source['draws'][1]['kind']==='timeline');
storeCheck($source['spreadCards'][0]['sourceSeed']===123&&$source['spreadCards'][0]['cardsJson']==='[]');
storeCheck($source['timelineSessions'][0]['seed']===456&&$source['timelineWindows'][0]['lastRerolledAt']!==null);
foreach(['attempt_count','attempts','unlimited','canReroll','remainingSeconds','rerollDeadline','subscription','workspace_key_enc','refresh_token','orders']as $field)
    storeCheck(!str_contains(genesisE2eeJson($source),'"'.$field.'"'));
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$changes===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$source&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'other','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-stoicheion',array_replace($p,[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-stoicheion',$p,replace:['expectedRevision'=>0]),$session),'E2EE_STALE_EPOCH');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$p['migrationId'],'fence'=>1]),$session);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$f=legacyStoicheionFixture('client');$client=genesisE2eeRead($owner,storeCommand('legacy-stoicheion',$f['payload']),$session);
storeCheck($client['legacyKey']===['keyMode'=>'client','key'=>null]&&count($client['draws'])===2);
$f=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-stoicheion',$f['payload']),$session);
storeCheck($empty['legacyKey']===['keyMode'=>'empty','key'=>null]&&$empty['workspace']===null&&$empty['draws']===[]&&$empty['timelineWindows']===[]);
storeCheck(genesisFindUser($owner)['workspace_key_enc']===null);
$f=legacyStoicheionFixture('legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-stoicheion',$f['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$f=legacyStoicheionFixture('account',static function(string $id):void{
    global $db;$q=$db->prepare("INSERT INTO stoicheion_draws VALUES(?,?, 'daily',1,1,?,?)");$now=genesisNow();
    for($i=0;$i<10001;$i++)$q->execute([$id,'synthetic-'.$i,$now,$now]);
});
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-stoicheion',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
echo 'PASS e2ee-legacy-stoicheion '.$checks.' cumulative assertions; exact owner history under signed lease, no quota authority'.PHP_EOL;
