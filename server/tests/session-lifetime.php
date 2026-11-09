<?php
declare(strict_types=1);
foreach(['bootstrap','repository','google'] as $module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated configuration required');
function sessionExpect(bool $value,string $message):void{if(!$value)throw new RuntimeException($message);}
$db=genesisDb();$id='cookie-renew-'.bin2hex(random_bytes(5));$user=null;
try{
    $user=genesisUpsertGoogleUser(['sub'=>$id,'email'=>$id.'@example.invalid','email_verified'=>true],[],false,false);
    genesisEstablishGoogleSession($user,$id);$loginId=$_SESSION['auth_login_id'];$csrf=$_SESSION['csrf'];$sid=session_id();
    $_SESSION['authenticated_at']=time()-31*86400;$authenticated=$_SESSION['authenticated_at'];
    $_SESSION['cookie_renewed_at']=time()-13*3600;
    sessionExpect(genesisCurrentUserId()===$user['id'],'Active session was rejected');
    sessionExpect($_SESSION['cookie_renewed_at']<time()-12*3600,'Identity lookup unexpectedly renewed a cookie');
    genesisRenewSessionCookie();
    sessionExpect(abs($_SESSION['cookie_renewed_at']-time())<3,'Active browser cookie was not renewed');
    sessionExpect($_SESSION['authenticated_at']===$authenticated,'Cookie renewal granted a fresh authentication');
    sessionExpect($_SESSION['auth_login_id']===$loginId&&$_SESSION['csrf']===$csrf&&session_id()===$sid,'Renewal rotated login identity, CSRF or session ID');
    $renewed=$_SESSION['cookie_renewed_at'];
    genesisRenewSessionCookie();sessionExpect($_SESSION['cookie_renewed_at']===$renewed,'Cookie was renewed on every poll');
    $params=session_get_cookie_params();sessionExpect($params['httponly']&&$params['samesite']==='Lax'&&$params['path']==='/','Cookie protection changed');
    $_SESSION['cookie_renewed_at']=time()-13*3600;$before=$_SESSION['cookie_renewed_at'];$_SESSION['auth_identity']['sub']='revoked-identity';
    genesisRenewSessionCookie();
    sessionExpect(genesisCurrentUserId()===null&&$_SESSION['cookie_renewed_at']===$before,'Revoked identity renewed or retained authentication');
    unset($_SESSION['user_id']);sessionExpect(genesisCurrentUserId()===null,'A signed-out session was restored');
    echo "Active cookie renewal, bounded frequency, unchanged authentication age/CSRF/login and revoked/signed-out session rejection passed\n";
}finally{if($user)$db->prepare('DELETE FROM users WHERE id=?')->execute([$user['id']]);}
