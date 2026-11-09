<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated'||!defined('GENESIS_LOCAL_TEST_CONFIG'))
    throw new RuntimeException('Explicit isolated fixture required');
foreach(['bootstrap','repository','google','shared-projects','shared-google','shared-maintenance'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
if(genesisConfig()['app_url']!=='https://localhost.invalid')throw new RuntimeException('Only synthetic CI fixture allowed');
function rqCheck(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);}
function rqReject(callable $action,string $code):void {
    try{$action();}catch(GenesisSharedAccessException|GenesisResourceLimitException|InvalidArgumentException $error){rqCheck($error->getMessage()===$code,'Expected '.$code.', got '.$error->getMessage());return;}
    throw new RuntimeException('Expected rejection '.$code);
}
function rqUser(string $plan):string {
    $id='root-quota-'.genesisUuid();$now=genesisNow();
    genesisDb()->prepare('INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
        ->execute([$id,$id,$id.'@example.invalid','Quota fixture',$plan,$plan==='premium4life'?null:'2035-01-01T00:00:00Z',$now,$now]);return $id;
}
function rqCount(string $owner):int {return genesisSharedUserResourceUsage($owner,'shared-projects')['count'];}
function rqMove(string $actor,string $project,?string $parent):array {
    $state=genesisSharedProjectAccess($project,$actor,'manage');
    return genesisSharedUpdateProject($actor,$project,['expectedRevision'=>(int)$state['revision'],'parentId'=>$parent]);
}
function rqTree(string $mode,?string $parent=null):array {
    return ['transferId'=>genesisUuid(),'mode'=>$mode,'targetParentId'=>$parent,'projects'=>[
        ['sourceId'=>'root','parentSourceId'=>null,'title'=>'Imported root'],
        ['sourceId'=>'child','parentSourceId'=>'root','title'=>'Imported child'],
        ['sourceId'=>'grandchild','parentSourceId'=>'child','title'=>'Imported grandchild'],
    ],'categories'=>[],'tasks'=>[]];
}
/** Two PHP connections start together; both must re-read the pool after the SQLite writer lock. */
function rqRace(string $owner,string $space,string $parent,string $mode,array $children=[]):void {
    $directory=sys_get_temp_dir().'/root-race-'.bin2hex(random_bytes(6));mkdir($directory,0700);$gate=$directory.'/go';$workers=[];$files=[];
    try{
        for($i=0;$i<2;$i++){
            $request=$mode==='import'?rqTree('copy'):['title'=>'Concurrent root'];
            $operation=$mode==='import'?'genesisSharedImportProjectTree($actor,$space,$input)':($mode==='promote'
                ?'genesisSharedUpdateProject($actor,$input["id"],["expectedRevision"=>$input["revision"],"parentId"=>null])'
                :'genesisSharedCreateProject($actor,$space,$input)');
            if($mode==='promote'){$row=genesisSharedProjectAccess($children[$i],$owner);$request=['id'=>$children[$i],'revision'=>(int)$row['revision']];}
            $file=$directory.'/worker-'.$i.'.php';$files[]=$file;
            file_put_contents($file,'<?php require '.var_export(__DIR__.'/../src/bootstrap.php',true).'; require '.var_export(__DIR__.'/../src/repository.php',true).'; require '.var_export(__DIR__.'/../src/google.php',true).'; require '.var_export(__DIR__.'/../src/shared-projects.php',true).';'
                .'$actor='.var_export($owner,true).';$space='.var_export($space,true).';$input='.var_export($request,true).';$gate='.var_export($gate,true).';'
                .'$end=microtime(true)+10;while(!is_file($gate)){if(microtime(true)>$end)exit(44);usleep(10000);}try{$result='.$operation.';echo json_encode($result);exit(0);}catch(GenesisResourceLimitException $e){exit($e->getMessage()==="SUBSCRIPTION_QUOTA_shared-projects"?42:43);}');
            $command=[PHP_BINARY];if(($ini=php_ini_loaded_file())!==false)array_push($command,'-c',$ini);$command[]=$file;
            $process=proc_open($command,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,dirname(__DIR__,2));rqCheck(is_resource($process),'Cannot start quota worker');fclose($pipes[0]);$workers[]=[$process,$pipes];
        }
        touch($gate);$outcomes=[];$winner=null;
        foreach($workers as [$process,$pipes]){$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($process);$outcomes[]=$code;if($code===0)$winner=json_decode($out,true,32,JSON_THROW_ON_ERROR);rqCheck($code===0||$code===42,'Unexpected race outcome '.$code.' '.$err);}
        $workers=[];sort($outcomes);rqCheck($outcomes===[0,42]&&rqCount($owner)===100,$mode.' race exceeded root quota');
        rqMove($owner,$winner['rootProjectId']??$winner['id'],$parent);rqCheck(rqCount($owner)===99,'Race reset did not release exactly one root slot');
    }finally{
        foreach($workers as [$process,$pipes]){foreach([1,2] as $p)if(is_resource($pipes[$p]))fclose($pipes[$p]);proc_terminate($process);proc_close($process);}
        foreach($files as $file)if(is_file($file))unlink($file);if(is_file($gate))unlink($gate);rmdir($directory);
    }
}
$db=genesisDb();$owner=rqUser('business');$member=rqUser('premium4life');$guest=rqUser('business');
rqCheck(rqCount($owner)===0&&genesisSharedProjectQuota(genesisSharedUserResourceUsage($owner,'shared-projects'))===['count'=>0,'limit'=>100,'remaining'=>100,'ownerId'=>$owner],'Empty owner pool contract');
$a=genesisSharedCreateSpace($owner,['title'=>'Owner A'])['id'];$b=genesisSharedCreateSpace($owner,['title'=>'Owner B'])['id'];$foreign=genesisSharedCreateSpace($member,['title'=>'Foreign owned'])['id'];
rqCheck(rqCount($owner)===0,'Empty spaces reserved project slots');
foreach([$a,$b] as $space)$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'member',1,?)")->execute([$space,$member,genesisNow()]);
$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'guest',?)")->execute([$a,$guest,genesisNow()]);
$root=genesisSharedCreateProject($owner,$a,['title'=>'Main root'])['id'];
genesisSharedCreateProject($member,$b,['title'=>'Member-created root']);
$foreignRoot=genesisSharedCreateProject($member,$foreign,['title'=>'Own foreign root'])['id'];
rqCheck(rqCount($owner)===2&&rqCount($member)===1,'Creator/participant changed owner attribution');
for($i=2;$i<99;$i++)genesisSharedCreateProject($i%2?$member:$owner,$i%2?$a:$b,['title'=>'Root '.$i]);
rqCheck(rqCount($owner)===99,'Cross-space pool at99');genesisSharedCreateSpace($owner,['title'=>'Empty at99']);rqCheck(rqCount($owner)===99,'Empty space consumed capacity');
rqReject(fn()=>genesisSharedCreateProject($guest,$a,['title'=>'Forbidden']),'SHARED_SPACE_FORBIDDEN');
$last=genesisSharedCreateProject($member,$a,['title'=>'Last root'])['id'];rqCheck(rqCount($owner)===100&&rqCount($member)===1,'Final slot counted against creator');
$before=(int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn();
rqReject(fn()=>genesisSharedCreateProject($member,$a,['title'=>'Overflow']),'SUBSCRIPTION_QUOTA_shared-projects');
rqReject(fn()=>genesisSharedCreateSpace($owner,['title'=>'No space at100']),'SUBSCRIPTION_QUOTA_shared-projects');
rqCheck((int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn()===$before,'Rejected root/space left partial rows');
$child=genesisSharedCreateProject($member,$a,['title'=>'Allowed child','parentId'=>$root])['id'];
genesisSharedCreateProject($member,$a,['title'=>'Allowed task list','kind'=>'task-list','parentId'=>$child]);
rqReject(fn()=>genesisSharedCreateProject($member,$foreign,['title'=>'Cross-space parent','parentId'=>$root]),'SHARED_PROJECT_NOT_FOUND');
rqReject(fn()=>rqMove($member,$child,null),'SUBSCRIPTION_QUOTA_shared-projects');rqCheck(genesisSharedProjectAccess($child,$owner)['parent_id']===$root,'Rejected promotion changed parent');
rqMove($member,$last,$root);rqCheck(rqCount($owner)===99,'Demotion did not release slot');rqMove($member,$child,null);rqCheck(rqCount($owner)===100,'Promotion did not consume slot');
rqReject(fn()=>rqMove($owner,$root,$last),'PROJECT_CYCLE');rqMove($member,$child,$root);rqMove($member,$last,null);
genesisSharedSetArchived($member,$last,true);rqCheck(rqCount($owner)===100,'Archive freed a retained root slot');genesisSharedSetArchived($member,$last,false);
$state=genesisSharedProjectAccess($root,$owner);genesisSharedTrashProject($owner,$root,['expectedRevision'=>(int)$state['revision']]);rqCheck(rqCount($owner)===100,'Trash freed retained root slot');
genesisSharedRestoreTrash($owner,$a,'project',$root,[]);rqCheck(rqCount($owner)===100,'Restore grew retained root pool');
$nestedImport=rqTree('copy',$root);$receipt=genesisSharedImportProjectTree($member,$a,$nestedImport);rqCheck(rqCount($owner)===100&&count($receipt['projectIds'])===3,'Nested copy charged roots');
rqCheck(genesisSharedImportProjectTree($member,$a,$nestedImport)===$receipt,'Copy retry duplicated retained data');
rqReject(fn()=>genesisSharedImportProjectTree($member,$a,rqTree('move')),'SUBSCRIPTION_QUOTA_shared-projects');
$templateOptions=['spaceId'=>$a,'anchorDate'=>'2026-11-03','parentProjectId'=>$root];
$preview=genesisSharedPreviewTemplate($owner,'system:launch',$templateOptions);rqCheck($preview['canApply'],'Nested template blocked by root quota');
$template=genesisSharedApplyTemplate($owner,'system:launch',[...$templateOptions,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);rqCheck(rqCount($owner)===100,'Nested template consumed root');
$rootPreview=genesisSharedPreviewTemplate($owner,'system:launch',[...$templateOptions,'parentProjectId'=>null]);rqCheck(!$rootPreview['canApply']&&in_array('SUBSCRIPTION_QUOTA_shared-projects',array_column($rootPreview['blockers'],'code'),true),'Root template preview bypassed full pool');
$data=genesisDataEmpty('Nested file');$data['projects']=[['key'=>'import-root','title'=>'Nested data root','kind'=>'project','layout'=>'list','statuses'=>[['key'=>'open','title'=>'Open','isDone'=>false],['key'=>'done','title'=>'Done','isDone'=>true]]],['key'=>'import-child','parentKey'=>'import-root','title'=>'Nested data child','kind'=>'project','layout'=>'list','statuses'=>[['key'=>'child-open','title'=>'Open','isDone'=>false],['key'=>'child-done','title'=>'Done','isDone'=>true]]]];
$command=['format'=>'json','content'=>genesisDataJson($data),'spaceId'=>$a,'parentProjectId'=>$root];$preview=genesisSharedDataPreview($owner,$command);rqCheck($preview['canApply'],'Nested file preview blocked');
genesisSharedDataApply($owner,[...$command,'operationId'=>genesisUuid(),'fingerprint'=>$preview['fingerprint']]);rqCheck(rqCount($owner)===100,'Nested file consumed root slot');
$preview=genesisSharedDataPreview($owner,[...$command,'parentProjectId'=>null]);rqCheck(!$preview['canApply']&&in_array('SUBSCRIPTION_QUOTA_shared-projects',array_column($preview['blockers'],'code'),true),'File preview ignored owner pool');
// Real SQL migration plus API reader must handle more than both former total-node ceilings.
genesisBeginWriteTransaction($db);$insert=$db->prepare("INSERT INTO shared_projects(id,space_id,parent_id,title,created_by,created_at,updated_at) VALUES(?,?,?,'Capacity child',?,?,?)");$membership=$db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'owner',?)");
for($i=0;$i<2100;$i++){$id=genesisUuid();$insert->execute([$id,$a,$root,$owner,genesisNow(),genesisNow()]);$membership->execute([$id,$owner,genesisNow()]);}$db->commit();
rqCheck(count(genesisSharedProjects($owner,$a))>2100&&rqCount($owner)===100,'Existing subprojects were truncated/counted against roots');
genesisSharedCreateProject($owner,$a,['title'=>'Child after2100','parentId'=>$root]);
$spaces=genesisSharedSpaces($member);$mine=array_values(array_filter($spaces,fn($s)=>$s['id']===$a))[0];rqCheck($mine['projectQuota']===['count'=>100,'limit'=>100,'remaining'=>0,'ownerId'=>$owner],'Member summary used own pool');
rqReject(fn()=>genesisSharedSpaceSettings($guest,$foreign),'SHARED_PROJECT_NOT_FOUND');
for($i=1;$i<99;$i++)genesisSharedCreateProject($member,$foreign,['title'=>'Elite root '.$i]);
$raceChildren=[];for($i=0;$i<2;$i++)$raceChildren[]=genesisSharedCreateProject($member,$foreign,['title'=>'Race child','parentId'=>$foreignRoot])['id'];
foreach(['create','import','promote'] as $mode)rqRace($member,$foreign,$foreignRoot,$mode,$raceChildren);
// A member's full personal pool must not block a root charged to the space owner's pool.
rqCheck(rqCount($member)===99&&rqCount($owner)===100,'Unexpected pools before capped-member scenario');
genesisSharedCreateProject($member,$foreign,['title'=>'Last own root']);
rqCheck(rqCount($member)===100&&rqCount($owner)===100,'Filling the member pool changed the foreign owner pool');
rqMove($owner,$last,$root);
$cappedBefore=['member'=>rqCount($member),'owner'=>rqCount($owner)];
rqCheck($cappedBefore===['member'=>100,'owner'=>99],'Owner demotion did not release a foreign slot independently');
$rowsBefore=(int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn();
$cappedRoot=genesisSharedCreateProject($member,$b,['title'=>'Own pool full, foreign owner slot']);
$savedRoot=genesisSharedProjectAccess($cappedRoot['id'],$member);
$rootPersisted=$savedRoot['id']===$cappedRoot['id']&&$savedRoot['space_id']===$b&&$savedRoot['parent_id']===null&&$savedRoot['created_by']===$member;
$cappedAfter=['member'=>rqCount($member),'owner'=>rqCount($owner)];
$rowsAfterRoot=(int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn();
rqCheck($rootPersisted&&$rowsAfterRoot===$rowsBefore+1,'Capped member foreign root was not persisted exactly once');
rqCheck($cappedAfter===['member'=>100,'owner'=>100],'Foreign root consumed the member pool instead of the owner pool');
rqReject(fn()=>genesisSharedCreateProject($member,$b,['title'=>'Both pools full overflow']),'SUBSCRIPTION_QUOTA_shared-projects');
$cappedRejected=['member'=>rqCount($member),'owner'=>rqCount($owner)];
$rowsAfterReject=(int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn();
rqCheck($cappedRejected===$cappedAfter&&$rowsAfterReject===$rowsAfterRoot,'Rejected capped-member root changed counts or left a partial row');
$cappedChild=genesisSharedCreateProject($member,$a,['title'=>'Child with both pools full','parentId'=>$root]);
$savedChild=genesisSharedProjectAccess($cappedChild['id'],$member);
$childPersisted=$savedChild['id']===$cappedChild['id']&&$savedChild['space_id']===$a&&$savedChild['parent_id']===$root&&$savedChild['created_by']===$member;
$cappedAfterChild=['member'=>rqCount($member),'owner'=>rqCount($owner)];
$rowsAfterChild=(int)$db->query('SELECT COUNT(*) FROM shared_projects')->fetchColumn();
rqCheck($childPersisted&&$rowsAfterChild===$rowsAfterReject+1,'Child with both pools full was not persisted exactly once');
rqCheck($cappedAfterChild===$cappedAfter,'Child with both pools full consumed a root slot');
echo 'PASS capped member foreign owner quota: '.json_encode([
    'before'=>$cappedBefore,'afterRoot'=>$cappedAfter,'rootPersisted'=>$rootPersisted,'rootRowDelta'=>$rowsAfterRoot-$rowsBefore,
    'rejectionCode'=>'SUBSCRIPTION_QUOTA_shared-projects','afterReject'=>$cappedRejected,'rejectedRowDelta'=>$rowsAfterReject-$rowsAfterRoot,
    'afterChild'=>$cappedAfterChild,'childPersisted'=>$childPersisted,'childRowDelta'=>$rowsAfterChild-$rowsAfterReject,
],JSON_THROW_ON_ERROR)."\n";
$db->prepare("UPDATE users SET subscription_plan='free',subscription_valid_until=NULL WHERE id=?")->execute([$owner]);
rqCheck(genesisSharedOwnerResourceUsage($a,'shared-projects')['limit']===0,'Expired/free owner has unbounded pool');
rqCheck(genesisSharedProjectAccess($root,$owner)['id']===$root,'Downgrade lost existing reads');rqReject(fn()=>genesisSharedCreateProject($member,$a,['title'=>'Expired owner bypass']),'SUBSCRIPTION_QUOTA_shared-projects');
rqCheck($db->query('PRAGMA foreign_key_check')->fetchAll()===[],'Quota operations broke foreign keys');
echo "PASS root pool: owner/member attribution, own100 member using foreign99-to100, child at both caps, 0/99/100/101, space gate, unlimited nested nodes, ACL, copy/move/template/file imports, archive/trash restore, root conversion, downgrade read and three two-process races.\n";
