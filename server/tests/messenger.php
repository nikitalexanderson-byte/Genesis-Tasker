<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
foreach(['bootstrap','repository','google','shared-projects'] as $file)require_once dirname(__DIR__).'/src/'.$file.'.php';
function messengerExpect(bool $ok,string $why): void {if(!$ok)throw new RuntimeException($why);}
function messengerReject(callable $action): void {try{$action();}catch(GenesisSharedAccessException|InvalidArgumentException){return;}throw new RuntimeException('Forbidden messenger operation succeeded');}
$db=genesisDb();$prefix='messenger-'.bin2hex(random_bytes(5));$users=array_map(fn($s)=>$prefix.$s,['a','b','c']);[$a,$b,$c]=$users;
foreach($users as $u)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$u,$u,$u.'@gmail.com',$u,genesisNow(),genesisNow()]);
try {
    // Shared projects disabled: ordinary messaging still uses the authenticated account.
    messengerExpect(count(genesisMessengerContacts($a,['email'=>$b.'@gmail.com'],'POST')['contacts'])===1,'Contact add failed');
    $chat=genesisMessengerCreate($a,['id'=>genesisUuid(),'kind'=>'direct','email'=>$b.'@gmail.com']);$id=$chat['id'];
    messengerExpect(genesisMessengerCreate($b,['id'=>genesisUuid(),'kind'=>'direct','email'=>$a.'@gmail.com'])['id']===$id,'Duplicate direct chat');
    $message=genesisUuid();genesisMessengerSave($a,$id,['id'=>$message,'text'=>'Only these accounts']);genesisMessengerSave($a,$id,['id'=>$message,'text'=>'Only these accounts']);
    messengerExpect(count(genesisMessengerMessages($b,$id)['messages'])===1,'Retry duplicated message');
    $q=$db->prepare('SELECT content FROM messenger_messages WHERE id=?');$q->execute([$message]);messengerExpect(!str_contains($q->fetchColumn(),'Only these accounts'),'Cloud text stored in plaintext');
    messengerReject(fn()=>genesisMessengerMessages($c,$id));messengerReject(fn()=>genesisMessengerChat($c,$id));
    messengerReject(fn()=>genesisMessengerSave($b,$id,['expectedRevision'=>1,'text'=>'forged'],'PATCH',$message));
    genesisMessengerSave($a,$id,['expectedRevision'=>1,'text'=>'Edited'],'PATCH',$message);
    messengerReject(fn()=>genesisMessengerSave($a,$id,['expectedRevision'=>1,'text'=>'Stale'],'PATCH',$message));
    genesisMessengerRead($b,$id,['seq'=>genesisMessengerMessages($b,$id)['messages'][0]['seq']]);messengerExpect(genesisMessengerChat($b,$id)['unread']===0,'Read cursor failed');
    genesisMessengerSave($a,$id,['expectedRevision'=>2],'DELETE',$message);messengerExpect(genesisMessengerMessages($b,$id)['messages'][0]['text']===null,'Deleted text leaked');
    // Personal hiding/deletion never removes another member's history or project.
    messengerReject(fn()=>genesisMessengerVisibility($c,$id,['action'=>'hide']));
    messengerReject(fn()=>genesisMessengerVisibility($b,$id,['action'=>'invalid']));
    genesisMessengerSave($a,$id,['id'=>genesisUuid(),'text'=>'Personal mask baseline']);
    $beforeClear=genesisMessengerMessages($a,$id)['messages'];
    genesisMessengerVisibility($b,$id,['action'=>'hide']);
    messengerExpect(!array_filter(genesisMessengerInbox($b)['conversations'],fn($r)=>$r['id']===$id)
        &&count(array_filter(genesisMessengerInbox($b)['hiddenConversations'],fn($r)=>$r['id']===$id))===1,'Hidden chat was not separated');
    messengerExpect((bool)array_filter(genesisMessengerInbox($a)['conversations'],fn($r)=>$r['id']===$id),'Hiding affected the other account');
    genesisMessengerVisibility($b,$id,['action'=>'show']);
    messengerExpect(!genesisMessengerChat($b,$id)['hidden'],'Hidden chat could not be restored');
    genesisMessengerVisibility($b,$id,['action'=>'delete']);
    $cleared=genesisMessengerMessages($b,$id);
    messengerExpect($cleared['messages']===[]&&$cleared['nextCursor']===null&&$cleared['clearedThrough']>0,'Personal history did not clear');
    messengerExpect(genesisMessengerMessages($b,$id,$cleared['clearedThrough']+1)['messages']===[],'Older cursor bypassed personal deletion');
    messengerExpect(genesisMessengerMessages($a,$id)['messages']===$beforeClear,'Personal deletion changed peer history');
    messengerExpect(!array_filter(genesisMessengerInbox($b)['conversations'],fn($r)=>$r['id']===$id),'Deleted chat remained in inbox');
    genesisMessengerSave($a,$id,['id'=>genesisUuid(),'text'=>'Only the new message returns']);
    $afterClear=genesisMessengerMessages($b,$id)['messages'];
    messengerExpect(count($afterClear)===1&&$afterClear[0]['text']==='Only the new message returns','New delivery resurrected cleared history');
    messengerExpect(genesisMessengerChat($b,$id)['unread']===1&&(bool)array_filter(genesisMessengerInbox($b)['conversations'],fn($r)=>$r['id']===$id),'New delivery did not return to inbox');
    $group=genesisMessengerCreate($a,['id'=>genesisUuid(),'kind'=>'group','title'=>'Team','emails'=>[$b.'@gmail.com']]);$gid=$group['id'];
    messengerReject(fn()=>genesisMessengerMessages($b,$gid));genesisMessengerMembership($b,$gid,['action'=>'accept']);
    genesisMessengerSave($b,$gid,['id'=>genesisUuid(),'text'=>'Hello team']);
    messengerReject(fn()=>genesisMessengerMembership($b,$gid,['action'=>'add','email'=>$c.'@gmail.com']));
    genesisMessengerMembership($a,$gid,['action'=>'remove','userId'=>$b]);messengerReject(fn()=>genesisMessengerMessages($b,$gid));
    // Immutable per-device identity, independent of old account-wide key.
    $key=['kty'=>'EC','crv'=>'P-256','x'=>'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY','y'=>'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU'];
    $da=genesisUuid();$dbId=genesisUuid();$other=genesisUuid();
    genesisMessengerDevices($a,['id'=>$da,'publicKey'=>$key]);genesisMessengerDevices($b,['id'=>$dbId,'publicKey'=>$key]);genesisMessengerDevices($b,['id'=>$other,'publicKey'=>$key]);
    messengerReject(fn()=>genesisMessengerDevices($b,['id'=>$da,'publicKey'=>$key]));messengerReject(fn()=>genesisMessengerDevices($a,['id'=>genesisUuid(),'publicKey'=>$key+['d'=>'secret']]));
    $secret=genesisMessengerCreate($a,['id'=>genesisUuid(),'kind'=>'secret','email'=>$b.'@gmail.com','deviceId'=>$da]);$sid=$secret['id'];
    genesisMessengerMembership($b,$sid,['action'=>'accept','deviceId'=>$dbId]);
    $chat=genesisMessengerChat($a,$sid);$keys=[];foreach($chat['members'] as $m)$keys[$m['userId']]=$m['keyId'];
    $payload=['version'=>1,'iv'=>'AAAAAAAAAAAAAAAA','ciphertext'=>str_repeat('A',44),'keyIds'=>$keys];
    genesisMessengerSave($a,$sid,['id'=>genesisUuid(),'deviceId'=>$da,'payload'=>$payload]);
    messengerExpect(count(genesisMessengerMessages($b,$sid,0,$dbId)['messages'])===1,'Secret recipient cannot read');
    messengerReject(fn()=>genesisMessengerMessages($b,$sid,0,$other));messengerReject(fn()=>genesisMessengerSave($b,$sid,['id'=>genesisUuid(),'deviceId'=>$other,'payload'=>$payload]));
    genesisMessengerRevokeDevice($b,$dbId);messengerReject(fn()=>genesisMessengerMessages($b,$sid,0,$dbId));messengerReject(fn()=>genesisMessengerSave($a,$sid,['id'=>genesisUuid(),'deviceId'=>$da,'payload'=>$payload]));
    // Project membership is live, never an old snapshot in the chat.
    foreach([$a,$b] as $u)genesisTestEnableSharedProjects($u);
    $space=genesisSharedCreateSpace($a,['title'=>'Messenger project']);$spaceId=$space['id'];
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$spaceId,$b,'member',genesisNow()]);
    $project=genesisSharedCreateProject($a,$spaceId,['title'=>'One topic']);$pid=$project['id'];
    $db->prepare('INSERT OR IGNORE INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$pid,$b,'member',genesisNow()]);
    $pc=genesisMessengerCreate($a,['id'=>genesisUuid(),'kind'=>'project','projectId'=>$pid]);
    messengerExpect(genesisMessengerProjects($b)['projects']!==[],'Project picker empty');
    genesisMessengerSave($a,$pc['id'],['id'=>genesisUuid(),'text'=>'Project topic']);genesisMessengerMessages($b,$pc['id']);
    $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$pid,$b]);
    messengerReject(fn()=>genesisMessengerMessages($b,$pc['id']));messengerExpect(!array_filter(genesisMessengerInbox($b)['conversations'],fn($r)=>$r['id']===$pc['id']),'Revoked project metadata leaked');
    genesisMessengerBlock($b,['userId'=>$a,'blocked'=>true]);messengerReject(fn()=>genesisMessengerCreate($a,['id'=>genesisUuid(),'kind'=>'direct','email'=>$b.'@gmail.com']));messengerExpect(genesisMessengerContacts($a)['contacts']===[],'Blocked contact leaked');
    echo "Messenger ACL, encryption, devices, idempotency and projects: OK\n";
} finally {foreach($users as $u)$db->prepare('DELETE FROM users WHERE id=?')->execute([$u]);}
