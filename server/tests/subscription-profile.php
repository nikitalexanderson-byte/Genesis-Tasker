<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/google.php';
require dirname(__DIR__).'/src/shared-projects.php';
require dirname(__DIR__).'/src/subscriptions.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated fixture required');
$db=genesisDb();$id='plan-profile-'.bin2hex(random_bytes(4));$other=$id.'-other';
foreach([$id,$other]as$user)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$user,$user,$user.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
try{
 foreach(GENESIS_SUBSCRIPTION_PLANS as$plan){
  // Elite+ is a public plan ID backed by the compatible lifetime storage enum.
  $db->prepare('UPDATE users SET subscription_plan=?,forecast_elite_plus=? WHERE id=?')
   ->execute([$plan==='elite_plus'?'premium4life':$plan,$plan==='elite_plus'?1:0,$id]);
  $profile=genesisUserForClient(genesisFindUser($id));
  if($profile['uid']!==$id||$profile['subscriptionPlan']!==$plan)throw new RuntimeException('Own profile reports wrong plan');
  if(genesisUserForClient(genesisFindUser($other))['subscriptionPlan']!=='free')throw new RuntimeException('Plan leaked across accounts');
  if($profile['isAdmin'])throw new RuntimeException('Subscription metadata granted administrator rights');
 }
 echo "Own account profile: all real subscription values including Elite+, identity isolation and unchanged privileges passed.\n";
}finally{foreach([$id,$other]as$user)$db->prepare('DELETE FROM users WHERE id=?')->execute([$user]);}
