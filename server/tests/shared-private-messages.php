<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if (!function_exists('genesisDb')) { foreach (['bootstrap','repository','google','shared-projects'] as $file) require dirname(__DIR__).'/src/'.$file.'.php'; }
function privateExpect(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }
function privateReject(callable $action): void { try{$action();}catch(GenesisSharedAccessException|InvalidArgumentException){return;}throw new RuntimeException('Private access or invalid mutation succeeded'); }
$db=genesisDb();$users=['private-owner','private-peer','private-admin','private-pending','private-outsider'];
foreach($users as $id){$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@gmail.com',$id,genesisNow(),genesisNow()]);genesisTestEnableSharedProjects($id);}
[$owner,$peer,$admin,$pending,$outsider]=$users;
try{
  $space=genesisSharedCreateSpace($owner,['title'=>'Private collaboration']);$spaceId=$space['id'];
  $invite=genesisSharedSpaceInvite($owner,$spaceId,['email'=>$pending.'@gmail.com']);
  privateExpect(count(genesisSharedSpaceInvitations($pending))===1,'Pending invitation disappeared.');
  privateReject(fn()=>genesisSharedSpaceParticipants($pending,$spaceId));privateReject(fn()=>genesisSharedSpaceParticipants($outsider,$spaceId));
  privateExpect(genesisSharedOverview($pending)['tasks']===0 && genesisSharedSpaces($pending)===[],'Invitation granted access before acceptance.');
  genesisSharedRespondSpaceInvitation($pending,$invite['id'],true);privateExpect(count(genesisSharedSpaceParticipants($pending,$spaceId)['members'])===2,'Accepted invitation did not grant access.');
  $invite=genesisSharedSpaceInvite($owner,$spaceId,['email'=>$outsider.'@gmail.com']);genesisSharedRevokeSpaceInvitation($owner,$spaceId,$invite['id']);privateReject(fn()=>genesisSharedRespondSpaceInvitation($outsider,$invite['id'],true));
  foreach([$peer=>'member',$admin=>'admin'] as $id=>$role)$db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$spaceId,$id,$role,genesisNow()]);
  $present=genesisSharedSpaceParticipants($peer,$spaceId,true);privateExpect((bool)array_filter($present['members'],fn($row)=>$row['userId']===$peer&&$row['viewing']),'Presence did not update.');
  $tabA=genesisUuid();$tabB=genesisUuid();genesisSharedSpaceParticipants($peer,$spaceId,true,$tabA);genesisSharedSpaceParticipants($peer,$spaceId,true,$tabB);genesisSharedSpaceParticipants($peer,$spaceId,false,$tabA);genesisSharedSpaceParticipants($peer,$spaceId,false);
  privateExpect((bool)array_filter(genesisSharedSpaceParticipants($owner,$spaceId)['members'],fn($row)=>$row['userId']===$peer&&$row['viewing']),'Closing one tab hid another active tab.');
  $db->prepare('UPDATE shared_space_presence SET last_seen_at=? WHERE user_id=?')->execute([time()-91,$peer]);privateExpect(!array_filter(genesisSharedSpaceParticipants($owner,$spaceId)['members'],fn($row)=>$row['userId']===$peer&&$row['viewing']),'Stale presence stayed online.');
  $project=genesisSharedCreateProject($owner,$spaceId,['title'=>'Member project']);$status=genesisSharedProjectSnapshot($owner,$project['id'])['statuses'][0]['id'];
  $db->prepare('DELETE FROM shared_project_members WHERE project_id=? AND user_id=?')->execute([$project['id'],$admin]);
  $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$project['id'],$peer,'member',genesisNow()]);
  genesisSharedTask($owner,$project['id'],['title'=>'Only assigned members','statusId'=>$status,'dueDate'=>'2026-10-14']);
  privateExpect(genesisSharedOverview($peer)['projects']===1&&genesisSharedOverview($peer)['tasks']===1,'Own counters are inaccurate.');
  privateExpect(genesisSharedOverview($admin)['projects']===0&&genesisSharedOverview($admin)['tasks']===0,'Workspace admin saw totals for projects they did not join.');
  // Real valid public points; no private scalar is ever stored by the API.
  $key=['kty'=>'EC','crv'=>'P-256','x'=>'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY','y'=>'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU'];
  $a=genesisSharedMessagingKey($owner,['publicKey'=>$key]);$b=genesisSharedMessagingKey($peer,['publicKey'=>$key]);
  privateReject(fn()=>genesisSharedMessagingKey($owner,['publicKey'=>$key+['d'=>'secret']]));
  $changed=$key;$changed['x']='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';privateReject(fn()=>genesisSharedMessagingKey($owner,['publicKey'=>$changed]));
  $conversation=genesisSharedPrivateConversation($owner,$spaceId,['userId'=>$peer]);$cid=$conversation['id'];
  privateExpect(genesisSharedPrivateConversation($peer,$spaceId,['userId'=>$owner])['id']===$cid,'Pair created duplicate conversations.');
  $payload=['version'=>1,'iv'=>'AAAAAAAAAAAAAAAA','ciphertext'=>str_repeat('A',44),'keyIds'=>[$owner=>$a['keyId'],$peer=>$b['keyId']]];$id=genesisUuid();
  privateExpect($conversation['status']==='pending'&&$conversation['initiatorId']===$owner,'New dialogue did not request consent.');
  privateExpect(genesisSharedPrivateContacts($owner)['contacts']===[]&&genesisSharedPrivateContacts($peer)['contacts']===[], 'Pending contacts escaped consent.');
  privateExpect(count(genesisSharedPrivateInbox($peer)['invitations'])===1&&genesisSharedPrivateInbox($owner)['invitations']===[]
    &&genesisSharedPrivateInbox($admin)['invitations']===[],'Invitation metadata escaped recipient ACL.');
  privateReject(fn()=>genesisSharedPrivateSave($owner,$cid,['id'=>$id,'payload'=>$payload]));
  privateReject(fn()=>genesisSharedPrivateMessages($peer,$cid));privateReject(fn()=>genesisSharedPrivateRead($peer,$cid,['seq'=>0]));
  privateReject(fn()=>genesisSharedPrivateFileChunk($owner,$cid,genesisUuid(),0,['ciphertext'=>str_repeat('A',22),'chunks'=>1,'bytes'=>16]));
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($owner,$cid,['accept'=>true]));
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($admin,$cid,['accept'=>true]));
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($outsider,$cid,['accept'=>false]));
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($peer,$cid,['accept'=>'true']));
  genesisSharedRespondPrivateInvitation($peer,$cid,['accept'=>true]);genesisSharedRespondPrivateInvitation($peer,$cid,['accept'=>true]);
  $contact=genesisSharedPrivateContacts($owner)['contacts'];
  privateExpect(count($contact)===1&&$contact[0]['id']===$cid&&$contact[0]['peerId']===$peer&&$contact[0]['unread']===0,'Accepted empty conversation disappeared.');
  privateExpect(genesisSharedPrivateContacts($admin)['contacts']===[]&&genesisSharedPrivateContacts($outsider)['contacts']===[],'Contact metadata escaped participant ACL.');
  privateExpect(!str_contains(json_encode($contact),'ciphertext')&&!str_contains(json_encode($contact),'publicKey'),'Contact list exposed content or keys.');
  privateReject(fn()=>genesisSharedPrivateContacts($owner,[],null));
  privateReject(fn()=>genesisSharedPrivateContacts($owner,'', 'not-a-cursor'));
  privateReject(fn()=>genesisSharedPrivateContacts($owner,'',str_repeat('-',36)));
  privateReject(fn()=>genesisSharedPrivateContacts($owner,str_repeat('Я',121)));
  privateExpect(genesisSharedPrivateConversation($owner,$spaceId,['userId'=>$peer])['status']==='accepted'
    &&genesisSharedPrivateInbox($peer)['invitations']===[],'Recipient acceptance did not persist.');
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($peer,$cid,['accept'=>false]));
  // Recipients without registered keys can still receive and decline a metadata-only invitation.
  $unkeyed=genesisSharedPrivateConversation($owner,$spaceId,['userId'=>$pending]);
  privateExpect(count(genesisSharedPrivateInbox($pending)['invitations'])===1,'A recipient without a key never received the invitation.');
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($pending,$unkeyed['id'],['accept'=>true]));
  genesisSharedRespondPrivateInvitation($pending,$unkeyed['id'],['accept'=>false]);genesisSharedRespondPrivateInvitation($pending,$unkeyed['id'],['accept'=>false]);
  privateExpect(genesisSharedPrivateInbox($pending)['invitations']===[]&&genesisSharedPrivateConversation($owner,$spaceId,['userId'=>$pending])['status']==='declined','Declined invitation was re-sent on polling.');
  privateReject(fn()=>genesisSharedPrivateSave($owner,$unkeyed['id'],['id'=>genesisUuid(),'payload'=>$payload]));
  // Additive upgrade leaves established conversations readable by older clients.
  $legacy=genesisUuid();[$la,$lb]=strcmp($owner,$admin)<0?[$owner,$admin]:[$admin,$owner];
  $db->prepare('INSERT INTO shared_private_conversations(id,space_id,user_a,user_b,created_at) VALUES(?,?,?,?,?)')->execute([$legacy,$spaceId,$la,$lb,genesisNow()]);
  privateExpect(genesisSharedPrivateConversation($owner,$spaceId,['userId'=>$admin])['status']==='accepted'
    &&genesisSharedPrivateMessages($admin,$legacy)['messages']===[],'Migration interrupted established dialogue access.');
  genesisSharedPrivateSave($owner,$cid,['id'=>$id,'payload'=>$payload]);genesisSharedPrivateSave($owner,$cid,['id'=>$id,'payload'=>$payload]);
  privateExpect(count(genesisSharedPrivateMessages($peer,$cid)['messages'])===1,'Retry duplicated message.');
  privateReject(fn()=>genesisSharedPrivateMessages($admin,$cid));privateReject(fn()=>genesisSharedPrivateMessages($outsider,$cid));
  privateReject(fn()=>genesisSharedPrivateSave($peer,$cid,['expectedRevision'=>1,'payload'=>$payload],'PATCH',$id));
  privateReject(fn()=>genesisSharedPrivateSave($peer,$cid,['expectedRevision'=>1],'DELETE',$id));
  privateReject(fn()=>genesisSharedPrivateSave($owner,$cid,['expectedRevision'=>2,'payload'=>$payload],'PATCH',$id));
  privateReject(fn()=>genesisSharedPrivateSave($owner,$cid,['id'=>genesisUuid(),'payload'=>$payload+['text'=>'plaintext']]));
  privateExpect(genesisSharedPrivateInbox($peer)['conversations'][0]['unread']===1&&genesisSharedPrivateInbox($admin)['conversations']===[],'Inbox violated privacy.');
  privateExpect(!str_contains(json_encode(genesisSharedPrivateInbox($peer)),'ciphertext'),'Notification leaked message body.');
  $message=genesisSharedPrivateMessages($peer,$cid)['messages'][0];genesisSharedPrivateRead($peer,$cid,['seq'=>$message['seq']]);privateExpect(genesisSharedPrivateInbox($peer)['conversations']===[],'Read receipt did not persist.');
  privateExpect(genesisSharedPrivateContacts($peer)['contacts'][0]['id']===$cid&&genesisSharedPrivateContacts($peer)['contacts'][0]['unread']===0,'Reading all messages removed the accepted contact.');
  genesisSharedPrivateSave($owner,$cid,['expectedRevision'=>1,'payload'=>$payload],'PATCH',$id);privateExpect(genesisSharedPrivateMessages($peer,$cid)['messages'][0]['revision']===2,'Edit revision failed.');
  genesisSharedPrivateSave($owner,$cid,['expectedRevision'=>2],'DELETE',$id);$message=genesisSharedPrivateMessages($peer,$cid)['messages'][0];privateExpect($message['payload']===null&&$message['deletedAt']!==null,'Deleted ciphertext survived.');
  $fileId=genesisUuid();$cipher=rtrim(strtr(base64_encode(str_repeat('X',262144)),'+/','-_'),'=');
  genesisSharedPrivateFileChunk($owner,$cid,$fileId,0,['ciphertext'=>$cipher,'chunks'=>2,'bytes'=>262160]);
  privateReject(fn()=>genesisSharedPrivateFileChunk($admin,$cid,$fileId,0));
  privateReject(fn()=>genesisSharedPrivateFileChunk($peer,$cid,$fileId,0));
  privateReject(fn()=>genesisSharedPrivateFileChunk($peer,$cid,$fileId,1,['ciphertext'=>str_repeat('A',22),'chunks'=>2,'bytes'=>262160]));
  $fileMessage=genesisUuid();privateReject(fn()=>genesisSharedPrivateSave($owner,$cid,['id'=>$fileMessage,'payload'=>$payload,'attachmentIds'=>[$fileId]]));
  $last=rtrim(strtr(base64_encode(str_repeat('Y',16)),'+/','-_'),'=');genesisSharedPrivateFileChunk($owner,$cid,$fileId,1,['ciphertext'=>$last,'chunks'=>2,'bytes'=>262160]);
  genesisSharedPrivateSave($owner,$cid,['id'=>$fileMessage,'payload'=>$payload,'attachmentIds'=>[$fileId]]);
  privateExpect(genesisSharedPrivateFileChunk($peer,$cid,$fileId,0)['ciphertext']===$cipher,'Recipient could not download encrypted file.');
  privateReject(fn()=>genesisSharedPrivateFileChunk($admin,$cid,$fileId,0));privateReject(fn()=>genesisSharedPrivateClear($outsider,$cid));
  privateReject(fn()=>genesisSharedPrivateFileChunk($owner,$cid,$fileId,0,['ciphertext'=>$cipher,'chunks'=>2,'bytes'=>262160]));
  genesisSharedPrivateSave($owner,$cid,['expectedRevision'=>1],'DELETE',$fileMessage);
  privateReject(fn()=>genesisSharedPrivateFileChunk($peer,$cid,$fileId,0));
  privateExpect((int)$db->query('SELECT COUNT(*) FROM shared_private_file_chunks')->fetchColumn()===0,'Message deletion retained chunks.');
  $next=genesisUuid();$fileId=genesisUuid();genesisSharedPrivateFileChunk($owner,$cid,$fileId,0,['ciphertext'=>$last,'chunks'=>1,'bytes'=>16]);genesisSharedPrivateSave($owner,$cid,['id'=>$next,'payload'=>$payload,'attachmentIds'=>[$fileId]]);
  genesisSharedPrivateClear($peer,$cid);privateExpect(genesisSharedPrivateMessages($owner,$cid)['messages']===[],'Conversation deletion retained messages.');privateExpect(genesisSharedPrivateInbox($peer)['conversations']===[],'Conversation deletion retained unread notifications.');
  privateExpect(count(genesisSharedPrivateContacts($peer)['contacts'])===1,'Clearing history removed the connection.');
  privateReject(fn()=>genesisSharedPrivateFileChunk($owner,$cid,$fileId,0));
  genesisSharedPrivateSave($owner,$cid,['id'=>genesisUuid(),'payload'=>$payload]);privateExpect(count(genesisSharedPrivateMessages($peer,$cid)['messages'])===1,'Conversation could not resume after deletion.');
  genesisSharedProjectComments($owner,$project['id'],['body'=>'Project discussion']);genesisSharedProjectComments($owner,$project['id'],['body'=>'Board discussion','boardId'=>$status]);privateExpect(count(genesisSharedProjectComments($peer,$project['id'],null,$status))===1,'Board comments missing');privateReject(fn()=>genesisSharedProjectComments($owner,$project['id'],['body'=>'Bad board','boardId'=>'other']));privateExpect(count(genesisSharedProjectComments($peer,$project['id']))===1,'Project comments missing.');privateReject(fn()=>genesisSharedProjectComments($outsider,$project['id']));
  $pendingAgain=genesisSharedPrivateConversation($peer,$spaceId,['userId'=>$pending]);
  // Contact pagination and Unicode search must include accepted dialogues with no messages.
  for($contactIndex=0;$contactIndex<53;$contactIndex++){
    $contactSpace=genesisSharedCreateSpace($owner,['title'=>'Пагинация Ёлка '.$contactIndex]);
    $db->prepare('INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$contactSpace['id'],$peer,'member',genesisNow()]);
    [$contactA,$contactB]=strcmp($owner,$peer)<0?[$owner,$peer]:[$peer,$owner];
    $db->prepare('INSERT INTO shared_private_conversations(id,space_id,user_a,user_b,created_at) VALUES(?,?,?,?,?)')->execute([genesisUuid(),$contactSpace['id'],$contactA,$contactB,genesisNow()]);
  }
  $firstContacts=genesisSharedPrivateContacts($peer,'ПАГИНАЦИЯ ЕЛКА');
  $lastContacts=genesisSharedPrivateContacts($peer,'ПАГИНАЦИЯ ЕЛКА',$firstContacts['nextCursor']);
  privateExpect(count($firstContacts['contacts'])===50&&count($lastContacts['contacts'])===3&&$lastContacts['nextCursor']===null,'Contact list lost pages or Unicode search.');
  privateExpect(count(array_unique(array_column(array_merge($firstContacts['contacts'],$lastContacts['contacts']),'id')))===53,'Contact cursor repeated a row.');
  privateExpect(genesisSharedPrivateContacts($peer,'NO MATCH')['contacts']===[],'Contact search leaked unrelated rows.');
  $db->prepare('DELETE FROM shared_space_members WHERE space_id=? AND user_id=?')->execute([$spaceId,$peer]);
  privateExpect(!array_filter(genesisSharedPrivateContacts($owner)['contacts'],fn($item)=>$item['id']===$cid),'Revoked membership left the contact visible.');
  privateExpect(!array_filter(genesisSharedPrivateInbox($pending)['invitations'],fn($item)=>$item['id']===$pendingAgain['id']),'Revoked membership left a visible invitation.');
  privateReject(fn()=>genesisSharedRespondPrivateInvitation($pending,$pendingAgain['id'],['accept'=>false]));
  privateReject(fn()=>genesisSharedPrivateMessages($peer,$cid));privateReject(fn()=>genesisSharedPrivateMessages($owner,$cid));
  privateExpect(genesisSharedOverview($peer)['tasks']===0&&genesisSharedCalendarTasks($peer,'2026-10-01','2026-10-31')===[],'Revoked workspace access survived in counters or calendar.');
  $backup=tempnam(sys_get_temp_dir(),'genesis-private-backup-');try{$db->exec('VACUUM INTO '.$db->quote($backup));$snapshot=new PDO('sqlite:'.$backup);privateExpect($snapshot->query('PRAGMA integrity_check')->fetchColumn()==='ok','Consistent backup failed.');privateExpect((int)$snapshot->query('SELECT COUNT(*) FROM shared_private_conversations')->fetchColumn()>=1,'Backup lost messaging metadata.');}finally{$snapshot=null;if(is_file($backup))unlink($backup);}
}finally{foreach($users as $id)if(genesisFindUser($id))genesisDeleteAccount($id);}
echo "Private messages, author/revision ACL, invitations, presence, per-user counters and backup passed.\n";
