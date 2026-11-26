<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

function legacyDiaryFixture(?callable $mutate=null,string $mode='account',bool $notes=true):array
{
    global $db;
    return legacyWorkspaceFixture($mode,false,null,static function(string $id)use($db,$mutate,$notes):void{
        $now=genesisNow();
        if($notes){
            $db->prepare('INSERT INTO personal_diary_notes VALUES(?,?,?,?,?,?,?,?)')->execute([$id,'private-dream',3,1,base64_encode(random_bytes(12)),base64_encode(random_bytes(160)),hash('sha256','synthetic payload'),$now]);
            $db->prepare('INSERT INTO personal_diary_dreams VALUES(?,?,?,?)')->execute([$id,'private-dream','2024-02-29','Europe/Moscow']);
            $db->prepare('INSERT INTO personal_diary_advice_references VALUES(?,?,?)')->execute([$id,'private-dream','private-advice-history']);
        }
        $db->prepare('INSERT INTO personal_diary_deletions VALUES(?,?,?,?,?)')->execute([$id,'deleted-remote',5,0,$now]);
        $db->prepare('INSERT INTO personal_diary_deletions VALUES(?,?,?,?,?)')->execute([$id,'kept-local',8,1,$now]);
        // Deliberately model a pre-existing inconsistent source. Migration must
        // retain notes, never invoke the ordinary sync-disabled purge helper.
        $db->prepare('INSERT INTO personal_diary_settings VALUES(?,?,?,?,?,?)')->execute([$id,0,2,hash('sha256','synthetic privacy command'),7,$now]);
        $db->prepare('INSERT INTO dream_journal_preferences VALUES(?,?,?,?)')->execute([$id,'morning',2,$now]);
        if($mutate)$mutate($id);
    });
}
$foreign=legacyDiaryFixture();$foreignOwner=$owner;
$fixture=legacyDiaryFixture();$sourceHash=$fixture['payload']['sourceHash'];$packet=storeCommand('legacy-diary',$fixture['payload']);
$before=$db->query('SELECT total_changes()')->fetchColumn();$result=genesisE2eeRead($owner,$packet,$session);
storeCheck($result['ownerId']===$owner&&$result['legacyKey']===['keyMode'=>'account','key'=>$fixture['raw']]);
storeCheck($result['notes'][0]['id']==='private-dream'&&$result['settings'][0]['sync_enabled']===0&&count($result['deletions'])===2);
storeCheck($result['dreams'][0]===['note_id'=>'private-dream','dream_day'=>'2024-02-29','time_zone'=>'Europe/Moscow']);
storeCheck($result['dreamSettings'][0]['today_mode']==='morning'&&$result['adviceReferences'][0]['advice_id']==='private-advice-history');
$q=$db->prepare('SELECT ciphertext FROM personal_diary_notes WHERE user_id=? AND id=?');$q->execute([$owner,'private-dream']);$ownCipher=$q->fetchColumn();$q->closeCursor();
$q->execute([$foreignOwner,'private-dream']);$foreignCipher=$q->fetchColumn();$q->closeCursor();
storeCheck($ownCipher!==$foreignCipher&&$result['notes'][0]['ciphertext']===$ownCipher&&!str_contains(genesisE2eeJson($result),$foreignCipher));
foreach(['sessions','identity','billing','orders','refresh_token_enc','workspace_key_enc']as $field)storeCheck(!array_key_exists($field,$result));
// The actual schema is the oracle for completeness, including opaque historical
// payload/command hashes. These fields never become live execution grants.
foreach(['notes'=>'personal_diary_notes','deletions'=>'personal_diary_deletions','settings'=>'personal_diary_settings','dreams'=>'personal_diary_dreams','dreamSettings'=>'dream_journal_preferences','adviceReferences'=>'personal_diary_advice_references']as $name=>$table){
    $expected=array_values(array_diff(array_column($db->query('PRAGMA table_info('.$table.')')->fetchAll(),'name'),['user_id']));
    $actual=array_keys($result[$name][0]);sort($expected);sort($actual);storeCheck($expected===$actual);
}
storeCheck($sourceHash===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));
storeCheck((int)$db->query('SELECT total_changes()')->fetchColumn()-(int)$before===1);
storeCheck(genesisE2eeRead($owner,$packet,$session)===$result&&!$db->inTransaction());
storeReject(fn()=>genesisE2eeRead($foreignOwner,$packet,$session),'E2EE_SCOPE_FORBIDDEN');
foreach(['migrationId'=>'foreign-migration','fence'=>2,'sourceHash'=>storeB64(random_bytes(32))]as $field=>$wrong)
    storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',array_replace($fixture['payload'],[$field=>$wrong])),$session),'E2EE_MIGRATION_FENCED');
