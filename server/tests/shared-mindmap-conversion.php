<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if(PHP_SAPI!=='cli'||getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Explicit isolated test environment required.');
require __DIR__.'/../src/bootstrap.php';
$config=genesisConfig();$ciDirectory=getenv('GENESIS_LOCAL_CI_DIR')?:getenv('GENESIS_SMOKE_ROOT');
$browser=$config['app_url']==='http://127.0.0.1:4338'&&basename($config['db_path'])==='improvements-test.sqlite';
$ci=$config['app_url']==='https://localhost.invalid'&&is_string($ciDirectory)&&$ciDirectory!==''&&str_replace('\\','/',$config['db_path'])===str_replace('\\','/',$ciDirectory).'/genesis.sqlite';
if(!$browser&&!$ci)throw new RuntimeException('Non-fixture refused.');
foreach(['repository','google','shared-projects','mindmaps','shared-mindmaps'] as $module)require_once __DIR__.'/../src/'.$module.'.php';
function mcCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function mcReject(callable $work):void{
    try{$work();}catch(GenesisSharedAccessException $error){mcCheck($error->status===409&&$error->getMessage()==='SHARED_REQUEST_ID_CONFLICT','Unexpected conversion error: '.$error->getMessage());return;}
    throw new RuntimeException('Changed conversion request was accepted');
}
$db=genesisDb();$tag='conversion-'.genesisUuid();$owner=null;$space=null;
try{
    $owner=genesisUpsertGoogleUser(['email_verified'=>true,'sub'=>$tag,'email'=>$tag.'@example.invalid','name'=>'Synthetic conversion'],[],false)['id'];
    genesisTestEnableSharedProjects($owner);$space=genesisSharedCreateSpace($owner,['title'=>'Conversion fixture'])['id'];
    $project=genesisSharedCreateProject($owner,$space,['title'=>'Dense conversion project'])['id'];$status=genesisSharedProjectSnapshot($owner,$project)['statuses'][0]['id'];
    $map=genesisUuid();$root=genesisUuid();$node=genesisUuid();
    $document=['schemaVersion'=>1,'id'=>$map,'projectId'=>$project,'title'=>'Conversion source','pinned'=>false,'archived'=>false,
        'nodes'=>[['id'=>$root,'parentId'=>null,'kind'=>'idea','text'=>'Root','note'=>''],['id'=>$node,'parentId'=>$root,'kind'=>'idea','text'=>'Task','note'=>'']],'links'=>[]];
    genesisSaveSharedMindmap($owner,$space,$map,['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>genesisUuid(),'document'=>$document]);
    $input=['title'=>'Converted task','statusId'=>$status,'mindmapSource'=>['mapId'=>$map,'nodeId'=>$node]];
    $task=genesisSharedTask($owner,$project,$input);
    for($i=0;$i<101;$i++)genesisSharedTask($owner,$project,['title'=>'Dense fixture '.$i,'statusId'=>$status]);
    $db->prepare('UPDATE shared_tasks SET position=5000 WHERE id=?')->execute([$task['id']]);
    $page=genesisSharedProjectSnapshot($owner,$project);mcCheck($page['taskPage']['total']===102&&!in_array($task['id'],array_column($page['tasks'],'id'),true),'Fixture did not place the converted task beyond the first page');
    $replay=[...$input,'requestId'=>genesisUuid()];$result=genesisSharedTask($owner,$project,$replay);
    mcCheck($result['id']===$task['id']&&$result['title']==='Converted task','Converted task outside the first page was treated as deleted');
    mcCheck(genesisSharedTask($owner,$project,$replay)['id']===$task['id'],'Conversion receipt could not replay');
    mcReject(fn()=>genesisSharedTask($owner,$project,[...$replay,'title'=>'Changed payload']));
    mcReject(fn()=>genesisSharedTask($owner,$project,[...$replay,'mindmapSource'=>['mapId'=>$map,'nodeId'=>$root]]));
    mcCheck(genesisSharedQueryTasks($owner,['projectIds'=>[$project]])['total']===102,'Conversion retry created another task');
    echo "Mindmap conversion: existing task beyond first100, direct authorized lookup, existing-target receipt binding, changed title/node409 and exact task count passed.\n";
}finally{if($db->inTransaction())$db->rollBack();if($space)$db->prepare('DELETE FROM shared_spaces WHERE id=?')->execute([$space]);if($owner)$db->prepare('DELETE FROM users WHERE id=?')->execute([$owner]);}
