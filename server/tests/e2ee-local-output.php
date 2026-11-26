<?php
declare(strict_types=1);
require __DIR__.'/e2ee-legacy-workspace.php';

// Only an empty cloud account is seeded. Device-only private content has no
// server table/file/fixture representation; the server cannot verify plaintext
// completeness and cannot gain a key or authority from the zero object count.
$fixture=legacyWorkspaceFixture('legacy',false,null,static function(string $id)use($db):void{
    $db->prepare('DELETE FROM projects WHERE user_id=?')->execute([$id]);
    $db->prepare('DELETE FROM categories WHERE user_id=?')->execute([$id]);
});
$scope=genesisE2eeScope($owner,$scopeId);$manifest=genesisE2eeManifest($db,$scope);storeCheck($manifest['objectCount']===0);
$proof=['migrationId'=>$fixture['payload']['migrationId'],'fence'=>1,'manifestHash'=>$manifest['manifestHash'],'objectCount'=>0,'verifiedCheckpoint'=>$scope['checkpoint_hash']];
$commit=$proof+['generation'=>(int)$scope['generation']];
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-commit',$commit),$session),'E2EE_MIGRATION_UNVERIFIED');
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-verify',array_replace($proof,['objectCount'=>-1])),$session),'E2EE_INVALID_COMMAND');
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-verify',array_replace($proof,['objectCount'=>'0'])),$session),'E2EE_INVALID_INTEGER');
storeReject(fn()=>genesisE2eeExecute($owner,storeCommand('migration-verify',array_replace($proof,['manifestHash'=>storeB64(random_bytes(32))])),$session),'E2EE_MANIFEST_MISMATCH');
$packet=storeCommand('migration-verify',$proof);$bad=$packet;$bad['signature']=storeB64(random_bytes(64));
storeReject(fn()=>genesisE2eeExecute($owner,$bad,$session),'E2EE_UNTRUSTED_COMMAND');
storeCheck(genesisE2eeExecute($owner,$packet,$session)['state']==='verified');
storeReject(fn()=>genesisE2eeExecute('foreign-owner',storeCommand('migration-commit',$commit),$session),'E2EE_SCOPE_FORBIDDEN');
storeCheck(genesisE2eeExecute($owner,storeCommand('migration-commit',$commit),$session)['state']==='active');
storeCheck(genesisE2eeManifest($db,genesisE2eeScope($owner,$scopeId))['objectCount']===0&&genesisFindUser($owner)['workspace_key_enc']===null);
storeReject(fn()=>genesisE2eeLegacyRequestGate('GET','sync/tasks',$owner),'E2EE_UPGRADE_REQUIRED');
echo 'PASS e2ee-local-output '.$checks.' cumulative assertions; signed empty remote manifest still requires owner/device/lease/proof and cannot restore legacy IO or a server key'.PHP_EOL;
