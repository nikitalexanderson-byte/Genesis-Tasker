<?php
declare(strict_types=1);

/** Uses the existing Google session. Messaging has no separate login or password. */
function genesisMessengerUser(string $user): array
{
    $row=genesisFindUser($user);
    if (!$row) throw new GenesisSharedAccessException('AUTH_REQUIRED',401);
    return $row;
}
function genesisMessengerId(mixed $id): string
{
    if (!is_string($id) || !preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/D',$id)) throw new InvalidArgumentException('INVALID_MESSENGER_ID');
    return $id;
}
function genesisMessengerTransaction(callable $action): mixed
{
    $db=genesisDb(); genesisBeginWriteTransaction($db);
    try { $result=$action($db); $db->commit(); return $result; }
    catch(Throwable $e) { $db->rollBack(); throw $e; }
}
/** Called inside a write transaction; counting and the guarded write are atomic. */
function genesisMessengerRate(PDO $db,string $user,string $action,int $limit,int $seconds): void
{
    $window=(int)floor(time()/$seconds);
    $db->prepare('INSERT INTO messenger_rate_limits(user_id,action,window,count) VALUES(?,?,?,1) ON CONFLICT(user_id,action) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window')->execute([$user,$action,$window]);
    $q=$db->prepare('SELECT count FROM messenger_rate_limits WHERE user_id=? AND action=?');$q->execute([$user,$action]);
    if ((int)$q->fetchColumn()>$limit) throw new GenesisSharedAccessException('MESSENGER_RATE_LIMIT',429);
}
function genesisMessengerBlocked(string $a,string $b): bool
{
    $q=genesisDb()->prepare('SELECT 1 FROM messenger_blocks WHERE (owner_id=? AND blocked_id=?) OR (owner_id=? AND blocked_id=?)');$q->execute([$a,$b,$b,$a]);return (bool)$q->fetchColumn();
}
function genesisMessengerContactUser(string $user,mixed $email): array
{
    if (!is_string($email) || strlen($email)>254 || !filter_var(trim($email),FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('INVALID_EMAIL');
    $peer=genesisFindUserByEmail(trim($email));
    if (!$peer || $peer['id']===$user || genesisMessengerBlocked($user,$peer['id'])) throw new GenesisSharedAccessException('MESSENGER_CONTACT_UNAVAILABLE',404);
    return $peer;
}
function genesisMessengerPeer(string $user,array $input): array
{
    if (isset($input['email'])) return genesisMessengerContactUser($user,$input['email']);
    $peer=$input['userId']??null;
    if (!is_string($peer) || $peer===$user) throw new InvalidArgumentException('INVALID_CONTACT');
    $q=genesisDb()->prepare('SELECT 1 FROM messenger_contacts WHERE owner_id=? AND contact_id=? UNION SELECT 1 FROM shared_space_members a JOIN shared_space_members b ON b.space_id=a.space_id WHERE a.user_id=? AND b.user_id=? LIMIT 1');$q->execute([$user,$peer,$user,$peer]);
    $row=$q->fetchColumn()?genesisFindUser($peer):null;
    if (!$row || genesisMessengerBlocked($user,$peer)) throw new GenesisSharedAccessException('MESSENGER_CONTACT_UNAVAILABLE');
    return $row;
}
function genesisMessengerContacts(string $user,?array $input=null,string $method='GET'): array
{
    genesisMessengerUser($user);
    // Failed exact-email lookups also consume the discovery limit.
    if ($input!==null) genesisMessengerTransaction(fn(PDO $db)=>genesisMessengerRate($db,$user,'contact-discovery',60,3600));
    if ($input!==null) genesisMessengerTransaction(function(PDO $db) use($user,$input,$method) {
        genesisMessengerRate($db,$user,'contacts',60,3600);
        if ($method==='POST') {
            $peer=genesisMessengerContactUser($user,$input['email']??null);
            $q=$db->prepare('SELECT COUNT(*) FROM messenger_contacts WHERE owner_id=?');$q->execute([$user]);if ((int)$q->fetchColumn()>=2000) throw new GenesisSharedAccessException('MESSENGER_STORAGE_LIMIT',409);
            $db->prepare('INSERT OR IGNORE INTO messenger_contacts(owner_id,contact_id,created_at) VALUES(?,?,?)')->execute([$user,$peer['id'],genesisNow()]);
        } else {
            if (!is_string($input['userId']??null)) throw new InvalidArgumentException('INVALID_CONTACT');
            $db->prepare('DELETE FROM messenger_contacts WHERE owner_id=? AND contact_id=?')->execute([$user,$input['userId']]);
        }
    });
    $q=genesisDb()->prepare('SELECT u.id AS userId,u.display_name AS name,u.email FROM messenger_contacts c JOIN users u ON u.id=c.contact_id WHERE c.owner_id=? AND NOT EXISTS(SELECT 1 FROM messenger_blocks b WHERE (b.owner_id=? AND b.blocked_id=u.id) OR (b.owner_id=u.id AND b.blocked_id=?)) ORDER BY u.display_name,u.id');$q->execute([$user,$user,$user]);
    $contacts=$q->fetchAll();
    $q=genesisDb()->prepare('SELECT u.id AS userId,u.display_name AS name,u.email FROM messenger_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.owner_id=? ORDER BY u.display_name,u.id');$q->execute([$user]);
    return ['contacts'=>$contacts,'blocked'=>$q->fetchAll()];
}
function genesisMessengerBlock(string $user,array $input): array
{
    genesisMessengerUser($user);$peer=$input['userId']??null;$block=$input['blocked']??null;
    if (!is_string($peer) || $peer===$user || !is_bool($block)) throw new InvalidArgumentException('INVALID_CONTACT');
    return genesisMessengerTransaction(function(PDO $db) use($user,$peer,$block) {
        if ($block) $db->prepare('INSERT OR IGNORE INTO messenger_blocks(owner_id,blocked_id,created_at) VALUES(?,?,?)')->execute([$user,$peer,genesisNow()]);
        else $db->prepare('DELETE FROM messenger_blocks WHERE owner_id=? AND blocked_id=?')->execute([$user,$peer]);
        return ['ok'=>true];
    });
}
function genesisMessengerDevice(string $user,string $id): array
{
    $q=genesisDb()->prepare('SELECT * FROM messenger_devices WHERE id=? AND user_id=? AND revoked_at IS NULL');$q->execute([genesisMessengerId($id),$user]);$row=$q->fetch();
    if (!$row) throw new GenesisSharedAccessException('MESSENGER_DEVICE_REQUIRED',409);return $row;
}
function genesisMessengerDevices(string $user,?array $input=null): array
{
    genesisMessengerUser($user);
    if ($input!==null) genesisMessengerTransaction(function(PDO $db) use($user,$input) {
        $id=genesisMessengerId($input['id']??null);$jwk=$input['publicKey']??null;
        if (!is_array($jwk) || array_diff(array_keys($jwk),['kty','crv','x','y']) || ($jwk['kty']??null)!=='EC' || ($jwk['crv']??null)!=='P-256') throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
        foreach(['x','y'] as $field) {
            if (!is_string($jwk[$field]??null) || !preg_match('/\A[A-Za-z0-9_-]{43}\z/D',$jwk[$field])) throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
            $raw=base64_decode(strtr($jwk[$field],'-_','+/').'=',true);if ($raw===false || strlen($raw)!==32 || rtrim(strtr(base64_encode($raw),'+/','-_'),'=')!==$jwk[$field]) throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
        }
        // Validate the point through OpenSSL, not just its coordinate lengths.
        $point="\x04".base64_decode(strtr($jwk['x'],'-_','+/').'=').base64_decode(strtr($jwk['y'],'-_','+/').'=');
        $der=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$point;
        if (!openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n")) throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
        $canonical=json_encode(['kty'=>'EC','crv'=>'P-256','x'=>$jwk['x'],'y'=>$jwk['y']],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);$key=hash('sha256',$canonical);
        $label=genesisSharedTitle($input['label']??'GENESIS',80);$q=$db->prepare('SELECT * FROM messenger_devices WHERE id=?');$q->execute([$id]);$old=$q->fetch();
        if ($old && ($old['user_id']!==$user || $old['key_id']!==$key || $old['revoked_at']!==null)) throw new GenesisSharedAccessException('MESSENGER_DEVICE_CHANGED',409);
        if (!$old) { $q=$db->prepare('SELECT COUNT(*) FROM messenger_devices WHERE user_id=? AND revoked_at IS NULL');$q->execute([$user]);if ((int)$q->fetchColumn()>=30) throw new GenesisSharedAccessException('MESSENGER_DEVICE_LIMIT',409); }
        $now=genesisNow();$db->prepare('INSERT INTO messenger_devices(id,user_id,key_id,public_key_json,label,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at')->execute([$id,$user,$key,$canonical,$label,$now,$now]);
    });
    $q=genesisDb()->prepare('SELECT id,key_id AS keyId,label,created_at AS createdAt,last_seen_at AS lastSeenAt,revoked_at AS revokedAt FROM messenger_devices WHERE user_id=? ORDER BY created_at DESC');$q->execute([$user]);return ['devices'=>$q->fetchAll()];
}
function genesisMessengerRevokeDevice(string $user,string $id): array
{
    genesisMessengerUser($user);genesisDb()->prepare('UPDATE messenger_devices SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?')->execute([genesisNow(),genesisMessengerId($id),$user]);return ['ok'=>true];
}
/** Project access is re-evaluated on every read/write, including after removal. */
function genesisMessengerAccess(string $user,string $id,bool $write=false,?string $device=null): array
{
    genesisMessengerUser($user);$q=genesisDb()->prepare('SELECT * FROM messenger_conversations WHERE id=?');$q->execute([genesisMessengerId($id)]);$chat=$q->fetch();
    if (!$chat) throw new GenesisSharedAccessException('MESSENGER_NOT_FOUND');
    if ($chat['kind']==='project') {
        $project=genesisSharedProjectAccess($chat['project_id'],$user,$write?'comment':'read');
        if ((int)$project['is_inbox']===1 || $project['kind']!=='project') throw new GenesisSharedAccessException('MESSENGER_NOT_FOUND');
    }
    else {
        $q=genesisDb()->prepare('SELECT * FROM messenger_members WHERE conversation_id=? AND user_id=?');$q->execute([$id,$user]);$member=$q->fetch();
        if (!$member || $member['status']==='left') throw new GenesisSharedAccessException('MESSENGER_NOT_FOUND');
        $chat['member']=$member;
        if ($write && $member['status']!=='active') throw new GenesisSharedAccessException('MESSENGER_INVITATION_REQUIRED',403);
        if (in_array($chat['kind'],['direct','secret'],true)) {
            $q=genesisDb()->prepare('SELECT user_id FROM messenger_members WHERE conversation_id=? AND user_id<>?');$q->execute([$id,$user]);$peer=$q->fetchColumn();
            if (!$peer || genesisMessengerBlocked($user,$peer)) throw new GenesisSharedAccessException('MESSENGER_NOT_FOUND');
        }
        if ($write && $chat['kind']==='secret') {
            $own=genesisMessengerDevice($user,(string)$device);
            if ($member['device_id']!==$own['id'] || $member['key_id']!==$own['key_id']) throw new GenesisSharedAccessException('MESSENGER_SECRET_DEVICE_ONLY',403);
            $q=genesisDb()->prepare('SELECT COUNT(*) FROM messenger_members m JOIN messenger_devices d ON d.id=m.device_id WHERE m.conversation_id=? AND m.status=\'active\' AND d.revoked_at IS NULL');$q->execute([$id]);
            if ((int)$q->fetchColumn()!==2) throw new GenesisSharedAccessException('MESSENGER_SECRET_NOT_READY',409);
        }
    }
    return $chat;
}
function genesisMessengerMembers(array $chat): array
{
    if ($chat['kind']==='project') {
        $q=genesisDb()->prepare('SELECT u.id AS userId,u.display_name AS name,m.role,\'active\' AS status FROM shared_project_members m JOIN users u ON u.id=m.user_id JOIN shared_space_members s ON s.user_id=m.user_id AND s.space_id=? WHERE m.project_id=?');$q->execute([$chat['project_id']?genesisSharedProjectSpace($chat['project_id']):'', $chat['project_id']]);
    } else {
        $q=genesisDb()->prepare('SELECT u.id AS userId,u.display_name AS name,m.role,m.status,m.device_id AS deviceId,m.key_id AS keyId,m.public_key_json,d.revoked_at AS revokedAt FROM messenger_members m JOIN users u ON u.id=m.user_id LEFT JOIN messenger_devices d ON d.id=m.device_id WHERE m.conversation_id=? AND m.status<>\'left\' ORDER BY m.joined_at,u.id');$q->execute([$chat['id']]);
    }
    return array_map(function($m){if (array_key_exists('public_key_json',$m)) { $m['publicKey']=$m['public_key_json']===null?null:json_decode($m['public_key_json'],true);unset($m['public_key_json']); }return $m;},$q->fetchAll());
}
function genesisSharedProjectSpace(string $project): string
{
    $q=genesisDb()->prepare('SELECT space_id FROM shared_projects WHERE id=?');$q->execute([$project]);return (string)$q->fetchColumn();
}
function genesisMessengerView(string $user,array $chat): array
{
    $members=genesisMessengerMembers($chat);$title=$chat['title'];
    if (in_array($chat['kind'],['direct','secret'],true)) foreach($members as $m) if ($m['userId']!==$user) $title=$m['name'];
    if ($chat['kind']==='project') { $q=genesisDb()->prepare('SELECT title FROM shared_projects WHERE id=?');$q->execute([$chat['project_id']]);$title=(string)$q->fetchColumn(); }
    $state=genesisMessengerPersonalState($user,$chat['id']);
    $q=genesisDb()->prepare('SELECT COUNT(*) FROM messenger_messages WHERE conversation_id=? AND sender_id<>? AND deleted_at IS NULL AND seq>MAX(COALESCE((SELECT last_read_seq FROM messenger_members WHERE conversation_id=? AND user_id=?),0),CAST(? AS INTEGER))');$q->execute([$chat['id'],$user,$chat['id'],$user,$state['cleared_seq']]);
    return ['id'=>$chat['id'],'kind'=>$chat['kind'],'title'=>$title,'projectId'=>$chat['project_id'],'updatedAt'=>$chat['updated_at'],'members'=>$members,'unread'=>(int)$q->fetchColumn(),
        'hidden'=>(bool)$state['hidden'],'clearedThrough'=>(int)$state['cleared_seq']];
}
function genesisMessengerPersonalState(string $user,string $id): array
{
    $q=genesisDb()->prepare('SELECT * FROM messenger_user_state WHERE conversation_id=? AND user_id=?');$q->execute([$id,$user]);
    return $q->fetch()?:['hidden'=>0,'deleted'=>0,'cleared_seq'=>0];
}
/** Deleting a chat clears only this account's view through an immutable sequence boundary. */
function genesisMessengerVisibility(string $user,string $id,array $input): array
{
    $action=$input['action']??null;
    if(!in_array($action,['hide','show','delete'],true))throw new InvalidArgumentException('INVALID_MESSENGER_VISIBILITY');
    return genesisMessengerTransaction(function(PDO $db)use($user,$id,$action):array{
        genesisMessengerAccess($user,$id);
        $db->prepare('INSERT OR IGNORE INTO messenger_user_state(conversation_id,user_id,updated_at) VALUES(?,?,?)')->execute([$id,$user,genesisNow()]);
        if($action==='delete'){
            $q=$db->prepare('SELECT COALESCE(MAX(seq),0) FROM messenger_messages WHERE conversation_id=?');$q->execute([$id]);$last=(int)$q->fetchColumn();
            $db->prepare('UPDATE messenger_user_state SET hidden=0,deleted=1,cleared_seq=MAX(cleared_seq,?),updated_at=? WHERE conversation_id=? AND user_id=?')->execute([$last,genesisNow(),$id,$user]);
        }else $db->prepare('UPDATE messenger_user_state SET hidden=?,deleted=0,updated_at=? WHERE conversation_id=? AND user_id=?')->execute([$action==='hide'?1:0,genesisNow(),$id,$user]);
        return ['ok'=>true];
    });
}
function genesisMessengerChat(string $user,string $id): array {return genesisMessengerView($user,genesisMessengerAccess($user,$id));}
function genesisMessengerInbox(string $user): array
{
    genesisMessengerUser($user);$q=genesisDb()->prepare('SELECT DISTINCT c.* FROM messenger_conversations c LEFT JOIN messenger_members m ON m.conversation_id=c.id AND m.user_id=? LEFT JOIN messenger_user_state personal ON personal.conversation_id=c.id AND personal.user_id=? WHERE (m.status IN (\'active\',\'pending\') OR (c.kind=\'project\' AND EXISTS(SELECT 1 FROM shared_project_members p WHERE p.project_id=c.project_id AND p.user_id=?))) AND (COALESCE(personal.deleted,0)=0 OR EXISTS(SELECT 1 FROM messenger_messages fresh WHERE fresh.conversation_id=c.id AND fresh.seq>personal.cleared_seq)) ORDER BY c.updated_at DESC,c.id LIMIT 500');$q->execute([$user,$user,$user]);$rows=[];$hidden=[];
    foreach($q->fetchAll() as $chat) {try {
        genesisMessengerAccess($user,$chat['id']);$state=genesisMessengerPersonalState($user,$chat['id']);
        if($state['deleted']){
            $last=genesisDb()->prepare('SELECT COALESCE(MAX(seq),0) FROM messenger_messages WHERE conversation_id=?');$last->execute([$chat['id']]);
            if((int)$last->fetchColumn()<=(int)$state['cleared_seq'])continue;
        }
        $view=genesisMessengerView($user,$chat);
        if($state['hidden'])$hidden[]=$view;else $rows[]=$view;
    } catch(GenesisSharedAccessException) {}}
    return ['conversations'=>$rows,'hiddenConversations'=>$hidden];
}
function genesisMessengerProjects(string $user): array
{
    genesisMessengerUser($user);$q=genesisDb()->prepare('SELECT p.id,p.title FROM shared_projects p JOIN shared_project_members m ON m.project_id=p.id AND m.user_id=? JOIN shared_space_members sm ON sm.space_id=p.space_id AND sm.user_id=? WHERE p.archived_at IS NULL AND p.kind=\'project\' AND p.is_inbox=0 AND NOT EXISTS(SELECT 1 FROM shared_trash t WHERE t.kind=\'project\' AND t.object_id=p.id) ORDER BY p.title,p.id LIMIT 500');$q->execute([$user,$user]);return ['projects'=>$q->fetchAll()];
}
function genesisMessengerCreate(string $user,array $input): array
{
    genesisMessengerUser($user);
    $id=genesisMessengerId($input['id']??null);$kind=$input['kind']??null;
    if (!in_array($kind,['direct','group','project','secret'],true)) throw new InvalidArgumentException('INVALID_MESSENGER_KIND');
    if ($kind!=='project') genesisMessengerTransaction(fn(PDO $db)=>genesisMessengerRate($db,$user,'chat-discovery',120,3600));
    $cid=genesisMessengerTransaction(function(PDO $db) use($user,$input,$id,$kind) {
        $peer=null;$project=null;$device=null;$pair=null;$title='';$peers=[];
        if ($kind==='project') { $project=genesisMessengerId($input['projectId']??null);genesisSharedProjectAccess($project,$user);$pair='project:'.$project; }
        elseif ($kind==='group') {
            $title=genesisSharedTitle($input['title']??'',120);$emails=$input['emails']??null;
            if (!is_array($emails) || !array_is_list($emails) || count($emails)<1 || count($emails)>49) throw new InvalidArgumentException('INVALID_MEMBERS');
            foreach($emails as $email) {$p=genesisMessengerContactUser($user,$email);$peers[$p['id']]=$p;}
        } else {
            $peer=genesisMessengerPeer($user,$input);$peers[$peer['id']]=$peer;
            if ($kind==='direct') { $ids=[$user,$peer['id']];sort($ids,SORT_STRING);$pair='direct:'.hash('sha256',json_encode($ids)); }
            else $device=genesisMessengerDevice($user,(string)($input['deviceId']??''));
        }
        if ($pair!==null) { $q=$db->prepare('SELECT id FROM messenger_conversations WHERE pair_key=?');$q->execute([$pair]);if ($old=$q->fetchColumn())return $old; }
        $q=$db->prepare('SELECT * FROM messenger_conversations WHERE id=?');$q->execute([$id]);$old=$q->fetch();
        if ($old) {
            if ($old['creator_id']!==$user || $old['kind']!==$kind) throw new GenesisSharedAccessException('MESSENGER_CONFLICT',409);
            return $id;
        }
        genesisMessengerRate($db,$user,'create',30,86400);$now=genesisNow();
        $db->prepare('INSERT INTO messenger_conversations(id,kind,title,creator_id,project_id,pair_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')->execute([$id,$kind,$title,$user,$project,$pair,$now,$now]);
        if ($kind!=='project') {
            $add=$db->prepare('INSERT INTO messenger_members(conversation_id,user_id,role,status,device_id,key_id,public_key_json,joined_at) VALUES(?,?,?,?,?,?,?,?)');
            $add->execute([$id,$user,'owner','active',$device['id']??null,$device['key_id']??null,$device['public_key_json']??null,$now]);
            foreach($peers as $p) $add->execute([$id,$p['id'],'member',$kind==='direct'?'active':'pending',null,null,null,$now]);
        }
        return $id;
    });
    return genesisMessengerChat($user,$cid);
}
function genesisMessengerMembership(string $user,string $id,array $input): array
{
    return genesisMessengerTransaction(function(PDO $db) use($user,$id,$input) {
        $chat=genesisMessengerAccess($user,$id);$action=$input['action']??null;$own=$chat['member']??null;
        if ($chat['kind']==='project') throw new InvalidArgumentException('MESSENGER_USE_PROJECT_MEMBERS');
        if ($action==='accept' || $action==='decline') {
            if ($own['status']!=='pending') {if($action==='accept' && $own['status']==='active')return genesisMessengerView($user,$chat);throw new GenesisSharedAccessException('MESSENGER_CONFLICT',409);}
            $device=$chat['kind']==='secret'?genesisMessengerDevice($user,(string)($input['deviceId']??'')):null;
            $db->prepare('UPDATE messenger_members SET status=?,device_id=?,key_id=?,public_key_json=? WHERE conversation_id=? AND user_id=?')->execute([$action==='accept'?'active':'left',$device['id']??null,$device['key_id']??null,$device['public_key_json']??null,$id,$user]);
        } elseif ($action==='leave') {
            if ($own['role']==='owner' && $chat['kind']==='group') throw new GenesisSharedAccessException('MESSENGER_OWNER_REQUIRED',409);
            $db->prepare('UPDATE messenger_members SET status=\'left\' WHERE conversation_id=? AND user_id=?')->execute([$id,$user]);
        } elseif ($chat['kind']==='group' && $own['role']==='owner' && $own['status']==='active') {
            if ($action==='add') {
                genesisMessengerRate($db,$user,'invite',60,3600);$peer=genesisMessengerContactUser($user,$input['email']??null);
                $q=$db->prepare('SELECT COUNT(*) FROM messenger_members WHERE conversation_id=? AND status<>\'left\'');$q->execute([$id]);if ((int)$q->fetchColumn()>=50) throw new GenesisSharedAccessException('MESSENGER_MEMBER_LIMIT',409);
                $db->prepare('INSERT INTO messenger_members(conversation_id,user_id,role,status,joined_at) VALUES(?,?,\'member\',\'pending\',?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET status=CASE WHEN status=\'left\' THEN \'pending\' ELSE status END')->execute([$id,$peer['id'],genesisNow()]);
            } elseif ($action==='remove' && is_string($input['userId']??null) && $input['userId']!==$user) $db->prepare('UPDATE messenger_members SET status=\'left\' WHERE conversation_id=? AND user_id=?')->execute([$id,$input['userId']]);
            elseif ($action==='transfer' && is_string($input['userId']??null)) {
                $q=$db->prepare('SELECT 1 FROM messenger_members WHERE conversation_id=? AND user_id=? AND status=\'active\'');$q->execute([$id,$input['userId']]);if (!$q->fetchColumn())throw new InvalidArgumentException('INVALID_MEMBER');
                $db->prepare('UPDATE messenger_members SET role=CASE WHEN user_id=? THEN \'owner\' ELSE \'member\' END WHERE conversation_id=?')->execute([$input['userId'],$id]);
            } else throw new InvalidArgumentException('INVALID_MEMBERSHIP_ACTION');
        } else throw new GenesisSharedAccessException('MESSENGER_FORBIDDEN',403);
        $db->prepare('UPDATE messenger_conversations SET updated_at=? WHERE id=?')->execute([genesisNow(),$id]);
        return ['ok'=>true];
    });
}
function genesisMessengerMessages(string $user,string $id,int $before=0,?string $device=null): array
{
    $chat=genesisMessengerAccess($user,$id);if ($before<0) throw new InvalidArgumentException('INVALID_READ_CURSOR');
    if ($chat['kind']!=='project' && $chat['member']['status']!=='active') throw new GenesisSharedAccessException('MESSENGER_INVITATION_REQUIRED',403);
    if ($chat['kind']==='secret') {
        $own=genesisMessengerDevice($user,(string)$device);
        if ($chat['member']['device_id']!==$own['id'] || $chat['member']['key_id']!==$own['key_id']) throw new GenesisSharedAccessException('MESSENGER_SECRET_DEVICE_ONLY',403);
    }
    $cleared=(int)genesisMessengerPersonalState($user,$id)['cleared_seq'];
    $q=genesisDb()->prepare('SELECT * FROM messenger_messages WHERE conversation_id=? AND seq>CAST(? AS INTEGER) AND (CAST(? AS INTEGER)=0 OR seq<CAST(? AS INTEGER)) ORDER BY seq DESC LIMIT 51');$q->execute([$id,$cleared,$before,$before]);$rows=$q->fetchAll();$more=count($rows)>50;if ($more)array_pop($rows);$rows=array_reverse($rows);
    return ['messages'=>array_map(function($row) use($chat){$content=$row['content']===null?null:($chat['kind']==='secret'?$row['content']:genesisDecrypt($row['content']));return ['seq'=>(int)$row['seq'],'id'=>$row['id'],'senderId'=>$row['sender_id'],'revision'=>(int)$row['revision'],'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at'],'deletedAt'=>$row['deleted_at'],'text'=>$chat['kind']==='secret'?null:$content,'payload'=>$chat['kind']==='secret'&&$content!==null?json_decode($content,true):null];},$rows),'nextCursor'=>$more?(int)$rows[0]['seq']:null,'clearedThrough'=>$cleared];
}
function genesisMessengerSave(string $user,string $chatId,array $input,string $method='POST',?string $messageId=null): array
{
    return genesisMessengerTransaction(function(PDO $db) use($user,$chatId,$input,$method,$messageId) {
        $chat=genesisMessengerAccess($user,$chatId,true,is_string($input['deviceId']??null)?$input['deviceId']:null);$id=genesisMessengerId($messageId??($input['id']??null));
        $q=$db->prepare('SELECT * FROM messenger_messages WHERE id=?');$q->execute([$id]);$old=$q->fetch();
        if ($old && ($old['conversation_id']!==$chatId || $old['sender_id']!==$user)) throw new GenesisSharedAccessException('MESSENGER_MESSAGE_FORBIDDEN',403);
        if ($method!=='POST' && !$old) throw new GenesisSharedAccessException('MESSAGE_NOT_FOUND');
        $revision=$old?(int)$old['revision']:0;
        if ($method!=='POST' && (!is_int($input['expectedRevision']??null) || $input['expectedRevision']!==$revision)) {
            if ($method==='DELETE' && $old['deleted_at']!==null && ($input['expectedRevision']??0)===$revision-1) return ['ok'=>true,'id'=>$id,'revision'=>$revision];
            // A lost edit acknowledgement can retry the exact command after revision advanced.
            $replay=$chat['kind']==='secret'?json_encode($input['payload']??null,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR):($input['text']??null);
            $saved=$chat['kind']==='secret'?$old['content']:genesisDecrypt($old['content']);
            if ($method==='PATCH' && $old['deleted_at']===null && ($input['expectedRevision']??0)===$revision-1 && $replay===$saved) return ['ok'=>true,'id'=>$id,'revision'=>$revision];
            throw new GenesisSharedAccessException('MESSAGE_REVISION_CONFLICT',409);
        }
        $content=null;
        if ($method!=='DELETE') {
            if ($old && $old['deleted_at']!==null) throw new GenesisSharedAccessException('MESSAGE_NOT_FOUND');
            if ($chat['kind']==='secret') {
                $p=$input['payload']??null;$keys=[];foreach(genesisMessengerMembers($chat) as $m) $keys[$m['userId']]=$m['keyId'];
                if (!is_array($p) || array_diff(array_keys($p),['version','iv','ciphertext','keyIds']) || ($p['version']??null)!==1 || !is_string($p['iv']??null) || !preg_match('/\A[A-Za-z0-9_-]{16}\z/D',$p['iv']) || !is_string($p['ciphertext']??null) || !preg_match('/\A[A-Za-z0-9_-]{22,42688}\z/D',$p['ciphertext']) || !is_array($p['keyIds']??null) || count($p['keyIds'])!==2 || array_diff_assoc($keys,$p['keyIds'])) throw new InvalidArgumentException('INVALID_CIPHERTEXT');
                $content=json_encode($p,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            } else {
                $text=$input['text']??null;if (!is_string($text) || trim($text)==='' || strlen($text)>30000) throw new InvalidArgumentException('INVALID_MESSAGE');$content=$text;
            }
        }
        if ($old && $method==='POST') {
            $previous=$chat['kind']==='secret'?$old['content']:genesisDecrypt($old['content']);
            if ($previous!==$content) throw new GenesisSharedAccessException('MESSENGER_CONFLICT',409);
            return ['ok'=>true,'id'=>$id,'revision'=>$revision];
        }
        genesisMessengerRate($db,$user,'send',60,60);
        $q=$db->prepare('SELECT COUNT(*),COALESCE(SUM(length(content)),0) FROM messenger_messages WHERE sender_id=?');$q->execute([$user]);$quota=$q->fetch(PDO::FETCH_NUM);
        if (!$old && ((int)$quota[0]>=100000 || (int)$quota[1]>100*1024*1024)) throw new GenesisSharedAccessException('MESSENGER_STORAGE_LIMIT',409);
        $stored=$content===null?null:($chat['kind']==='secret'?$content:genesisEncrypt($content));$now=genesisNow();
        if (!$old) $db->prepare('INSERT INTO messenger_messages(id,conversation_id,sender_id,content,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$chatId,$user,$stored,$now,$now]);
        else $db->prepare('UPDATE messenger_messages SET content=?,revision=revision+1,updated_at=?,deleted_at=? WHERE id=?')->execute([$stored,$now,$method==='DELETE'?$now:null,$id]);
        $db->prepare('UPDATE messenger_conversations SET updated_at=? WHERE id=?')->execute([$now,$chatId]);
        return ['ok'=>true,'id'=>$id,'revision'=>$revision+1];
    });
}
function genesisMessengerRead(string $user,string $id,array $input): array
{
    $chat=genesisMessengerAccess($user,$id);$seq=$input['seq']??null;
    if (!is_int($seq) || $seq<0) throw new InvalidArgumentException('INVALID_READ_CURSOR');
    if ($chat['kind']==='secret')genesisMessengerMessages($user,$id,0,is_string($input['deviceId']??null)?$input['deviceId']:null);
    elseif ($chat['kind']!=='project' && $chat['member']['status']!=='active') throw new GenesisSharedAccessException('MESSENGER_INVITATION_REQUIRED',403);
    $q=genesisDb()->prepare('SELECT COALESCE(MAX(seq),0) FROM messenger_messages WHERE conversation_id=?');$q->execute([$id]);if ($seq>(int)$q->fetchColumn())throw new InvalidArgumentException('INVALID_READ_CURSOR');
    genesisDb()->prepare('INSERT INTO messenger_members(conversation_id,user_id,role,status,last_read_seq,joined_at) VALUES(?,?,\'member\',\'active\',?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_seq=MAX(last_read_seq,excluded.last_read_seq)')->execute([$id,$user,$seq,genesisNow()]);
    return ['ok'=>true];
}
