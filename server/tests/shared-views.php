<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/google.php';
require dirname(__DIR__).'/src/shared-projects.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated fixture required');
function viewExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function viewReject(callable $run,?string $code=null):void{
    try{$run();}catch(GenesisSharedAccessException|InvalidArgumentException $e){if($code)viewExpect($e->getMessage()===$code,'Unexpected '.$e->getMessage());return;}
    throw new RuntimeException('Invalid view operation was accepted');
}
$db=genesisDb();$prefix='views-'.bin2hex(random_bytes(4));$owner=$prefix.'-owner';$viewer=$prefix.'-viewer';$outsider=$prefix.'-outsider';$spaces=[];
foreach([$owner,$viewer,$outsider]as$id){
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
    genesisTestEnableSharedProjects($id);
}
try{
    $space=genesisSharedCreateSpace($owner,['title'=>'View scope']);$spaces[]=$space['id'];
    $second=genesisSharedCreateSpace($owner,['title'=>'Other scope']);$spaces[]=$second['id'];
    $project=genesisSharedCreateProject($owner,$space['id'],['title'=>'Visible']);$pid=$project['id'];
    $secret=genesisSharedCreateProject($owner,$second['id'],['title'=>'Private']);
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'guest',?)")->execute([$space['id'],$viewer,genesisNow()]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'viewer',?)")->execute([$pid,$viewer,genesisNow()]);
    $status=genesisSharedProjectSnapshot($owner,$pid)['statuses'][0]['id'];
    $today=(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d');
    for($i=0;$i<121;$i++)genesisSharedTask($owner,$pid,['title'=>'Needle '.$i,'statusId'=>$status,'priority'=>3,'dueDate'=>$today,'tags'=>['urgent']]);
    genesisSharedTask($owner,$pid,['title'=>'Unrelated','statusId'=>$status,'priority'=>0]);
    $secretStatus=genesisSharedProjectSnapshot($owner,$secret['id'])['statuses'][0]['id'];
    genesisSharedTask($owner,$secret['id'],['title'=>'Needle private','statusId'=>$secretStatus,'priority'=>3,'dueDate'=>$today]);
    $definition=['version'=>1,'title'=>'Encrypted needle view','filter'=>['priority'=>[3],'tags'=>['urgent']],'sort'=>'title','relative'=>'none','calendarMode'=>'profane','calendarContext'=>['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march']];
    $input=['requestId'=>genesisUuid(),'visibility'=>'personal','definition'=>$definition];
    $view=genesisSharedViewSave($owner,$input);
    viewExpect(genesisSharedViewSave($owner,$input)['id']===$view['id'],'Retry duplicated a view');
    viewReject(fn()=>genesisSharedViewSave($owner,[...$input,'definition'=>[...$definition,'title'=>'Changed retry']]),'SHARED_REQUEST_ID_CONFLICT');
    viewExpect(!str_contains((string)$db->query('SELECT payload FROM shared_saved_views WHERE id='.$db->quote($view['id']))->fetchColumn(),'Encrypted needle'),'Definition is not encrypted');
    viewReject(fn()=>genesisSharedViewAccess($viewer,$view['id']));
    $page=genesisSharedQueryTasks($owner,['savedViewId'=>$view['id']]);
    viewExpect($page['total']===121&&count($page['tasks'])===100&&$page['hasMore'],'Filter only covers a loaded subset');
    $last=genesisSharedQueryTasks($owner,['savedViewId'=>$view['id']],$page['nextCursor']);
    viewExpect(count($last['tasks'])===21&&!$last['hasMore'],'View continuation lost tasks');
    $renameInput=['requestId'=>genesisUuid(),'expectedRevision'=>$view['revision'],'definition'=>[...$definition,'title'=>'Renamed']];
    $renamed=genesisSharedViewSave($owner,$renameInput,$view['id']);
    viewExpect(genesisSharedViewSave($owner,$renameInput,$view['id'])['id']===$renamed['id'],'Update retry changed the saved view');
    viewReject(fn()=>genesisSharedViewSave($owner,[...$renameInput,'definition'=>[...$definition,'title'=>'Changed update retry']],$view['id']),'SHARED_REQUEST_ID_CONFLICT');
    viewReject(fn()=>genesisSharedQueryTasks($owner,['savedViewId'=>$view['id']],$page['nextCursor']),'SHARED_QUERY_CHANGED');
    viewReject(fn()=>genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'expectedRevision'=>1,'definition'=>$definition],$view['id']),'VIEW_CONFLICT');
    $common=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'spaceId'=>$space['id'],'visibility'=>'shared','definition'=>$definition]);
    viewExpect(genesisSharedQueryTasks($viewer,['savedViewId'=>$common['id']])['total']===121,'Common view widened or lost ACL scope');
    viewReject(fn()=>genesisSharedViewAccess($outsider,$common['id']));
    viewReject(fn()=>genesisSharedViewDelete($viewer,$common['id'],['requestId'=>genesisUuid(),'expectedRevision'=>1]),'SHARED_FORBIDDEN');
    viewReject(fn()=>genesisSharedViewSave($viewer,['requestId'=>genesisUuid(),'spaceId'=>$space['id'],'visibility'=>'shared','definition'=>$definition]),'SHARED_FORBIDDEN');
    $db->prepare("UPDATE shared_space_members SET role='admin' WHERE space_id=? AND user_id=?")->execute([$space['id'],$viewer]);
    $createdByAdmin=genesisSharedViewSave($viewer,['requestId'=>genesisUuid(),'spaceId'=>$space['id'],'visibility'=>'shared','definition'=>$definition]);
    $privateByAdmin=genesisSharedViewSave($viewer,['requestId'=>genesisUuid(),'spaceId'=>$space['id'],'visibility'=>'personal','definition'=>$definition]);
    $db->prepare("UPDATE shared_space_members SET role='guest' WHERE space_id=? AND user_id=?")->execute([$space['id'],$viewer]);
    $demoted=genesisSharedViewRead(genesisSharedViewAccess($viewer,$createdByAdmin['id']),$viewer);
    viewExpect(!$demoted['canEdit'] && !$demoted['invalid'],'Demoted creator retained shared-view edit metadata or lost read access');
    viewExpect(genesisSharedQueryTasks($viewer,['savedViewId'=>$createdByAdmin['id']])['total']===121,'Demotion removed permitted read access');
    viewReject(fn()=>genesisSharedViewSave($viewer,['requestId'=>genesisUuid(),'expectedRevision'=>1,'definition'=>$definition],$createdByAdmin['id']),'SHARED_FORBIDDEN');
    viewReject(fn()=>genesisSharedViewDelete($viewer,$createdByAdmin['id'],['requestId'=>genesisUuid(),'expectedRevision'=>1]),'SHARED_FORBIDDEN');
    viewExpect(genesisSharedViewRead(genesisSharedViewAccess($viewer,$privateByAdmin['id']),$viewer)['canEdit'],'Demotion removed ownership of the personal definition');
    genesisSharedViewDelete($viewer,$privateByAdmin['id'],['requestId'=>genesisUuid(),'expectedRevision'=>1]);
    $temporaryStatus=genesisUuid();$db->prepare('INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES(?,?,?,99)')->execute([$temporaryStatus,$pid,'Temporary']);
    $reference=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'definition'=>[...$definition,'filter'=>['projectIds'=>[$pid],'statusIds'=>[$temporaryStatus]]]]);
    $db->prepare('DELETE FROM shared_project_statuses WHERE id=?')->execute([$temporaryStatus]);
    viewExpect(genesisSharedViewRead(genesisSharedViewAccess($owner,$reference['id']),$owner)['invalid'],'Deleted status did not flag a stale view');
    viewReject(fn()=>genesisSharedQueryTasks($owner,['savedViewId'=>$reference['id']]),'VIEW_FILTER_UNAVAILABLE');
    $fixed=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'expectedRevision'=>1,'definition'=>$definition],$reference['id']);
    viewExpect(!$fixed['invalid'],'Repair did not restore the view');
    viewReject(fn()=>genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'definition'=>[...$definition,'filter'=>['unknownField'=>true]]]),'INVALID_TASK_FILTER');
    $damaged=[...$definition];unset($damaged['calendarContext']);
    viewReject(fn()=>genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'definition'=>$damaged]),'VIEW_INVALID');
    foreach(['sort','relative','calendarMode']as$key){$missing=$definition;unset($missing[$key]);viewReject(fn()=>genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'definition'=>$missing]),'VIEW_INVALID');}
    $broken=genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'definition'=>$definition]);
    $db->prepare('UPDATE shared_saved_views SET payload=? WHERE id=?')->execute([genesisSharedContentEncrypt(json_encode($damaged,JSON_THROW_ON_ERROR)),$broken['id']]);
    viewExpect(genesisSharedViewRead(genesisSharedViewAccess($owner,$broken['id']),$owner)['invalid'],'Missing calendar context silently became defaults');
    viewReject(fn()=>genesisSharedQueryTasks($owner,['savedViewId'=>$broken['id']]),'VIEW_FILTER_UNAVAILABLE');
    // Overdue dates, timed deadlines, DST and month windows preserve the saved calendar context.
    $at=new DateTimeImmutable('2026-10-14T12:00:00Z');
    $relative=[...$definition,'relative'=>'this-week'];$resolved=genesisSharedViewResolve($relative,$at);
    viewExpect($resolved['dueFrom']==='2026-10-12'&&$resolved['dueTo']==='2026-10-18','Week boundaries are wrong');
    viewExpect(genesisSharedViewResolve($relative,$at->modify('+7 days'))['dueFrom']==='2026-10-19','Relative week became fixed');
    $month=genesisSharedViewResolve([...$definition,'relative'=>'this-month'],$at);
    viewExpect($month['dueFrom']==='2026-10-01'&&$month['dueTo']==='2026-10-31','Civil month window is wrong');
    foreach(['sacred','lunar']as$mode){$d=[...$definition,'relative'=>'this-month','calendarMode'=>$mode];$p=genesisCalendarPeriod('2026-10-14',$mode,'month',$d['calendarContext']);$r=genesisSharedViewResolve($d,$at);viewExpect($r['dueFrom']===$p['start']&&$r['dueTo']===genesisCalendarAddDays($p['end'],-1),'Calendar month was replaced by Gregorian');}
    $dst=[...$definition,'relative'=>'overdue','calendarContext'=>['version'=>2,'timeZone'=>'America/New_York','gregorianYearStart'=>'january']];
    viewExpect(genesisSharedViewResolve($dst,new DateTimeImmutable('2026-11-01T05:30:00Z'))===genesisSharedViewResolve($dst,new DateTimeImmutable('2026-11-01T06:30:00Z')),'Repeated wall clock changes the filter');
    $timed=genesisSharedTask($owner,$pid,['title'=>'Timed overdue','statusId'=>$status,'dueDate'=>$today,'startDate'=>$today,'startTime'=>'00:00','endTime'=>'00:01']);
    $overdue=genesisSharedQueryTasks($owner,['overdueDate'=>$today,'overdueTime'=>'00:01']);viewExpect(in_array($timed['id'],array_column($overdue['tasks'],'id'),true),'Timed same-day deadline was not included');
    // More than 100 visible definitions across scopes paginate instead of failing the whole list.
    for($i=0;$i<100;$i++)genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'spaceId'=>$second['id'],'visibility'=>'shared','definition'=>[...$definition,'title'=>'Second '.$i,'filter'=>[]]]);
    $list=genesisSharedViews($owner,null,null,25);$seen=array_column($list['views'],'id');$total=$list['total'];
    while($list['hasMore']){$list=genesisSharedViews($owner,null,$list['nextCursor'],25);array_push($seen,...array_column($list['views'],'id'));}
    viewExpect(count($seen)===$total&&count(array_unique($seen))===$total&&$total>100,'View list was truncated or duplicated');
    viewReject(fn()=>genesisSharedViewSave($owner,['requestId'=>genesisUuid(),'spaceId'=>$second['id'],'visibility'=>'shared','definition'=>$definition]),'VIEW_LIMIT');
    $options=genesisSharedViewOptions($viewer,'projects');viewExpect(!in_array($secret['id'],array_column($options['options'],'id'),true),'Picker leaked an inaccessible project');
    $delete=['requestId'=>genesisUuid(),'expectedRevision'=>$renamed['revision']];genesisSharedViewDelete($owner,$renamed['id'],$delete);viewExpect(genesisSharedViewDelete($owner,$renamed['id'],$delete)['ok'],'Delete retry failed');
    viewReject(fn()=>genesisSharedViewDelete($owner,$renamed['id'],[...$delete,'expectedRevision'=>999]),'SHARED_REQUEST_ID_CONFLICT');
    viewReject(fn()=>genesisSharedQueryTasks($owner,['savedViewId'=>$renamed['id']]));
    $db->prepare('DELETE FROM shared_space_members WHERE space_id=? AND user_id=?')->execute([$space['id'],$viewer]);
    viewReject(fn()=>genesisSharedQueryTasks($viewer,['savedViewId'=>$common['id']]));
    viewExpect(genesisSharedViews($viewer,null)['total']===0,'Revoked common view remains visible');
    echo "Saved views: lifecycle, encryption, ACL/revocation, full query, >100 pagination, stale repair, timed/relative/calendar filters and conflicts passed.\n";
}finally{foreach($spaces as$id)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$id]);foreach([$owner,$viewer,$outsider]as$id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);}
