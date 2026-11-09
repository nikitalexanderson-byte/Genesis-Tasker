<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/google.php';
require dirname(__DIR__).'/src/shared-projects.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated fixture required');
$seriesSuiteFinished=false;
register_shutdown_function(static function()use(&$seriesSuiteFinished):void{
    if(!$seriesSuiteFinished){fwrite(STDERR,"FAIL shared-series: suite did not finish (including early API responses).\n");exit(1);}
});
function seriesExpect(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function seriesReject(callable $run,string $code):void{
    try{$run();}catch(GenesisSharedAccessException|InvalidArgumentException $e){seriesExpect($e->getMessage()===$code,'Unexpected '.$e->getMessage());return;}
    throw new RuntimeException('Expected '.$code);
}
function seriesRun(string $id,int $revision,string $through):void{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{genesisSharedSeriesGenerate(['seriesId'=>$id,'revision'=>$revision,'throughDate'=>$through]);$db->commit();}
    catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
$db=genesisDb();$prefix='series-fixture-'.bin2hex(random_bytes(4));$owner=$prefix.'-owner';$viewer=$prefix.'-viewer';$outsider=$prefix.'-outsider';$space=null;
foreach([$owner,$viewer,$outsider] as $id){
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,subscription_plan,subscription_valid_until) VALUES(?,?,?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow(),'business',gmdate('Y-m-d\TH:i:s\Z',time()+365*86400)]);
    genesisUpdateAccountPreferences($id,['sharedProjectsEnabled'=>true]);
}
try{
    $space=genesisSharedCreateSpace($owner,['title'=>'Synthetic series']);
    $project=genesisSharedCreateProject($owner,$space['id'],['title'=>'Synthetic project']);$pid=$project['id'];
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'guest',?)")->execute([$space['id'],$viewer,genesisNow()]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'viewer',?)")->execute([$pid,$viewer,genesisNow()]);
    $statuses=genesisSharedProjectSnapshot($owner,$pid)['statuses'];
    $open=array_values(array_filter($statuses,fn($s)=>!$s['isDone']))[0]['id'];
    $done=array_values(array_filter($statuses,fn($s)=>$s['isDone']))[0]['id'];
    $today=(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d');
    $anchor=genesisCalendarAddDays($today,-10);
    $root=genesisSharedTask($owner,$pid,['title'=>'Synthetic source','description'=>'private template phrase','statusId'=>$open,'dueDate'=>$anchor,'startDate'=>genesisCalendarAddDays($anchor,-1),'priority'=>3,
        'checklists'=>[['id'=>'list','title'=>'Plan','items'=>[['id'=>'item','title'=>'Child item','done'=>false,'assigneeId'=>$owner,'dueDate'=>genesisCalendarAddDays($anchor,1),'linkedTaskId'=>null]]]]]);
    $converted=genesisSharedConvertChecklistItem($owner,$pid,$root['id'],['itemId'=>'item','expectedRevision'=>$root['revision'],'requestId'=>genesisUuid()]);
    $linkedSource=genesisSharedGetTask($owner,$pid,$converted['taskId']);
    genesisSharedTask($owner,$pid,['parentTaskId'=>$root['id'],'expectedRevision'=>$linkedSource['revision']],$linkedSource['id']);
    $root=genesisSharedGetTask($owner,$pid,$root['id']);
    $settings=['timing'=>'schedule','delayDays'=>2,'limit'=>8,'cloneChildren'=>true,'excludedDates'=>[genesisCalendarAddDays($anchor,2)],
        'recurrence'=>['mode'=>'classic','pattern'=>'daily','days'=>[1],'months'=>[],'pyatas'=>[],'interval'=>1,'rangeStart'=>$anchor,'rangeEnd'=>genesisCalendarAddDays($today,10),
            'calendarContext'=>['version'=>2,'timeZone'=>'Europe/Moscow','gregorianYearStart'=>'march']]];
    $input=['requestId'=>genesisUuid(),'taskRevision'=>$root['revision'],'settings'=>$settings,'paused'=>false];
    $preview=genesisSharedSeriesPreview($owner,$pid,$root['id'],$input);
    seriesExpect($preview['taskCount']===2&&$preview['checklistCount']===1&&!$preview['copiesFiles'],'Preview does not match tree');
    $series=genesisSharedSeriesSave($owner,$pid,$root['id'],$input);$sid=$series['id'];
    seriesExpect(genesisSharedSeriesSave($owner,$pid,$root['id'],$input)['id']===$sid,'Request created duplicate series');
    seriesReject(fn()=>genesisSharedSeriesSave($owner,$pid,$root['id'],[...$input,'paused'=>true]),'SHARED_REQUEST_ID_CONFLICT');
    seriesReject(fn()=>genesisSharedSeriesSave($viewer,$pid,$root['id'],$input+['seriesId'=>$sid],$sid),'SHARED_PROJECT_FORBIDDEN');
    seriesReject(fn()=>genesisSharedSeriesRead($outsider,$pid,$sid),'SHARED_PROJECT_NOT_FOUND');
    $q=$db->prepare('SELECT template_json FROM shared_task_series WHERE id=?');$q->execute([$sid]);
    seriesExpect(!str_contains($q->fetchColumn(),'private template phrase'),'Template plaintext at rest');$q->closeCursor();
    seriesRun($sid,1,$today);
    $series=genesisSharedSeriesRead($owner,$pid,$sid);
    seriesExpect($series['generatedCount']===6,'Catch-up must use bounded five-instance batch');
    $new=array_values(array_filter($series['instances'],fn($i)=>$i['taskId']&&$i['taskId']!==$root['id']))[0];
    $task=genesisSharedGetTask($owner,$pid,$new['taskId']);
    seriesExpect($task['priority']===3&&$task['description']==='private template phrase'&&$task['childCount']===1,'Template structure lost');
    seriesExpect($task['seriesId']===$sid&&$task['seriesOriginalDate']===$new['date'],'Series identity missing');
    seriesExpect($task['checklists'][0]['items'][0]['id']!=='item'&&!$task['checklists'][0]['items'][0]['done'],'Checklist completion/id copied');
    $childId=$task['checklists'][0]['items'][0]['linkedTaskId'];$child=genesisSharedGetTask($owner,$pid,$childId);
    seriesExpect($child['parentTaskId']===$task['id']&&$child['dueDate']===genesisCalendarAddDays($new['date'],1),'Child or relative date not remapped');
    seriesExpect($task['checklists'][0]['items'][0]['dueDate']===genesisCalendarAddDays($new['date'],1),'Checklist deadline not shifted');
    seriesExpect(genesisSharedComments($owner,$pid,$task['id'])===[]&&!$task['attachments'],'Discussion/files copied');
    // The edited occurrence becomes the explicit snapshot for not-yet-created instances.
    $task=genesisSharedTask($owner,$pid,['description'=>'future snapshot','expectedRevision'=>$task['revision']],$task['id']);
    $save=['requestId'=>genesisUuid(),'taskRevision'=>$task['revision'],'expectedRevision'=>1,'settings'=>$settings,'paused'=>true,'refreshTemplate'=>true];
    $series=genesisSharedSeriesSave($owner,$pid,$task['id'],$save,$sid);
    seriesReject(fn()=>genesisSharedSeriesSave($owner,$pid,$task['id'],[...$save,'paused'=>false],$sid),'SHARED_REQUEST_ID_CONFLICT');
    seriesRun($sid,1,$today);seriesRun($sid,2,$today);
    seriesExpect(genesisSharedSeriesRead($owner,$pid,$sid)['generatedCount']===6,'Stale/paused worker generated tasks');
    seriesReject(fn()=>genesisSharedSeriesSave($owner,$pid,$task['id'],array_merge($save,['requestId'=>genesisUuid()]),$sid),'SERIES_CONFLICT');
    $series=genesisSharedSeriesSave($owner,$pid,$task['id'],array_merge($save,['requestId'=>genesisUuid(),'expectedRevision'=>2,'paused'=>false,'refreshTemplate'=>false]),$sid);
    seriesRun($sid,3,$today);seriesRun($sid,3,$today);
    $series=genesisSharedSeriesRead($owner,$pid,$sid);
    seriesExpect($series['generatedCount']===8,'Limit/retry created extra instances');
    $latest=genesisSharedGetTask($owner,$pid,$series['instances'][0]['taskId']);
    seriesExpect($latest['description']==='future snapshot'&&genesisSharedGetTask($owner,$pid,$root['id'])['description']==='private template phrase','Future edit changed history');
    // Offsets at either supported boundary reject the entire tree, retaining the old instances.
    $savedSeries=$db->query('SELECT * FROM shared_task_series WHERE id='.$db->quote($sid))->fetch();
    $beforeBoundary=(int)$db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn();
    foreach(['1900-01-01','2100-12-31'] as $boundary){
        genesisBeginWriteTransaction($db);
        try{seriesReject(fn()=>genesisSharedSeriesMaterialize($savedSeries,$settings,'boundary:'.$boundary,$boundary),'SERIES_INVALID');}
        finally{$db->rollBack();}
    }
    seriesExpect((int)$db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn()===$beforeBoundary,'Boundary failure retained a partial tree');
    // After-completion needs final approval; a reopen before generation cancels eligibility.
    $after=genesisSharedTask($owner,$pid,['title'=>'Approval source','statusId'=>$open,'dueDate'=>$anchor,'approvalRequired'=>true,'approverIds'=>[$owner,$viewer]]);
    $afterSettings=array_merge($settings,['timing'=>'after-completion','cloneChildren'=>false,'excludedDates'=>[],'limit'=>4]);
    $a=genesisSharedSeriesSave($owner,$pid,$after['id'],['requestId'=>genesisUuid(),'taskRevision'=>$after['revision'],'settings'=>$afterSettings]);
    genesisSharedApproveTask($owner,$pid,$after['id']);seriesRun($a['id'],1,$today);
    seriesExpect(genesisSharedSeriesRead($owner,$pid,$a['id'])['generatedCount']===1,'Partial approval generated successor');
    genesisSharedApproveTask($viewer,$pid,$after['id']);
    $db->prepare('UPDATE shared_tasks SET completed_at=? WHERE id=?')->execute([genesisCalendarAddDays($today,-3).'T10:00:00Z',$after['id']]);
    $after=genesisSharedGetTask($owner,$pid,$after['id']);
    $after=genesisSharedTask($owner,$pid,['statusId'=>$open,'expectedRevision'=>$after['revision']],$after['id']);
    seriesRun($a['id'],1,$today);seriesExpect(genesisSharedSeriesRead($owner,$pid,$a['id'])['generatedCount']===1,'Reopened task generated successor');
    genesisSharedApproveTask($owner,$pid,$after['id']);genesisSharedApproveTask($viewer,$pid,$after['id']);
    $db->prepare('UPDATE shared_tasks SET completed_at=? WHERE id=?')->execute([genesisCalendarAddDays($today,-3).'T10:00:00Z',$after['id']]);
    seriesRun($a['id'],1,$today);seriesRun($a['id'],1,$today);
    seriesExpect(genesisSharedSeriesRead($owner,$pid,$a['id'])['generatedCount']===2,'After-completion repeated successor');
    $next=genesisSharedSeriesRead($owner,$pid,$a['id'])['instances'][0];
    $nextTask=genesisSharedGetTask($owner,$pid,$next['taskId']);
    $skipInput=['seriesId'=>$a['id'],'expectedRevision'=>1,'taskRevision'=>$nextTask['revision'],'requestId'=>genesisUuid()];
    $skipped=genesisSharedSeriesSkip($owner,$pid,$nextTask['id'],$skipInput);
    seriesExpect($skipped['instances'][0]['state']==='skipped'&&genesisSharedGetTask($owner,$pid,$nextTask['id'],true)['archivedAt']!==null,'Explicit skip did not preserve archived task');
    seriesExpect(genesisSharedSeriesSkip($owner,$pid,$nextTask['id'],$skipInput)['revision']===2,'Repeated skip changed series twice');
    seriesReject(fn()=>genesisSharedSeriesSkip($owner,$pid,$nextTask['id'],[...$skipInput,'taskRevision'=>999]),'SHARED_REQUEST_ID_CONFLICT');
    $candidate=genesisSharedSeriesAfterCandidate($db->query("SELECT * FROM shared_task_series WHERE id=".$db->quote($a['id']))->fetch(),$afterSettings);
    seriesExpect($candidate['date']===genesisCalendarAddDays($next['date'],2),'Skipped after-completion instance blocked chain');
    // Waiting series do not consume a daily job key, so completion can enqueue immediately that day.
    $waiting=genesisSharedTask($owner,$pid,['title'=>'Waiting source','statusId'=>$open,'dueDate'=>$anchor]);
    $waitSeries=genesisSharedSeriesSave($owner,$pid,$waiting['id'],['requestId'=>genesisUuid(),'taskRevision'=>$waiting['revision'],'settings'=>$afterSettings]);
    genesisSharedSeriesEnqueue();
    $q=$db->prepare('SELECT COUNT(*) FROM background_jobs WHERE unique_key LIKE ?');$q->execute(['series:'.$waitSeries['id'].':%']);
    seriesExpect((int)$q->fetchColumn()===0,'Waiting series consumed job key');$q->closeCursor();
    $waiting=genesisSharedTask($owner,$pid,['statusId'=>$done,'expectedRevision'=>$waiting['revision']],$waiting['id']);
    $db->prepare('UPDATE shared_tasks SET completed_at=? WHERE id=?')->execute([genesisCalendarAddDays($today,-3).'T10:00:00Z',$waiting['id']]);
    genesisSharedSeriesEnqueue();
    $q->execute(['series:'.$waitSeries['id'].':%']);seriesExpect((int)$q->fetchColumn()===1,'Completion waited for next calendar day');$q->closeCursor();
    // More than one scan page, all with future cursors, still rotates to the last row.
    $source=$db->query('SELECT * FROM shared_task_series WHERE id='.$db->quote($waitSeries['id']))->fetch();
    $insert=$db->prepare('INSERT INTO shared_task_series(id,project_id,owner_id,rule_json,template_json,cursor_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for($i=0;$i<105;$i++)$insert->execute(['fair-'.$prefix.'-'.$i,$pid,$owner,json_encode($settings),$source['template_json'],genesisCalendarAddDays($today,5),genesisNow(),genesisNow()]);
    genesisSharedSeriesEnqueue();genesisSharedSeriesEnqueue();
    $q=$db->prepare('SELECT COUNT(*) FROM shared_task_series WHERE id LIKE ? AND checked_at IS NULL');$q->execute(['fair-'.$prefix.'-%']);
    seriesExpect((int)$q->fetchColumn()===0,'Waiting scan page starved later series');$q->closeCursor();
    // Expired leases are reclaimed and stale claimants cannot run; a failed transaction rolls back the whole result.
    $db->exec('DELETE FROM background_jobs');
    genesisBackgroundEnqueue('shared-series','fixture:'.$prefix,['seriesId'=>$sid,'revision'=>3,'throughDate'=>$today]);
    $job=genesisBackgroundClaim();seriesExpect($job!==null&&genesisBackgroundClaim()===null,'Concurrent claim took same job');
    $reclaimed=genesisBackgroundClaim(gmdate('Y-m-d\TH:i:s\Z',time()+130));
    seriesExpect($reclaimed!==null&&genesisBackgroundPerform($job)==='superseded','Expired lease owner still ran');
    $before=(int)$db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn();
    $result=genesisBackgroundPerform($reclaimed,function()use($owner,$pid,$open){
        genesisSharedTask($owner,$pid,['title'=>'Must roll back','statusId'=>$open]);throw new RuntimeException('Do not expose this content');
    });
    seriesExpect($result==='pending'&&(int)$db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn()===$before,'Failed handler committed partial data');
    $q=$db->query('SELECT error_code,payload FROM background_jobs');$raw=$q->fetch();$q->closeCursor();
    seriesExpect($raw['error_code']==='BACKGROUND_RETRY'&&!str_contains($raw['payload'],$sid),'Job error/payload leaked content');
    $db->exec("UPDATE background_jobs SET available_at='2000-01-01T00:00:00Z'");
    seriesExpect(genesisBackgroundPerform(genesisBackgroundClaim())==='cancelled','Retry of exhausted series did not acknowledge cancellation');
    $db->prepare('UPDATE shared_task_series SET last_error=NULL WHERE id=?')->execute([$sid]);
    genesisBackgroundEnqueue('shared-series','stale-error:'.$prefix,['seriesId'=>$sid,'revision'=>2]);
    genesisBackgroundPerform(genesisBackgroundClaim(),function(){throw new RuntimeException('Stale attempt');});
    $q=$db->prepare('SELECT last_error FROM shared_task_series WHERE id=?');$q->execute([$sid]);
    seriesExpect($q->fetchColumn()===null,'Stale failure marked an edited series');$q->closeCursor();
    genesisBackgroundEnqueue('shared-series','expired:'.$prefix,['seriesId'=>$sid]);
    $expired=genesisBackgroundClaim();
    $db->prepare("UPDATE background_jobs SET attempts=5,lease_until='2000-01-01T00:00:00Z' WHERE id=?")->execute([$expired['id']]);
    seriesExpect(genesisBackgroundClaim()===null,'Crashed lease exceeded retry bound');
    $db->prepare("UPDATE shared_project_members SET role='viewer' WHERE project_id=? AND user_id=?")->execute([$pid,$owner]);
    $db->prepare("UPDATE shared_space_members SET role='guest',can_organize_tasks=0 WHERE space_id=? AND user_id=?")->execute([$space['id'],$owner]);
    seriesReject(fn()=>seriesRun($a['id'],2,$today),'SHARED_PROJECT_FORBIDDEN');
    $seriesPassMessage="Shared series: encrypted snapshot, dates/tree/links, bounded catch-up, skip/limit, receipts/ACL, pause/revision, future-only edits, approval/reopen, leases/rollback/retry passed.\n";
}finally{
    if($db->inTransaction())$db->rollBack();
    $db->exec('DELETE FROM background_jobs');
    if($space){
        $db->prepare('DELETE FROM shared_tasks WHERE project_id IN (SELECT id FROM shared_projects WHERE space_id=?)')->execute([$space['id']]);
        $db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);
    }
    foreach([$owner,$viewer,$outsider] as $id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
$seriesSuiteFinished=true;echo $seriesPassMessage;
