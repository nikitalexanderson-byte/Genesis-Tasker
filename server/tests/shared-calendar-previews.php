<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
foreach (['bootstrap','repository','google','shared-projects'] as $module) require dirname(__DIR__).'/src/'.$module.'.php';
if (!in_array(parse_url(genesisConfig()['app_url'], PHP_URL_HOST), ['127.0.0.1','localhost.invalid'], true)) throw new RuntimeException('Isolated test configuration required');
function calendarPreviewExpect(bool $ok, string $why): void { if (!$ok) throw new RuntimeException($why); }
$db=genesisDb(); $prefix='calendar-preview-'.bin2hex(random_bytes(5));
$users=[$prefix.'-owner',$prefix.'-member',$prefix.'-outsider']; [$owner,$member,$outsider]=$users; $spaces=[];
foreach ($users as $id) {
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        ->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
    genesisTestEnableSharedProjects($id);
}
try {
    $space=genesisSharedCreateSpace($owner,['title'=>'Calendar preview test']); $spaces[]=$space['id'];
    $project=genesisSharedCreateProject($owner,$space['id'],['title'=>'Visible project']); $pid=$project['id'];
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$space['id'],$member,genesisNow()]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$pid,$member,genesisNow()]);
    $status=genesisSharedProjectSnapshot($owner,$pid)['statuses'][0]['id'];
    $make=static fn(string $date,string $title):array => genesisSharedTask($owner,$pid,['title'=>$title,'statusId'=>$status,'dueDate'=>$date]);
    for ($i=0;$i<103;$i++) $make('2026-10-01','Dense '.$i);
    $later=$make('2026-10-17','A later date must still be visible');
    $completed=$make('2026-10-17','Completed');
    $db->prepare('UPDATE shared_tasks SET completed_at=? WHERE id=?')->execute([genesisNow(),$completed['id']]);
    $archived=$make('2026-10-17','Archived');
    genesisSharedArchiveTask($owner,$pid,$archived['id'],['archived'=>true,'expectedRevision'=>$archived['revision']]);
    $outside=$make('2026-11-01','Outside requested range');
    $private=genesisSharedCreateProject($owner,$space['id'],['title'=>'Private project']);
    $privateStatus=genesisSharedProjectSnapshot($owner,$private['id'])['statuses'][0]['id'];
    genesisSharedTask($owner,$private['id'],['title'=>'Private title must not leak','statusId'=>$privateStatus,'dueDate'=>'2026-10-17']);
    $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$private['id'],$member]);
    $page=genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31');
    calendarPreviewExpect($page['dateCounts']===['2026-10-01'=>103,'2026-10-17'=>1], 'Date counts leaked private, completed, archived or out-of-range tasks');
    calendarPreviewExpect(count($page['tasks'])===4, 'Preview payload was not bounded independently per date');
    calendarPreviewExpect(in_array($later['id'],array_column($page['tasks'],'id'),true), 'A dense first date starved a later date');
    calendarPreviewExpect($page['tasks'][3]['title']==='A later date must still be visible' && $page['tasks'][3]['projectTitle']==='Visible project', 'Encrypted titles or project projection were lost');
    calendarPreviewExpect(!isset($page['tasks'][0]['description'],$page['tasks'][0]['attachments']), 'Preview needlessly hydrated task details');
    $scoped=genesisSharedCalendarPreviews($owner,'2026-10-01','2026-10-31',['projectIds'=>[$pid]]);
    calendarPreviewExpect($scoped['dateCounts']===$page['dateCounts'] && count($scoped['tasks'])===4, 'Explicit project scope included another project');
    $fieldDraft=[
        'id'=>genesisUuid(),'title'=>'Preview filter','type'=>'checkbox','projectId'=>$pid,'options'=>[],
        'position'=>0,'required'=>false,'showCard'=>true,'showList'=>true,'archived'=>false,'expectedRevision'=>0];
    $fieldPreview=genesisSharedPreviewCustomField($owner,$space['id'],$fieldDraft);
    $field=genesisSharedSaveCustomField($owner,$space['id'],[...$fieldDraft,'operationId'=>genesisUuid(),'fingerprint'=>$fieldPreview['fingerprint'],'replaceType'=>false]);
    $marked=genesisSharedTask($owner,$pid,['expectedRevision'=>$later['revision'],'priority'=>2,'customFields'=>[$field['field']['id']=>false]],$later['id']);
    $filtered=genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31',[
        'projectIds'=>[$pid],'priority'=>[2],'customFields'=>[['fieldId'=>$field['field']['id'],'op'=>'eq','value'=>false]]]);
    calendarPreviewExpect($filtered['dateCounts']===['2026-10-17'=>1] && array_column($filtered['tasks'],'id')===[$marked['id']], 'Priority/custom false filters were not applied before per-date limits');
    calendarPreviewExpect(genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31',['projectIds'=>[$pid],'priority'=>[3]])['tasks']===[], 'Empty priority scope fell back to unfiltered tasks');
    foreach ([['completion'=>'any'],['includeArchived'=>true],['dueTo'=>'2027-01-01'],['priority'=>[9]]] as $invalid) {
        try { genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31',$invalid); throw new RuntimeException('Unsafe preview filter accepted'); }
        catch (InvalidArgumentException $error) { calendarPreviewExpect($error->getMessage()==='INVALID_TASK_FILTER','Wrong filter error'); }
    }
    try { genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31',['projectIds'=>[$private['id']]]); throw new RuntimeException('Explicit private scope accepted'); }
    catch (GenesisSharedAccessException) { /* Explicit IDs never grant access. */ }
    $cursor=null; $seen=[];
    do {
        $full=genesisSharedQueryTasks($member,['dueFrom'=>'2026-10-01','dueTo'=>'2026-10-01','completion'=>'open'],$cursor,100,'dueDate');
        array_push($seen,...array_column($full['tasks'],'id')); $cursor=$full['nextCursor'];
    } while ($cursor!==null);
    calendarPreviewExpect(count($seen)===103 && count(array_unique($seen))===103, 'Full date list stopped at 100 tasks or duplicated pages');
    calendarPreviewExpect(genesisSharedCalendarPreviews($outsider,'2026-10-01','2026-10-31')['tasks']===[], 'Outsider received previews');
    foreach ([['2026-10-31','2026-10-01'],['2026-10-01','2026-11-12'],['invalid','2026-10-31']] as [$from,$to]) {
        try { genesisSharedCalendarPreviews($member,$from,$to); throw new RuntimeException('Invalid or unbounded range accepted'); }
        catch (InvalidArgumentException $error) { calendarPreviewExpect($error->getMessage()==='INVALID_SHARED_CALENDAR_RANGE','Wrong range error'); }
    }
    genesisSharedCalendarPreviews($member,'2026-10-01','2026-11-11'); // 42 days is the inclusive bound.
    $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$pid,$member]);
    $revoked=genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31');
    calendarPreviewExpect($revoked['tasks']===[] && $revoked['dateCounts']===[], 'Revoked project membership retained titles or counts');
    try { genesisSharedCalendarPreviews($member,'2026-10-01','2026-10-31',['projectIds'=>[$pid]]); throw new RuntimeException('Revoked explicit scope retained access'); }
    catch (GenesisSharedAccessException) {}
    $db->prepare('UPDATE shared_projects SET archived_at=? WHERE id=?')->execute([genesisNow(),$pid]);
    calendarPreviewExpect(!in_array($later['id'],array_column(genesisSharedCalendarPreviews($owner,'2026-10-01','2026-10-31')['tasks'],'id'),true), 'Archived project leaked into calendar');
    echo "Calendar previews: dense dates, 103-task pagination, project/priority/custom filters, encrypted projection, bounds, ACL and archive checks passed\n";
} finally {
    foreach ($spaces as $id) $db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$id]);
    foreach ($users as $id) $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