$tampered=$packet;$tampered['signature']=storeB64(random_bytes(64));storeReject(fn()=>genesisE2eeRead($owner,$tampered,$session),'E2EE_UNTRUSTED_COMMAND');
$db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=?')->execute([$scopeId]);storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_REVOKED_DEVICE');
$db->prepare('UPDATE e2ee_devices SET revoked=0 WHERE scope_id=?')->execute([$scopeId]);
foreach(['personal_diary_notes'=>'payload_hash','personal_diary_deletions'=>'updated_at','personal_diary_settings'=>'command_hash','personal_diary_dreams'=>'time_zone','dream_journal_preferences'=>'updated_at','personal_diary_advice_references'=>'advice_id']as $table=>$field)
    storeReject(fn()=>$db->prepare('UPDATE '.$table.' SET '.$field.'=? WHERE user_id=?')->execute(['changed',$owner]),'E2EE_LEGACY_WRITE_FORBIDDEN');
genesisE2eeExecute($owner,storeCommand('migration-cancel',['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1]),$session);
storeReject(fn()=>genesisE2eeRead($owner,$packet,$session),'E2EE_MIGRATION_FENCED');
$fixture=legacyWorkspaceFixture('legacy',false);$empty=genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session);
foreach(['notes','deletions','settings','dreams','dreamSettings','adviceReferences']as $field)storeCheck($empty[$field]===[]);
storeCheck($empty['legacyKey']===['keyMode'=>'empty','key'=>null]&&genesisFindUser($owner)['workspace_key_enc']===null);
$fixture=legacyDiaryFixture(null,'account',false);storeCheck(genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session)['legacyKey']===['keyMode'=>'empty','key'=>null]);
$fixture=legacyDiaryFixture(null,'client');storeCheck(genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session)['legacyKey']===['keyMode'=>'client','key'=>null]);
$fixture=legacyDiaryFixture(null,'legacy');storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$fixture=legacyDiaryFixture(static function(string $id)use($db):void{$db->prepare('UPDATE users SET workspace_key_enc=? WHERE id=?')->execute([base64_encode('corrupt old key'),$id]);});
storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session),'E2EE_LEGACY_KEY_UNAVAILABLE');
$fixture=legacyDiaryFixture();$old=$fixture['payload']['sourceHash'];$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute([$scopeId]);
$db->prepare('UPDATE dream_journal_preferences SET today_mode=? WHERE user_id=?')->execute(['all-day',$owner]);
storeCheck($old!==genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId)));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session),'E2EE_MIGRATION_FENCED');
$fixture=legacyDiaryFixture(static function(string $id)use($db):void{
    genesisBeginWriteTransaction($db);try{$q=$db->prepare('INSERT INTO personal_diary_deletions VALUES(?,?,?,?,?)');
        for($i=0;$i<10000;$i++)$q->execute([$id,'old-'.$i,2,1,genesisNow()]);$db->commit();}
    catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw$error;}
});
$limit=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($limit===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
$fixture=legacyDiaryFixture(static function(string $id)use($db):void{$db->prepare('UPDATE personal_diary_settings SET command_hash=? WHERE user_id=?')->execute([str_repeat('а',3*1024*1024),$id]);});
$limit=genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId));storeReject(fn()=>genesisE2eeRead($owner,storeCommand('legacy-diary',$fixture['payload']),$session),'E2EE_SOURCE_TOO_LARGE');
storeCheck($limit===genesisE2eeSourceHash($db,genesisE2eeScope($owner,$scopeId))&&!$db->inTransaction());
echo 'PASS e2ee-legacy-diary '.$checks.' cumulative assertions; exact signed owner-only notes/dreams/tombstones/privacy/history, no helper side effects or implicit entitlement'.PHP_EOL;
