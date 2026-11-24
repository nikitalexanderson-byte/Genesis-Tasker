<?php
declare(strict_types=1);

// CLI transport for synthetic cross-client acceptance. Production store/ACL/
// signature/transaction code is unchanged; this is not an HTTP-policy test.
if (PHP_SAPI !== 'cli') exit(1);
$options=getopt('', ['dir:']);
$directory=str_replace('\\','/',(string)($options['dir']??''));
$marker=json_decode((string)file_get_contents($directory.'/owner.json'),true,16,JSON_THROW_ON_ERROR);
if (($marker['synthetic']??false)!==true || ($marker['directory']??'')!==$directory
    || !hash_equals((string)$marker['configSha256'],(string)hash_file('sha256',$directory.'/config.php'))) throw new RuntimeException('Owned fixture required');
define('GENESIS_LOCAL_TEST_CONFIG',$directory.'/config.php');
foreach (['bootstrap','repository','shared-projects','e2ee-store','e2ee-membership-atomic-apply'] as $module) require_once dirname(__DIR__,2).'/server/src/'.$module.'.php';
if(genesisConfig()['db_path']!==$directory.'/genesis.sqlite')throw new RuntimeException('Fixture database mismatch');
$users=json_decode((string)file_get_contents($directory.'/users.json'),true,16,JSON_THROW_ON_ERROR)['users'];
$raw=stream_get_contents(STDIN,16*1024*1024+1);
if(strlen($raw)>16*1024*1024)throw new RuntimeException('SYNTHETIC_INPUT_LIMIT');
$input=json_decode($raw,true,128,JSON_THROW_ON_ERROR);
$tier=(string)($input['actor']??'');
if(!in_array($tier,['business','premium','premium4life'],true))throw new RuntimeException('Synthetic actor required');
$actor=$users[$tier]['id'];$owner=$users['business']['id'];$session=hash('sha256','synthetic-membership-session:'.$actor);
$db=genesisDb();$scopeId=(string)($input['scopeId']??'');$body=$input['body']??[];
try {
    $result=match($input['action']??'') {
        'bootstrap'=>genesisE2eeBootstrap($actor,$body),
        'command'=>genesisE2eeExecute($actor,$body,$session),
        'read'=>genesisE2eeRead($actor,$body,$session),
        'directory'=>genesisE2eeDirectory($actor,$scopeId),
        'source'=>['sourceHash'=>genesisE2eeSourceHash($db,genesisE2eeScope($actor,$scopeId))],
        'manifest'=>genesisE2eeManifest($db,genesisE2eeScope($actor,$scopeId)),
        'challenge'=>genesisE2eeCreateChallenge($actor,$scopeId,$session,$body),
        'begin'=>genesisMembershipAtomicBegin($actor,$body),
        'page'=>genesisMembershipAtomicStagePage($actor,$body),
        'preview'=>genesisMembershipAtomicPreview($actor,$body),
        'seal'=>genesisMembershipAtomicSeal($actor,$body),
        'commit'=>genesisMembershipAtomicCommit($actor,$body,$session),
        'setup'=>membershipClientsSetup($db,$owner,$users),
        'plan'=>membershipClientsPlan($db,$actor,$body),
        default=>throw new RuntimeException('Unknown synthetic action'),
    };
    echo json_encode(['ok'=>true,'value'=>$result],JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
} catch(Throwable $error) {
    $code=$error->getMessage();
    if(!preg_match('/\A[A-Z][A-Z0-9_]{1,100}\z/D',$code))throw $error;
    echo json_encode(['ok'=>false,'error'=>$code],JSON_THROW_ON_ERROR);
}

function membershipClientsSetup(PDO $db,string $owner,array $users):array {
    $now=genesisNow();$space='clients-space';$projects=['clients-inbox','clients-project'];
    $db->prepare('INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$space,'Synthetic client history',$owner,$now,$now]);
    foreach($projects as $project)$db->prepare('INSERT INTO shared_projects(id,space_id,title,created_by,is_inbox,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([$project,$space,'Synthetic client project',$owner,(int)($project===$projects[0]),$now,$now]);
    foreach(['business'=>'owner','premium'=>'member','premium4life'=>'member'] as $tier=>$role) {
        $id=$users[$tier]['id'];$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$space,$id,$role,$now]);
        foreach($projects as $project)$db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$project,$id,$role,$now]);
    }
    return ['ownerId'=>$owner,'memberId'=>$users['premium']['id'],'newcomerId'=>$users['premium4life']['id'],'spaceId'=>$space,'projectId'=>$projects[1],'inboxId'=>$projects[0]];
}

function membershipClientsPlan(PDO $db,string $actor,array $body):array {
    $operation=['kind'=>'project-grants','spaceId'=>'clients-space','userId'=>$body['userId'],'allProjects'=>false,'grants'=>[]];
    $db->beginTransaction();
    try {$snapshot=genesisMembershipOperationSnapshot($db,$actor,'clients-space',$operation);$effects=genesisMembershipOperationPlan($snapshot,$operation);$fingerprint=genesisMembershipOperationFingerprint($snapshot,$operation);}
    finally {$db->rollBack();}
    $anchors=[];
    foreach($effects['requiredScopes'] as $scope) {
        $root=$scope['root'];$kind=str_starts_with($root['entityId'],'space:')?'space':'project';
        $anchors[]=['scopeId'=>$scope['scopeId'],'ownerId'=>$scope['ownerId'],'kind'=>$kind,'resourceId'=>substr($root['entityId'],strpos($root['entityId'],':')+1),
            'generation'=>$root['generation'],'directoryRevision'=>$root['directoryRevision'],'checkpointHash'=>$root['checkpointHash'],'entityId'=>$root['entityId'],'revision'=>$root['revision'],'payloadHash'=>$root['payloadHash'],'productIndexHash'=>$root['productIndexHash']];
    }
    $pages=[];
    foreach(['operation'=>[array_diff_key($operation,['grants'=>true])],'acl'=>$effects['changes'],'anchors'=>$anchors,'clear-assignments'=>$effects['clearAssignments'],'revoke-invitations'=>$effects['revokeInvitations'],'role-events'=>$effects['roleEvents']] as $kind=>$items)
        foreach(array_chunk($items,200) as $items)$pages[]=['kind'=>$kind,'items'=>$items];
    $refs=[];foreach($pages as $index=>$page)$refs[]=genesisMembershipAtomicPageRef($index,$page);
    $plan=genesisMembershipAtomicPlan(['format'=>'genesis-membership-atomic-plan-v2','actorId'=>$actor,'intentId'=>$body['intentId'],'spaceId'=>'clients-space','reviewFingerprint'=>$fingerprint,'scopeIds'=>$effects['scopeIds'],'pages'=>$refs]);
    return ['plan'=>$plan,'pages'=>$pages];
}
