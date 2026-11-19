<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';
require_once dirname(__DIR__).'/src/shared-content-storage.php';

function legacyRemindersFixture(?callable $change=null):array
{
    global $db;
    return legacyWorkspaceFixture('legacy',false,null,static function(string $owner)use($db,$change):void{
        $old='2026-01-01T00:00:00Z';$device='device-'.$owner;$delivery='delivery-'.$owner;
        $plan='{ "version":1, "rows":[], "unknownOptional":"preserve verbatim" }';
        $target='{ "id":"private-occurrence", "futureField":"no projection" }';
        $db->prepare('INSERT INTO habit_reminder_profiles VALUES(?,?,?,?,?,?,?,?)')->execute([$owner,genesisSharedContentEncrypt($plan),hash('sha256',$plan),11,3,$old,1,$old]);
        $db->prepare('INSERT INTO habit_reminder_devices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$device,$owner,'opaque-device-key',genesisSharedContentEncrypt('{"endpoint":"https://push.example.invalid/synthetic-authority"}'),0,'old-uncertain-request',str_repeat('a',64),'Europe/Moscow',24,15,8,$old,$old]);
        $db->prepare('INSERT INTO habit_reminder_deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$delivery,$owner,$device,3,str_repeat('b',64),genesisSharedContentEncrypt($target),$old,$old,'failed',null,$old,null,'OLD_FAILURE',$old,$old]);
        $db->prepare('INSERT INTO advice_notification_devices VALUES(?,?,?,?,?,?)')->execute(['advice-'.$device,$owner,hash('sha256',$owner),genesisSharedContentEncrypt('{"endpoint":"https://push.example.invalid/advice-authority"}'),$old,$old]);
        $db->prepare('INSERT INTO advice_notification_days VALUES(?,?,?,?,?,?,?,?)')->execute([$owner,'2026-01-01','advice-'.str_repeat('c',24),'aurora','09:00','Europe/Moscow',$old,$old]);
        $db->prepare('INSERT INTO advice_notification_deliveries VALUES(?,?,?,?,?,?,?,?,?)')->execute(['advice-'.$delivery,$owner,'advice-'.$device,'2026-01-01','cancelled',null,'OLD_CANCEL',$old,$old]);
        $db->prepare('INSERT INTO shared_notification_preferences VALUES(?,?,?,?)')->execute([$owner,'{ "push":false, "unknownOptional":"retain" }',4,$old]);
        if($change)$change($owner);
    });
}
function remindersPage(array $fixture,string $table,int $offset=0):array
{
    global $owner,$session;
    return genesisE2eeRead($owner,storeCommand('legacy-reminders',$fixture['payload']+['table'=>$table,'offset'=>$offset]),$session);
}
$tables=['habitProfiles'=>'habit_reminder_profiles','habitDevices'=>'habit_reminder_devices','habitDeliveries'=>'habit_reminder_deliveries',
    'adviceDays'=>'advice_notification_days','adviceDeliveries'=>'advice_notification_deliveries','sharedPreferences'=>'shared_notification_preferences'];
$foreign=legacyRemindersFixture();$foreignOwner=$owner;$fixture=legacyRemindersFixture();
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$jobs=(int)$db->query('SELECT COUNT(*) FROM background_jobs')->fetchColumn();$pages=[];
foreach($tables as $name=>$table){
    $page=remindersPage($fixture,$name);$pages[$name]=$page;
    storeCheck($page['table']===$name&&$page['offset']===0&&$page['nextOffset']===null&&$page['ownerId']===$owner&&$page['sourceHash']===$before);
    storeCheck($page['totals']===array_fill_keys(array_keys($tables),1)&&count($page['rows'])===1&&$page['legacyKey']===['keyMode'=>'empty','key'=>null]);
    $expected=array_values(array_diff(array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(),'name'),['user_id']));
    if($name==='habitProfiles')$expected[]='plan_json';if($name==='habitDeliveries')$expected[]='target_json';$actual=array_keys($page['rows'][0]);sort($expected);sort($actual);storeCheck($expected===$actual);
    storeCheck(!str_contains(genesisE2eeJson($page),$foreignOwner)&&!str_contains(genesisE2eeJson($page),'https://push.example.invalid'));
    foreach(['identity','billing','sessions','workspace_key_enc','advice_notification_devices']as $field)storeCheck(!array_key_exists($field,$page));
    storeCheck(remindersPage($fixture,$name)===$page&&remindersPage($fixture,$name,1)['rows']===[]&&!$db->inTransaction());
}
storeCheck($pages['habitProfiles']['rows'][0]['plan_json']==='{ "version":1, "rows":[], "unknownOptional":"preserve verbatim" }');
storeCheck($pages['habitDeliveries']['rows'][0]['target_json']==='{ "id":"private-occurrence", "futureField":"no projection" }');
storeCheck($pages['habitDevices']['rows'][0]['enabled']===0&&$pages['habitDeliveries']['rows'][0]['state']==='failed'&&$pages['adviceDeliveries']['rows'][0]['state']==='cancelled');
storeCheck($pages['sharedPreferences']['rows'][0]['settings_json']==='{ "push":false, "unknownOptional":"retain" }');
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&$jobs===(int)$db->query('SELECT COUNT(*) FROM background_jobs')->fetchColumn()&&genesisFindUser($owner)['workspace_key_enc']===null);
$packet=storeCommand('legacy-reminders',$fixture['payload']+['table'=>'habitProfiles','offset'=>0]);
storeReject(fn()=>genesisE2eeRead($foreignOwner,$packet,$session),'E2EE_SCOPE_FORBIDDEN');
$tampered=$packet;$tampered['command']['payload']['table']='habitDevices';storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
foreach(['migrationId'=>'foreign','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $name=>$value)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-reminders',array_replace($fixture['payload'],[$name=>$value])+['table'=>'habitProfiles','offset'=>0]),$session),'E2EE_MIGRATION_FENCED');
foreach([['table'=>'users','offset'=>0],['table'=>'habitDevices','offset'=>2]]as $wrong)storeReject(fn()=>remindersPage($fixture,$wrong['table'],$wrong['offset']),'E2EE_INVALID_ENVELOPE');
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-reminders',$fixture['payload']+['table'=>'habitDevices','offset'=>0,'limit'=>1000]),$session),'E2EE_INVALID');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>remindersPage($fixture,'habitProfiles'),'E2EE_REVOKED_DEVICE');$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
foreach($tables as $table)storeReject(fn()=>$db->prepare('DELETE FROM '.$table.' WHERE user_id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);storeReject(fn()=>remindersPage($fixture,'habitProfiles'),'E2EE_MIGRATION_FENCED');
$empty=legacyWorkspaceFixture('legacy',false);foreach(array_keys($tables)as $table){$page=remindersPage($empty,$table);storeCheck($page['rows']===[]&&$page['totals']===array_fill_keys(array_keys($tables),0));}
$bad=legacyRemindersFixture(static fn(string $id)=>$db->prepare('UPDATE habit_reminder_profiles SET encrypted_plan=? WHERE user_id=?')->execute(['genesis-content-v1:broken',$id]));
storeReject(fn()=>remindersPage($bad,'habitProfiles'),'E2EE_REMINDER_SOURCE_CORRUPT');storeCheck(!$db->inTransaction());
$bad=legacyRemindersFixture(static fn(string $id)=>$db->prepare('UPDATE habit_reminder_deliveries SET encrypted_target=? WHERE user_id=?')->execute(['genesis-content-v1:broken',$id]));
storeReject(fn()=>remindersPage($bad,'habitDeliveries'),'E2EE_REMINDER_SOURCE_CORRUPT');
// Preserve raw duplicate property names; only the shared strict client parser
// decides whether this old record can be reconciled without losing a field.
$duplicate=legacyRemindersFixture(static fn(string $id)=>$db->prepare('UPDATE habit_reminder_profiles SET encrypted_plan=? WHERE user_id=?')->execute([genesisSharedContentEncrypt('{"rows":[],"rows":[1]}'),$id]));
storeCheck(remindersPage($duplicate,'habitProfiles')['rows'][0]['plan_json']==='{"rows":[],"rows":[1]}');
$large=legacyRemindersFixture(static function(string $id)use($db):void{
    $q=$db->prepare('INSERT INTO habit_reminder_deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    genesisBeginWriteTransaction($db);try{for($i=0;$i<140;$i++){$key=str_pad((string)$i,4,'0',STR_PAD_LEFT);$q->execute(['paged-'.$id.'-'.$key,$id,'device-'.$id,3,hash('sha256',$key),genesisSharedContentEncrypt('{"id":"'.$key.'","raw":"'.str_repeat('x',70000).'"}'),'2026-01-01','2026-01-01','sent','2026-01-01',null,null,null,'2026-01-01','2026-01-01']);}$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw$e;}
});
$ids=[];$offset=0;$count=0;$size=0;
do{$page=remindersPage($large,'habitDeliveries',$offset);$count++;$bytes=strlen(genesisE2eeJson($page));$size+=$bytes;storeCheck($bytes<8*1024*1024&&$page['totals']['habitDeliveries']===141);
    foreach($page['rows']as $row){storeCheck(!isset($ids[$row['id']]));$ids[$row['id']]=true;storeCheck(is_string($row['target_json'])&&is_string($row['encrypted_target']));}
    $offset=$page['nextOffset'];
}while($offset!==null);
storeCheck(count($ids)===141&&$count>2&&$size>16*1024*1024);
// Raw stored bytes fit one page; transformed output does not. Never return an
// over-budget page by appending plaintext after the common page limiter.
$oversize=legacyRemindersFixture(static fn(string $id)=>$db->prepare('UPDATE habit_reminder_profiles SET encrypted_plan=? WHERE user_id=?')->execute(['{"raw":"'.str_repeat('x',5*1024*1024).'"}',$id]));
storeReject(fn()=>remindersPage($oversize,'habitProfiles'),'E2EE_SOURCE_TOO_LARGE');storeCheck(!$db->inTransaction());
echo 'PASS e2ee-legacy-reminders '.$checks.' cumulative assertions; all six signed owner tables, inert grants, expired jobs, exact JSON and transformed page limits'.PHP_EOL;
