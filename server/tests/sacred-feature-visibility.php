<?php
declare(strict_types=1);
foreach(['bootstrap','repository','google','shared-projects'] as $module) require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true)) throw new RuntimeException('Isolated configuration required');
function sacredExpect(bool $ok,string $message):void { if(!$ok) throw new RuntimeException($message); }
$db=genesisDb();$id='sacred-visibility-'.bin2hex(random_bytes(8));
$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
try {
    genesisUpdateAccountPreferences($id,['calendarMode'=>'sacred','taskCalendarMode'=>'lunar']);
    $visibility=genesisUiVisibility(['enabledCalendars'=>['sacred','lunar'],'hiddenMenuItems'=>['tasks'],'hiddenSubmenus'=>['calendar.year'],'sacredFeaturesEnabled'=>false]);
    genesisUpdateAccountPreferences($id,['uiVisibility'=>$visibility]);
    $user=genesisFindUser($id);$saved=genesisUiVisibility($user['ui_visibility_json']);
    sacredExpect($saved['sacredFeaturesEnabled']===false,'Sacred toggle not persisted');
    sacredExpect($saved['enabledCalendars']===['sacred','lunar']&&$user['calendar_mode']==='sacred'&&$user['task_calendar_mode']==='lunar','Toggle rewrote calendar choices');
    $legacy=$visibility;unset($legacy['sacredFeaturesEnabled']);
    genesisUpdateAccountPreferences($id,['uiVisibility'=>$legacy]);
    sacredExpect(genesisUiVisibility(genesisFindUser($id)['ui_visibility_json'])['sacredFeaturesEnabled']===false,'Older client erased the hidden sacred preference');
    genesisUpdateAccountPreferences($id,['uiVisibility'=>[...$saved,'sacredFeaturesEnabled'=>true]]);
    $restored=genesisFindUser($id);
    sacredExpect($restored['calendar_mode']==='sacred'&&$restored['task_calendar_mode']==='lunar','Re-enabling lost original calendars');
    sacredExpect(genesisUiVisibility($restored['ui_visibility_json'])['hiddenSubmenus']===['calendar.year'],'Toggle changed unrelated visibility');
    genesisUpdateAccountPreferences($id,['uiVisibility'=>['dreamJournalEnabled'=>false]]);
    $dreamHidden=genesisUiVisibility(genesisFindUser($id)['ui_visibility_json']);
    sacredExpect($dreamHidden['dreamJournalEnabled']===false,'Dream journal toggle not persisted');
    $oldClient=$dreamHidden;unset($oldClient['dreamJournalEnabled']);
    genesisUpdateAccountPreferences($id,['uiVisibility'=>$oldClient]);
    sacredExpect(genesisUiVisibility(genesisFindUser($id)['ui_visibility_json'])['dreamJournalEnabled']===false,'Old client re-enabled the dream journal');
    genesisUpdateAccountPreferences($id,['uiVisibility'=>['dreamJournalEnabled'=>true]]);
    sacredExpect(genesisUiVisibility(genesisFindUser($id)['ui_visibility_json'])['dreamJournalEnabled']===true,'Dream journal cannot be re-enabled');
    try { genesisUiVisibility(['sacredFeaturesEnabled'=>'false']);throw new RuntimeException('Invalid boolean accepted'); } catch(InvalidArgumentException) {}
    echo "Sacred visibility: persistence, old-client compatibility, independent calendars and reversible menu settings passed.\n";
} finally { $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]); }
