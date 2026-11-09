<?php
declare(strict_types=1);
// Standalone in-memory fixtures; never bootstrap a configured application database.
if(PHP_SAPI!=='cli')exit(1);
require dirname(__DIR__).'/src/resource-limits.php';
require dirname(__DIR__).'/src/feature-access.php';
$fixtureDb=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$fixtureUsers=[
    'business'=>['id'=>'business','subscription_plan'=>'business','subscription_valid_until'=>gmdate('Y-m-d\TH:i:s\Z',time()+86400)],
    'life'=>['id'=>'life','subscription_plan'=>'premium4life'],
    'free'=>['id'=>'free','subscription_plan'=>'free'],
];
// These paid-plan fixtures have no authenticated Google session or trial grant.
function genesisUserProvider(array $user):string {return 'legacy';}
function genesisSessionIsPrimaryGoogleUser(array $user):bool {return false;}
function genesisIdentifierHash(string $namespace,string $value):string {return hash_hmac('sha256',$namespace."\0".$value,'synthetic-quota-test-key');}
function genesisDb():PDO {global $fixtureDb;return $fixtureDb;}
function genesisFindUser(string $id):?array {global $fixtureUsers;return $fixtureUsers[$id]??null;}
function quotaCheck(bool $value,string $message):void {if(!$value)throw new RuntimeException($message);}
function quotaReject(callable $action,string $resource):void {
    try{$action();}catch(GenesisResourceLimitException $error){quotaCheck($error->status===403&&$error->getMessage()==='SUBSCRIPTION_QUOTA_'.$resource,'Wrong quota rejection');return;}
    throw new RuntimeException('Exceeded capacity was accepted');
}
$fixtureDb->exec("CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE linked_google_accounts(id TEXT PRIMARY KEY,owner_user_id TEXT,google_sub TEXT,email TEXT);
INSERT INTO users VALUES('business'),('life'),('free');
CREATE TABLE resource_space_owners(space_id TEXT PRIMARY KEY,user_id TEXT);
CREATE TABLE shared_projects(id TEXT PRIMARY KEY,space_id TEXT,is_inbox INTEGER,kind TEXT,parent_id TEXT);
CREATE TABLE shared_mindmaps(id TEXT PRIMARY KEY,space_id TEXT);
INSERT INTO resource_space_owners VALUES('business-a','business'),('business-b','business'),('life-a','life'),('free-a','free');");
$fixtureDb->exec((string)file_get_contents(dirname(__DIR__).'/migrations/104_subscription_trials.sql'));
quotaCheck(genesisFeatureAccessForUser($fixtureUsers['business'])['trial']['status']==='ineligible','Synthetic session unexpectedly offers a trial');
foreach(['business','life'] as $owner){
    quotaCheck(genesisFeatureLimit($owner,'mindmaps')===100,'Personal map capacity');
    $space=$owner.'-a';
    $fixtureDb->prepare("INSERT INTO shared_projects VALUES(?,?,1,'project',NULL),(?,?,0,'task-list',NULL)")->execute([$owner.'-inbox',$space,$owner.'-list',$space]);
    $project=$fixtureDb->prepare("INSERT INTO shared_projects VALUES(?,?,0,'project',NULL)");
    $map=$fixtureDb->prepare('INSERT INTO shared_mindmaps VALUES(?,?)');
    for($index=0;$index<99;$index++){
        $target=$owner==='business'&&$index%2===1?'business-b':$space;
        $project->execute([$owner.'-project-'.$index,$target]);$map->execute([$owner.'-map-'.$index,$target]);
    }
    foreach(['shared-projects','shared-mindmaps'] as $resource){
        $usage=genesisSharedOwnerResourceUsage($space,$resource);
        quotaCheck($usage===['owner'=>$owner,'count'=>99,'limit'=>100],'Owner-scoped census or independent resource limit');
        genesisRequireSharedOwnerQuota($space,$resource);
        quotaReject(fn()=>genesisRequireSharedOwnerQuota($space,$resource,2),$resource);
    }
    $project->execute([$owner.'-project-99',$space]);$map->execute([$owner.'-map-99',$space]);
    $fixtureDb->prepare("INSERT INTO shared_projects VALUES(?,?,0,'project',?)")->execute([$owner.'-child',$space,$owner.'-project-99']);
    foreach(['shared-projects','shared-mindmaps'] as $resource){
        quotaReject(fn()=>genesisRequireSharedOwnerQuota($space,$resource),$resource);
        genesisRequireSharedOwnerQuota($space,$resource,0); // Existing edits/retries consume no new slot.
    }
}
quotaCheck(!in_array('shared-projects',genesisFeatureAccessForUser($fixtureUsers['free'])['allowedFeatures'],true),'Free collaboration feature gate changed');
quotaCheck(genesisFeatureLimit('free','mindmaps')===1,'Free personal capacity changed');
echo "PASS shared plan quotas: independent 100/100/100, 99-to-100 boundary, cross-space ownership, no inbox/list charge, multi-resource isolation, zero-growth edits and preserved Free feature gate.\n";
