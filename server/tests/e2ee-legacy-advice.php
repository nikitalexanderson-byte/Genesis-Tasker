<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyAdviceFixture(?callable $alter=null):array
{
    return legacyWorkspaceFixture('legacy',false,null,static function(string $id)use($alter):void{
        global $db;$now=genesisNow();$entry=json_encode(['id'=>'advice-synthetic','body'=>'Synthetic private advice selection'],JSON_THROW_ON_ERROR);
        $db->prepare('UPDATE users SET advice_preferences_json=?,advice_collections_json=?,advice_notifications_json=?,advice_psychopompia_json=?,advice_philosophers_per_day=3 WHERE id=?')
            ->execute(['{"enabled":true,"smart":false}','["philosophers","aurora"]','{"enabled":true,"time":"11:20","timeZone":"UTC"}','{"adultConfirmed":true,"subcategories":["alcohol"]}',$id]);
        $db->prepare("INSERT INTO daily_advice_days(user_id,day_key,advice_id,entry_json,created_at,viewed_at,dismissed_at,draw_limit,selection_json) VALUES(?,'2026-11-19','advice-synthetic',?,?,?,NULL,9,'{\"smart\":true}')")
            ->execute([$id,$entry,$now,$now]);
        foreach(['daily_advice_entries'=>1,'daily_advice_extra_entries'=>7]as $table=>$slot)$db->prepare("INSERT INTO $table(user_id,day_key,slot,advice_id,entry_json,created_at,viewed_at,dismissed_at) VALUES(?,'2026-11-19',$slot,'advice-synthetic',?,?,?,NULL)")
            ->execute([$id,$entry,$now,$now]);
        $db->prepare('INSERT INTO user_metrics(user_id,project_count,task_count,open_task_count,completed_task_count,google_synced_count,habit_count,updated_at) VALUES(?,1,2,1,1,0,3,?)')->execute([$id,$now]);
        if($alter)$alter($id);
    });
}
$f=legacyAdviceFixture();$p=$f['payload'];$packet=storeCommand('legacy-advice',$p);
$before=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));$changes=$db->query('SELECT total_changes()')->fetchColumn();
$source=genesisE2eeRead($owner,$packet,$session);
storeCheck($source['ownerId']===$owner&&$source['scopeId']===$scopeId&&$source['sourceHash']===$p['sourceHash']);
storeCheck($source['preferencesJson']==='{"enabled":true,"smart":false}'&&$source['days'][0]['selectionJson']==='{"smart":true}');
storeCheck($source['collectionsJson']==='["philosophers","aurora"]'&&$source['notificationsJson']==='{"enabled":true,"time":"11:20","timeZone":"UTC"}');
storeCheck($source['psychopompiaJson']==='{"adultConfirmed":true,"subcategories":["alcohol"]}'&&$source['philosophersPerDay']===3);
storeCheck(count($source['days'])===1&&count($source['entries'])===1&&count($source['extraEntries'])===1&&$source['metrics']['habits']===3);
storeCheck($source['days'][0]['viewedAt']!==null&&$source['entries'][0]['slot']===1&&$source['extraEntries'][0]['slot']===7);
foreach(['draw_limit','dailyLimit','canNext','remaining','subscription_plan','refresh_token','workspace_key_enc','legacyKey','orders']as $field)storeCheck(!str_contains(genesisE2eeJson($source),'"'.$field.'"'));
storeCheck($before===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$changes===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$source&&!$db->inTransaction());
foreach(['advice_collections_json','advice_notifications_json','advice_psychopompia_json']as $column)
    storeReject(fn()=>$db->prepare('UPDATE users SET '.$column.'=? WHERE id=?')->execute(['{"synthetic":"changed"}',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>$db->prepare('UPDATE users SET advice_philosophers_per_day=2 WHERE id=?')->execute([$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
storeReject(fn()=>genesisE2eeRead('foreign-owner',$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'other','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-advice',array_replace($p,[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$p['migrationId'],'fence'=>1]),$session);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$cancelled=genesisE2eeScope($owner,$scopeId);$beforeCount=genesisE2eeSourceHash($db,$cancelled);
$db->prepare('UPDATE users SET advice_philosophers_per_day=2 WHERE id=?')->execute([$owner]);
storeCheck($beforeCount!==genesisE2eeSourceHash($db,$cancelled));
$f=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-advice',$f['payload']),$session);
storeCheck($empty['days']===[]&&$empty['entries']===[]&&$empty['extraEntries']===[]&&$empty['metrics']===null&&$empty['preferencesJson']==='{}');
storeCheck($empty['collectionsJson']==='["aurora"]'&&$empty['notificationsJson']==='{}'&&$empty['psychopompiaJson']==='{}'&&$empty['philosophersPerDay']===1);
storeCheck(genesisFindUser($owner)['workspace_key_enc']===null);
foreach(['advice_preferences_json','advice_collections_json','advice_notifications_json','advice_psychopompia_json']as $column){
    $f=legacyAdviceFixture(static function(string $id)use($column):void{global $db;$db->prepare('UPDATE users SET '.$column.'=? WHERE id=?')->execute([str_repeat('x',17*1024*1024),$id]);});
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-advice',$f['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
}
echo 'PASS e2ee-legacy-advice '.$checks.' cumulative assertions; exact private selections and metrics under signed owner lease, no quota/session/key authority'.PHP_EOL;
