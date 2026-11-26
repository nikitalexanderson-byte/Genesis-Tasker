<?php
declare(strict_types=1);
require __DIR__.'/e2ee-store.php';
require_once dirname(__DIR__).'/src/e2ee-legacy-transport.php';
$fixture=json_decode((string)file_get_contents(dirname(__DIR__,2).'/tests/fixtures/e2ee/legacy-transport-v1.json'),true,32,JSON_THROW_ON_ERROR);
foreach($fixture['cases'] as $case)
    storeCheck(genesisE2eePersonalTransportProtected($case['method'],$case['path'],$case['body']??null)===$case['protected']);
try {
    $_SERVER['HTTP_X_GENESIS_ACCOUNT_ID']='other-owner';
    storeReject(fn()=>genesisE2eeEnforceLegacyRoute('POST','billing/orders',$owner),'E2EE_ACCOUNT_CHANGED');
    storeReject(fn()=>genesisE2eeEnforceLegacyRoute('POST','workspace',$owner),'E2EE_ACCOUNT_CHANGED');
    $_SERVER['HTTP_X_GENESIS_ACCOUNT_ID']=$owner;genesisE2eeEnforceLegacyRoute('POST','billing/orders',$owner);
} finally { unset($_SERVER['HTTP_X_GENESIS_ACCOUNT_ID']); }

// Exercise actual post-cutover middleware and domain API, not just regex parity.
foreach(['sync/tasks','advice/saved','billing/modeling/results/synthetic','assistant/spellcheck','assistant/spelling'] as $route)
    foreach(['GET','POST'] as $method)storeReject(fn()=>genesisE2eeEnforceLegacyRoute($method,$route,$owner),'E2EE_UPGRADE_REQUIRED');
foreach(['session','billing/catalog','billing/orders','billing/modeling/orders/synthetic','account/preferences','e2ee/v1/status'] as $route)
    genesisE2eeEnforceLegacyRoute('GET',$route,$owner);
foreach(['advicePreferences'=>['enabled'=>true],'uiLayout'=>['collapsed'=>true],'uiVisibility'=>['tasks'=>true],'syncRouting'=>[],
    'futurePrivateField'=>'synthetic'] as $key=>$value) {
    $before=genesisFindUser($owner);
    storeReject(fn()=>genesisUpdateAccountPreferences($owner,[$key=>$value]),'E2EE_UPGRADE_REQUIRED');
    storeCheck(genesisFindUser($owner)===$before);
}
genesisUpdateAccountPreferences($owner,['language'=>'ru']);storeCheck(genesisFindUser($owner)['language']==='ru');
$before=genesisFindUser($owner);$profile=genesisUserForClient($before);
foreach(['advicePreferences','uiVisibility','syncRouting'] as $key)storeCheck(!array_key_exists($key,$profile));
storeCheck($profile['privatePreferencesMode']==='e2ee' && $profile['uid']===$owner && isset($profile['featureAccess']));
storeCheck(genesisFindUser($owner)===$before);

// Ordinary legacy and live-lease states remain distinct. Private no-op patches
// are still writes at the public API even if SQLite row bytes would be identical.
$legacy='legacy-transport-owner';$now=genesisNow();
$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    ->execute([$legacy,'legacy-transport-sub','transport@example.invalid','Synthetic transport',$now,$now]);
genesisUpdateAccountPreferences($legacy,['advicePreferences'=>['enabled'=>false]]);
$before=genesisFindUser($legacy);genesisE2eeEnforceLegacyRoute('GET','advice/saved',$legacy);
storeCheck(array_key_exists('advicePreferences',genesisUserForClient($before)));
$db->prepare("INSERT INTO e2ee_scopes(scope_id,kind,resource_id,owner_id,state,directory_revision,checkpoint_hash,crypto_epoch,security_epoch,key_id,generation,recovery_signing_key,recovery_receiving_key,recovery_kit,recovery_capsule,created_at,updated_at) VALUES(?, 'personal', ?, ?, 'preparing', 1, 'genesis', 1, 1, 'root', 1, 'synthetic', 'synthetic', '{}', '{}', ?, ?)")
    ->execute(['personal:'.$legacy,$legacy,$legacy,$now,$now]);
$db->prepare('INSERT INTO e2ee_migrations(scope_id,migration_id,device_id,source_hash,fence,lease_until,target_generation) VALUES(?,?,?,?,?,?,?)')
    ->execute(['personal:'.$legacy,'transport-lease','synthetic-device','source',1,time()+300,1]);
storeReject(fn()=>genesisUpdateAccountPreferences($legacy,['advicePreferences'=>['enabled'=>false]]),'E2EE_UPGRADE_REQUIRED');
storeCheck(genesisFindUser($legacy)===$before);
genesisUpdateAccountPreferences($legacy,['language'=>'en']);storeCheck(genesisFindUser($legacy)['language']==='en');
$db->prepare('UPDATE e2ee_migrations SET lease_until=0 WHERE scope_id=?')->execute(['personal:'.$legacy]);
genesisUpdateAccountPreferences($legacy,['advicePreferences'=>['enabled'=>true]]);
storeCheck(genesisUserAdvicePreferences(genesisFindUser($legacy))['enabled']===true);
echo 'PASS e2ee-legacy-transport '.$checks.' cumulative assertions; PHP/web/native vectors, private GETs, authority separation and preference fences.'.PHP_EOL;
