<?php
declare(strict_types=1);
require_once __DIR__ . '/e2ee-policy.php';
require_once __DIR__ . '/e2ee-store.php';

function genesisE2eePilotAllowed(string $userId): bool
{
    $config=genesisConfig();
    return ($config['e2ee_v1_enabled']??false)===true && in_array($userId,$config['e2ee_v1_pilot_users']??[],true);
}
function genesisE2eeRoute(string $method,string $path): never
{
    $owner=genesisRequireUserId();
    header('Cache-Control: no-store');
    genesisConsumeApiBudget($owner,'e2ee-v1',600,128*1024*1024,(int)($_SERVER['CONTENT_LENGTH']??0));
    if($method==='GET'&&$path==='e2ee/v1/status') {
        $q=genesisDb()->prepare("SELECT scope_id AS scopeId,kind,resource_id AS resourceId,state FROM e2ee_scopes s WHERE
          owner_id=? OR EXISTS(SELECT 1 FROM e2ee_devices d WHERE d.scope_id=s.scope_id AND d.user_id=? AND d.revoked=0) ORDER BY scope_id");
        $q->execute([$owner,$owner]);$scopes=$q->fetchAll();$q->closeCursor();
        genesisJson(['pilotAllowed'=>genesisE2eePilotAllowed($owner),'scopes'=>$scopes,'cryptoProtocol'=>1]);
    }
    if($method!=='POST')genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
    genesisRequireCsrf();$body=genesisReadJson();
    if($path==='e2ee/v1/bootstrap') {
        if(!genesisE2eePilotAllowed($owner))throw new GenesisResourceLimitException(503,'E2EE_PILOT_DISABLED');
        if(!is_int($_SESSION['authenticated_at']??null) || $_SESSION['authenticated_at']<time()-300 || $_SESSION['authenticated_at']>time())
            throw new GenesisResourceLimitException(401,'E2EE_REAUTH_REQUIRED');
        genesisJson(genesisE2eeBootstrap($owner,$body));
    }
    $binding=(string)($_SESSION['auth_login_id']??'');
    if(strlen($binding)<16)throw new GenesisResourceLimitException(401,'E2EE_REAUTH_REQUIRED');
    if(in_array($path,['e2ee/v1/membership-state','e2ee/v1/membership-preview','e2ee/v1/membership'],true)){
        require_once __DIR__.'/e2ee-membership.php';
        genesisJson(match($path){'e2ee/v1/membership-state'=>genesisE2eeMembershipState($owner,$body),'e2ee/v1/membership-preview'=>genesisE2eeMembershipPreview($owner,$body),
            'e2ee/v1/membership'=>genesisE2eeMembershipBatch($owner,$body,$binding)});
    }
    if($path==='e2ee/v1/command') {
        $command=genesisE2eeCommand($body['command']??null);$scope=genesisE2eeScope($owner,$command['scopeId']);
        if(!in_array($scope['state'],['active','retirement'],true)&&!in_array($command['action'],['migration-cancel','migration-cancel-start'],true)&&!genesisE2eePilotAllowed($owner))
            throw new GenesisResourceLimitException(503,'E2EE_PILOT_DISABLED');
        genesisJson(genesisE2eeExecute($owner,$body,$binding));
    }
    if($path==='e2ee/v1/read')genesisJson(genesisE2eeRead($owner,$body,$binding));
    if($path==='e2ee/v1/challenge') {
        genesisE2eeExactFields($body,['scopeId','deviceId','keys']);
        genesisJson(genesisE2eeCreateChallenge($owner,genesisE2eeIdentifier($body['scopeId']),$binding,['deviceId'=>$body['deviceId'],'keys'=>$body['keys']]));
    }
    if($path==='e2ee/v1/directory'||$path==='e2ee/v1/source') {
        genesisE2eeExactFields($body,['scopeId']);$scope=genesisE2eeScope($owner,genesisE2eeIdentifier($body['scopeId']));
        if($path==='e2ee/v1/source')genesisJson(['sourceHash'=>genesisE2eeSourceHash(genesisDb(),$scope)]);
        $directory=genesisE2eeDirectory($owner,$scope['scope_id']);
        if($scope['owner_id']===$owner)$directory['recoveryCapsule']=json_decode($scope['recovery_capsule'],true,512,JSON_THROW_ON_ERROR);
        genesisJson($directory);
    }
    genesisJson(['error'=>'NOT_FOUND'],404);
}
