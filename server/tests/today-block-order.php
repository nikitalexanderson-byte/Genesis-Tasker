<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-today-order-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC','admin_email'=>'qa-admin@example.invalid','notifications'=>['email'=>['transport'=>'disabled']]];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
foreach(['bootstrap','repository']as$module)require_once dirname(__DIR__).'/src/'.$module.'.php';
function todayOrderCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
$defaults=['advice','dream','ads','rhythm','tasks','habits','events','details'];$order=array_reverse($defaults);
$user=genesisUpsertGoogleUser(['sub'=>'today-order-owner','email'=>'today-order-owner@example.invalid','email_verified'=>true],[],false);
$other=genesisUpsertGoogleUser(['sub'=>'today-order-other','email'=>'today-order-other@example.invalid','email_verified'=>true],[],false);
todayOrderCheck(genesisUiVisibility(null)['todayBlockOrder']===null,'Old account received an unsolicited custom order');
$saved=genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayBlockOrder'=>$order]]);
todayOrderCheck(genesisUserForClient($saved)['uiVisibility']['todayBlockOrder']===$order,'Existing account preference path lost the chosen order');
genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['sidebarWidth'=>200]]);
todayOrderCheck(genesisUiVisibility(genesisFindUser($user['id'])['ui_visibility_json'])['todayBlockOrder']===$order,'Unrelated layout change overwrote the order');
genesisUpdateAccountPreferences($user['id'],['uiVisibility'=>['hiddenTodayBlocks'=>['tasks'],'enabledCalendars'=>['profane']]]);
$current=genesisUiVisibility(genesisFindUser($user['id'])['ui_visibility_json']);
todayOrderCheck($current['todayBlockOrder']===$order&&$current['hiddenTodayBlocks']===['tasks'],'Old client visibility save lost order or hidden blocks');
todayOrderCheck(genesisUiVisibility(genesisFindUser($other['id'])['ui_visibility_json'])['todayBlockOrder']===null,'Account order leaked to another user');
foreach([[],['hero'],['tasks','tasks'],['tasks','unknown'],['tasks',false],['tasks'=>true],array_fill(0,9,'tasks')]as$invalid){
    try{genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayBlockOrder'=>$invalid]]);throw new LogicException('Invalid order accepted');}
    catch(InvalidArgumentException $error){todayOrderCheck($error->getMessage()==='INVALID_TODAY_BLOCK_ORDER','Wrong invalid-order error');}
    todayOrderCheck(genesisUiVisibility(genesisFindUser($user['id'])['ui_visibility_json'])['todayBlockOrder']===$order,'Rejected order partially changed account settings');
}
$expanded=genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayBlockOrder'=>['tasks']]]);
todayOrderCheck(genesisUiVisibility($expanded['ui_visibility_json'])['todayBlockOrder']===['tasks','advice','dream','ads','rhythm','habits','events','details'],'Missing/future blocks were hidden instead of appended');
$reset=genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayBlockOrder'=>null]]);
todayOrderCheck(genesisUiVisibility($reset['ui_visibility_json'])['todayBlockOrder']===null,'Default order could not be restored');
$before=genesisFindUser($user['id']);
$layout=genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayHalfBlocks'=>['tasks','dream'],'displayCalendarOrder'=>['lunar','sacred','profane']]]);
$prefs=genesisUiVisibility($layout['ui_visibility_json']);
todayOrderCheck($prefs['todayHalfBlocks']===['dream','tasks']&&$prefs['displayCalendarOrder']===['lunar','sacred','profane'],'Desktop widths or display priority did not persist');
todayOrderCheck($layout['calendar_mode']===$before['calendar_mode']&&$layout['task_calendar_mode']===$before['task_calendar_mode'],'Reordering unexpectedly selected a display or task calendar');
genesisUpdateAccountPreferences($user['id'],['uiVisibility'=>['hiddenTodayBlocks'=>['tasks'],'enabledCalendars'=>['profane']]]);
$after=genesisUiVisibility(genesisFindUser($user['id'])['ui_visibility_json']);
todayOrderCheck($after['todayHalfBlocks']===$prefs['todayHalfBlocks']&&$after['displayCalendarOrder']===$prefs['displayCalendarOrder'],'Older client erased web layout preferences');
$otherPrefs=genesisUiVisibility(genesisFindUser($other['id'])['ui_visibility_json']);
todayOrderCheck($otherPrefs['todayHalfBlocks']===[]&&$otherPrefs['displayCalendarOrder']===['profane','sacred','lunar'],'Website layout leaked across accounts');
foreach(['todayHalfBlocks'=>[['hero'],['tasks','tasks'],['tasks'=>true],['tasks',false]],'displayCalendarOrder'=>[[],['sacred'],['profane','profane','lunar'],['profane','lunar','unknown']]] as $field=>$invalids){
    foreach($invalids as $invalid){
        try{genesisUpdateAccountPreferences($user['id'],['uiLayout'=>[$field=>$invalid]]);throw new LogicException('Invalid website layout accepted');}
        catch(InvalidArgumentException $error){todayOrderCheck(in_array($error->getMessage(),['INVALID_TODAY_BLOCK_WIDTH','INVALID_DISPLAY_CALENDAR_ORDER'],true),'Wrong website-layout error');}
    }
}
$defaultLayout=genesisUpdateAccountPreferences($user['id'],['uiLayout'=>['todayHalfBlocks'=>[],'displayCalendarOrder'=>['profane','sacred','lunar']]]);
todayOrderCheck(genesisUiVisibility($defaultLayout['ui_visibility_json'])['todayHalfBlocks']===[],'Full width defaults could not be restored');
todayOrderCheck(!genesisDb()->query('PRAGMA foreign_key_check')->fetch(),'Order preferences broke foreign keys');
echo "Today block order: validated account JSON, pinned hero, partial-order expansion, independent accounts, rejected writes, old-client preservation and reset passed.\n";
