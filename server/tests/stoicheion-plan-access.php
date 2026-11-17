<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$worker=($argv[1]??'')==='--worker';
if($worker)$configPath=$argv[2];else{
    $fixture=sys_get_temp_dir().'/genesis-plan-draws-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
    $configPath=$fixture.'/config.php';file_put_contents($configPath,'<?php return '.var_export(['app_url'=>'https://localhost.invalid',
        'db_path'=>$fixture.'/app.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),
        'cookie_secure'=>false,'timezone'=>'Europe/Moscow'],true).';');
}
define('GENESIS_LOCAL_TEST_CONFIG',$configPath);
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';
function planDrawCheck(bool $ok,string $why):void {if(!$ok)throw new RuntimeException($why);}
function planDrawReject(string $code,callable $run):void {
    try{$run();}catch(GenesisResourceLimitException|DomainException|InvalidArgumentException $e){planDrawCheck($code===$e->getMessage(),$e->getMessage().' != '.$code);return;}
    throw new RuntimeException('Accepted '.$code);
}
if($worker){$input=json_decode($argv[3],true,16,JSON_THROW_ON_ERROR);try{genesisChangeSpreadCard('elite-plus',$input);echo 'accepted';}
    catch(GenesisResourceLimitException $e){echo $e->getMessage();}exit;}
$db=genesisDb();$stamp=genesisNow();
$golden=[['cardId'=>'mu','reversed'=>false],['cardId'=>'kappa','reversed'=>true],['cardId'=>'gamma','reversed'=>false],
    ['cardId'=>'upsilon','reversed'=>true],['cardId'=>'sigma','reversed'=>false],['cardId'=>'xi','reversed'=>false],
    ['cardId'=>'lambda','reversed'=>true],['cardId'=>'phi','reversed'=>true],['cardId'=>'tau','reversed'=>true]];
planDrawCheck(genesisSpreadBaseCards(0x12345678)===$golden,'Nine-card PHP/JavaScript golden parity');
foreach(['free','standart','premium','business','elite','elite-plus']as$id){
    $plan=in_array($id,['elite','elite-plus'],true)?'premium4life':$id;
    $db->prepare('INSERT INTO users(id,google_sub,email,subscription_plan,subscription_valid_until,forecast_elite_plus,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        ->execute([$id,$id,$id.'@example.invalid',$plan,gmdate('Y-m-d\TH:i:s\Z',time()+3600),$id==='elite-plus'?1:0,$stamp,$stamp]);
    $user=genesisFindUser($id);$included=in_array($id,['premium','business','elite','elite-plus'],true);
    planDrawCheck(genesisForecastFreeAccess($user)===$included,'Incorrect included method: '.$id);
    $access=genesisResolveFeatureAccess($user,genesisFeatureAccessPolicy(),time());
    planDrawCheck(in_array('future-modeling',$access['allowedFeatures'],true)===$included,'Feature access did not follow plan: '.$id);
    if(in_array($id,['premium','business'],true)){
        planDrawCheck(!in_array('future-modeling',$access['freeFeatures'],true),'Timed feature leaked into Free');
        planDrawCheck(!genesisForecastFreeAccess($user,time()+7200),'Expired plan kept included method');
    }
    $draw=genesisSaveStoicheionDraw($id,'spread',0x12345678);
    planDrawCheck(count($draw['cards'])===9&&$draw['cards']===genesisSpreadBaseCards(0x12345678),'Spread source changed');
    if($id!=='elite-plus'){
        planDrawCheck(!$draw['canReroll'],'Ordinary nine-card draw still offered an early reroll');
        planDrawReject('SPREAD_WEEKLY_LIMIT',fn()=>genesisSaveStoicheionDraw($id,'spread',1));
        planDrawReject('SPREAD_CARD_ELITE_PLUS_REQUIRED',fn()=>genesisChangeSpreadCard($id,['position'=>4,'revision'=>$draw['cardRevision'],'seed'=>$draw['seed'],'dayKey'=>$draw['dayKey']]));
    }
}
$draw=genesisStoicheionDraws('elite-plus')['draws']['spread'];
for($i=0;$i<15;$i++){
    $position=$i%9;$old=$draw;$input=['position'=>$position,'revision'=>$draw['cardRevision'],'seed'=>$draw['seed'],'dayKey'=>$draw['dayKey']];
    $draw=genesisChangeSpreadCard('elite-plus',$input);
    planDrawCheck($draw['cardRevision']===$old['cardRevision']+1&&count(array_unique(array_column($draw['cards'],'cardId')))===9,'Replacement revision or uniqueness changed');
    foreach($old['cards']as$index=>$card)planDrawCheck($index===$position?$draw['cards'][$index]['cardId']!==$card['cardId']:$draw['cards'][$index]===$card,'Individual redraw changed a held card');
    planDrawReject('SPREAD_CARD_STALE',fn()=>genesisChangeSpreadCard('elite-plus',$input));
}
for($i=0;$i<8;$i++)planDrawCheck(genesisSaveStoicheionDraw('elite-plus','spread',$i)['canReroll'],'Whole Elite+ spread became limited');
$timeline=genesisChangeTimelineCard('elite-plus',['position'=>0,'action'=>'reveal','revision'=>0])['timeline'];
$db->prepare('UPDATE stoicheion_timeline_card_windows SET first_revealed_at=? WHERE user_id=?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-7200),'elite-plus']);
for($i=0;$i<8;$i++)$timeline=genesisChangeTimelineCard('elite-plus',['position'=>0,'action'=>'reroll','revision'=>$timeline['revision']])['timeline'];
planDrawCheck($timeline['cards'][0]['unlimited']&&$timeline['cards'][0]['canReroll'],'Elite+ timeline was blocked by a timer or used attempt');
$draw=genesisStoicheionDraws('elite-plus')['draws']['spread'];$input=['position'=>3,'revision'=>$draw['cardRevision'],'seed'=>$draw['seed'],'dayKey'=>$draw['dayKey']];
$processes=[];
for($i=0;$i<2;$i++){
    $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'--worker',$configPath,json_encode($input,JSON_THROW_ON_ERROR)],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process))throw new RuntimeException('Worker unavailable');fclose($pipes[0]);$processes[]=[$process,$pipes];
}
$results=[];foreach($processes as[$process,$pipes]){$results[]=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);planDrawCheck(proc_close($process)===0,$errors);}
sort($results);planDrawCheck($results===['SPREAD_CARD_STALE','accepted'],'Concurrent card edits did not serialize');
$db->exec("UPDATE users SET forecast_elite_plus=0 WHERE id='elite-plus'");
planDrawReject('SPREAD_CARD_ELITE_PLUS_REQUIRED',fn()=>genesisChangeSpreadCard('elite-plus',$input));
planDrawCheck(genesisForecastFreeAccess(genesisFindUser('elite-plus')),'Revoking Elite+ also revoked the included Elite method');
echo "Stoicheion plan access: PASS (Premium/Business/Elite included, timed expiry, weekly nine, unlimited Elite+ whole/individual/timeline, held cards, CAS races, privilege revocation)\n";
