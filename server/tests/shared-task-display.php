<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
foreach(['bootstrap','repository','google','shared-projects']as$module)require dirname(__DIR__).'/src/'.$module.'.php';
if(!in_array(parse_url(genesisConfig()['app_url'],PHP_URL_HOST),['127.0.0.1','localhost.invalid'],true))throw new RuntimeException('Isolated test configuration required');
function displayExpect(bool $ok,string $why):void{if(!$ok)throw new RuntimeException($why);}
$db=genesisDb();$prefix='display-'.bin2hex(random_bytes(5));$users=[$prefix.'-owner',$prefix.'-member',$prefix.'-outsider'];[$owner,$member,$outsider]=$users;$space=null;
foreach($users as$id){$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);genesisTestEnableSharedProjects($id);}
try{
    $space=genesisSharedCreateSpace($owner,['title'=>'Task display fixture']);$project=genesisSharedCreateProject($owner,$space['id'],['title'=>'Task order']);$pid=$project['id'];
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$space['id'],$member,genesisNow()]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$pid,$member,genesisNow()]);
    $status=genesisSharedProjectSnapshot($owner,$pid)['statuses'][0]['id'];$ids=[];
    foreach(['2026-01-01T00:00:00Z','2026-10-16T12:00:00Z','2026-10-16T12:00:00Z','2026-05-01T00:00:00Z']as$i=>$date){
        $task=genesisSharedTask($owner,$pid,['title'=>'Task '.$i,'statusId'=>$status]);$ids[]=$task['id'];$db->prepare('UPDATE shared_tasks SET created_at=? WHERE id=?')->execute([$date,$task['id']]);
    }
    foreach(['createdAt'=>'DESC','createdAtAsc'=>'ASC']as$sort=>$direction){
        $cursor=null;$seen=[];$dates=[];
        do{$page=genesisSharedQueryTasks($member,['projectIds'=>[$pid]],$cursor,1,$sort);foreach($page['tasks']as$task){$seen[]=$task['id'];$dates[]=$task['createdAt'];}$cursor=$page['nextCursor'];}while($cursor!==null);
        displayExpect(count($seen)===4&&count(array_unique($seen))===4,'Pagination skipped or duplicated equal-date tasks');
        $expected=$dates;if($direction==='DESC')rsort($expected);else sort($expected);displayExpect($dates===$expected,'Creation date sort did not reach every page');
    }
    $first=genesisSharedQueryTasks($member,['projectIds'=>[$pid]],null,1,'createdAt');
    try{genesisSharedQueryTasks($member,['projectIds'=>[$pid]],$first['nextCursor'],1,'createdAtAsc');throw new RuntimeException('Cursor crossed sort orders');}catch(GenesisSharedAccessException $error){displayExpect($error->getMessage()==='SHARED_QUERY_CHANGED','Wrong cursor rejection');}
    $taskId=$ids[0];$comment=genesisSharedAddComment($owner,$pid,$taskId,['body'=>'Unread fixture']);
    $lookup=static function(string $user)use($pid,$taskId):array{return genesisSharedQueryTasks($user,['projectIds'=>[$pid],'ids'=>[$taskId]])['tasks'][0];};
    displayExpect($lookup($member)['unreadCommentCount']===1,'Unread comment was not attached to the task');
    displayExpect($lookup($owner)['unreadCommentCount']===0,'Own comment was marked unread');
    genesisSharedReadTaskUpdates($member,$pid,$taskId,['commentIds'=>[]]);displayExpect($lookup($member)['unreadCommentCount']===1,'Opening task details acknowledged hidden discussion');
    $second=genesisSharedAddComment($owner,$pid,$taskId,['body'=>'Arrived during reading']);
    genesisSharedReadTaskUpdates($member,$pid,$taskId,['commentIds'=>[$comment['id']]]);
    displayExpect($lookup($member)['unreadCommentCount']===1,'A newer comment was incorrectly acknowledged');
    $settings=genesisNotificationDefaults();$settings['types']['comments']=false;
    genesisNotificationSavePreferences($member,['settings'=>$settings,'expectedRevision'=>0]);
    genesisSharedReadTaskUpdates($member,$pid,$taskId,['commentIds'=>[$second['id']]]);
    displayExpect($lookup($member)['unreadCommentCount']===0,'Muted notifications prevented acknowledgement of viewed comments');
    try{genesisSharedQueryTasks($outsider,['projectIds'=>[$pid]]);throw new RuntimeException('Outsider read private task metadata');}catch(GenesisSharedAccessException){}
    echo "Shared task ordering, cursor boundaries, unread comments and ACL passed\n";
}finally{
    if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space['id']]);
    foreach($users as$id)$db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
}
