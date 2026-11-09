<?php
declare(strict_types=1);

/** Only public P-256 keys cross the API. Registration is immutable. */
function genesisSharedMessagingKey(string $userId, ?array $input = null): array
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb();
    if ($input !== null) {
        $jwk = $input['publicKey'] ?? null;
        if (!is_array($jwk) || array_diff(array_keys($jwk), ['kty','crv','x','y'])
            || ($jwk['kty'] ?? '') !== 'EC' || ($jwk['crv'] ?? '') !== 'P-256') throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
        foreach (['x','y'] as $field) {
            if (!is_string($jwk[$field] ?? null) || !preg_match('/\A[A-Za-z0-9_-]{43}\z/', $jwk[$field])) throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
            $bytes = base64_decode(strtr($jwk[$field], '-_', '+/') . '=', true);
            if ($bytes === false || strlen($bytes) !== 32 || rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=') !== $jwk[$field]) throw new InvalidArgumentException('INVALID_PUBLIC_KEY');
        }
        $canonical = json_encode(['kty'=>'EC','crv'=>'P-256','x'=>$jwk['x'],'y'=>$jwk['y']], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $keyId = hash('sha256', $canonical);
        $q = $db->prepare('INSERT OR IGNORE INTO shared_messaging_keys(user_id,key_id,public_key_json,created_at) VALUES(?,?,?,?)');
        $q->execute([$userId,$keyId,$canonical,genesisNow()]);
    }
    $q = $db->prepare('SELECT key_id AS keyId, public_key_json FROM shared_messaging_keys WHERE user_id=?'); $q->execute([$userId]);
    $row = $q->fetch();
    if ($input !== null && $row['keyId'] !== $keyId) throw new GenesisSharedAccessException('MESSAGING_KEY_MISMATCH',409);
    return ['keyId'=>$row['keyId'] ?? null, 'publicKey'=>isset($row['public_key_json']) ? json_decode($row['public_key_json'],true) : null];
}

function genesisSharedPrivateAccess(string $userId, string $id, bool $requireAccepted = true): array
{
    genesisSharedRequireEnabled($userId);
    $q = genesisDb()->prepare('SELECT c.*, COALESCE(i.status,\'accepted\') AS invitation_status, i.initiator_id FROM shared_private_conversations c
        JOIN shared_space_members a ON a.space_id=c.space_id AND a.user_id=c.user_a
        JOIN shared_space_members b ON b.space_id=c.space_id AND b.user_id=c.user_b
        LEFT JOIN shared_private_conversation_invitations i ON i.conversation_id=c.id
        WHERE c.id=? AND (c.user_a=? OR c.user_b=?)');
    $q->execute([$id,$userId,$userId]); $row = $q->fetch();
    if (!$row) throw new GenesisSharedAccessException('PRIVATE_CONVERSATION_NOT_FOUND');
    if ($requireAccepted && $row['invitation_status'] !== 'accepted') throw new GenesisSharedAccessException('PRIVATE_INVITATION_REQUIRED', 403);
    return $row;
}

/** Email links remain useful after a message was read on another device. */
function genesisSharedPrivateDestination(string $userId,string $id): array
{
    $conversation=genesisSharedPrivateAccess($userId,$id);
    $peer=$conversation['user_a']===$userId?$conversation['user_b']:$conversation['user_a'];
    $user=genesisFindUser($peer);
    return ['id'=>$id,'spaceId'=>$conversation['space_id'],'peerId'=>$peer,'peerName'=>$user['display_name']?:'GENESIS'];
}

function genesisSharedPrivateConversation(string $userId, string $spaceId, array $input): array
{
    genesisSharedRequireEnabled($userId); genesisSharedSpaceAccess($spaceId,$userId);
    $peer = $input['userId'] ?? null;
    if (!is_string($peer) || $peer === $userId) throw new InvalidArgumentException('INVALID_RECIPIENT');
    genesisSharedSpaceAccess($spaceId,$peer);
    [$a,$b] = strcmp($userId,$peer) < 0 ? [$userId,$peer] : [$peer,$userId];
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $q = $db->prepare('SELECT id FROM shared_private_conversations WHERE space_id=? AND user_a=? AND user_b=?'); $q->execute([$spaceId,$a,$b]);
        $id = $q->fetchColumn();
        if ($id === false) {
            $q = $db->prepare('SELECT 1 FROM shared_messaging_keys WHERE user_id=?'); $q->execute([$userId]);
            if ($q->fetchColumn() === false) throw new GenesisSharedAccessException('MESSAGING_KEY_REQUIRED',409);
            $q = $db->prepare('SELECT COUNT(*) FROM shared_private_conversation_invitations WHERE initiator_id=? AND created_at>=?');
            $q->execute([$userId,gmdate('Y-m-d\TH:i:s\Z',time()-60)]);
            if ((int)$q->fetchColumn() >= 30) throw new GenesisSharedAccessException('MESSAGE_RATE_LIMIT',429);
            $id = genesisUuid(); $now = genesisNow();
            $db->prepare('INSERT INTO shared_private_conversations(id,space_id,user_a,user_b,created_at) VALUES(?,?,?,?,?)')->execute([$id,$spaceId,$a,$b,$now]);
            $db->prepare('INSERT INTO shared_private_conversation_invitations(conversation_id,initiator_id,status,created_at) VALUES(?,?,\'pending\',?)')->execute([$id,$userId,$now]);
        }
        $row = genesisSharedPrivateAccess($userId, (string)$id, false);
        $db->commit();
        return ['id'=>$id,'spaceId'=>$spaceId,'userA'=>$a,'userB'=>$b,'status'=>$row['invitation_status'],'initiatorId'=>$row['initiator_id']];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

function genesisSharedRespondPrivateInvitation(string $userId, string $id, array $input): array
{
    if (!is_bool($input['accept'] ?? null)) throw new InvalidArgumentException('INVALID_INVITATION_RESPONSE');
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $row = genesisSharedPrivateAccess($userId, $id, false);
        if ($row['initiator_id'] === null || $row['initiator_id'] === $userId) throw new GenesisSharedAccessException('INVITATION_RECIPIENT_REQUIRED', 403);
        $status = $input['accept'] ? 'accepted' : 'declined';
        if ($row['invitation_status'] !== 'pending' && $row['invitation_status'] !== $status) throw new GenesisSharedAccessException('INVITATION_ALREADY_RESPONDED', 409);
        if ($input['accept']) {
            $q = $db->prepare('SELECT COUNT(*) FROM shared_messaging_keys WHERE user_id IN (?,?)'); $q->execute([$row['user_a'],$row['user_b']]);
            if ((int)$q->fetchColumn() !== 2) throw new GenesisSharedAccessException('RECIPIENT_KEY_REQUIRED', 409);
        }
        $db->prepare('UPDATE shared_private_conversation_invitations SET status=?,responded_at=COALESCE(responded_at,?) WHERE conversation_id=?')->execute([$status,genesisNow(),$id]);
        $db->commit(); return ['ok'=>true,'status'=>$status];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

/** A metadata-only inbox: no message bodies or private keys in notifications. */
function genesisSharedPrivateInbox(string $userId): array
{
    genesisSharedRequireEnabled($userId);
    $q = genesisDb()->prepare('SELECT c.id, c.space_id AS spaceId, s.title AS spaceTitle,
        CASE WHEN c.user_a=:user THEN c.user_b ELSE c.user_a END AS peerId,
        COALESCE(NULLIF(u.display_name,\'\'),\'GENESIS\') AS peerName,
        COUNT(m.seq) AS unread, MAX(m.seq) AS latestSeq
        FROM shared_private_conversations c JOIN shared_spaces s ON s.id=c.space_id
        JOIN shared_space_members a ON a.space_id=c.space_id AND a.user_id=c.user_a
        JOIN shared_space_members b ON b.space_id=c.space_id AND b.user_id=c.user_b
        JOIN users u ON u.id=CASE WHEN c.user_a=:user THEN c.user_b ELSE c.user_a END
        LEFT JOIN shared_private_message_reads r ON r.conversation_id=c.id AND r.user_id=:user
        LEFT JOIN shared_private_conversation_invitations i ON i.conversation_id=c.id
        JOIN shared_private_messages m ON m.conversation_id=c.id AND m.sender_id<>:user
            AND m.seq>COALESCE(r.last_read_seq,0) AND m.deleted_at IS NULL
        WHERE (c.user_a=:user OR c.user_b=:user) AND (i.status IS NULL OR i.status=\'accepted\')
        GROUP BY c.id ORDER BY latestSeq DESC LIMIT 100');
    $q->execute(['user'=>$userId]);
    $conversations = array_map(static function(array $row): array { $row['unread']=(int)$row['unread']; $row['latestSeq']=(int)$row['latestSeq']; return $row; },$q->fetchAll());
    $q = genesisDb()->prepare('SELECT c.id,c.space_id AS spaceId,s.title AS spaceTitle,i.initiator_id AS peerId,
        COALESCE(NULLIF(u.display_name,\'\'),\'GENESIS\') AS peerName,i.created_at AS createdAt
        FROM shared_private_conversation_invitations i JOIN shared_private_conversations c ON c.id=i.conversation_id
        JOIN shared_spaces s ON s.id=c.space_id JOIN users u ON u.id=i.initiator_id
        JOIN shared_space_members a ON a.space_id=c.space_id AND a.user_id=c.user_a
        JOIN shared_space_members b ON b.space_id=c.space_id AND b.user_id=c.user_b
        WHERE (c.user_a=:user OR c.user_b=:user) AND i.initiator_id<>:user AND i.status=\'pending\'
        ORDER BY i.created_at DESC,c.id DESC LIMIT 100');
    $q->execute(['user'=>$userId]);
    return ['conversations'=>$conversations,'invitations'=>$q->fetchAll()];
}

/** Accepted contacts remain available even with no messages or after all messages were read. */
function genesisSharedPrivateContacts(string $userId, mixed $search = '', mixed $cursor = null): array
{
    genesisSharedRequireEnabled($userId);
    if (!is_string($search) || mb_strlen($search, 'UTF-8') > 120 || ($cursor !== null &&
        (!is_string($cursor) || !preg_match('/\A[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/D', $cursor)))) {
        throw new InvalidArgumentException('INVALID_MESSAGE_CURSOR');
    }
    $search = str_replace('ё', 'е', mb_strtolower(trim($search), 'UTF-8'));
    $q = genesisDb()->prepare('SELECT c.id,c.space_id AS spaceId,s.title AS spaceTitle,
        CASE WHEN c.user_a=:user THEN c.user_b ELSE c.user_a END AS peerId,
        COALESCE(NULLIF(u.display_name,\'\'),\'GENESIS\') AS peerName,
        COUNT(m.seq) AS unread,COALESCE(MAX(m.seq),0) AS latestSeq
        FROM shared_private_conversations c JOIN shared_spaces s ON s.id=c.space_id
        JOIN shared_space_members a ON a.space_id=c.space_id AND a.user_id=c.user_a
        JOIN shared_space_members b ON b.space_id=c.space_id AND b.user_id=c.user_b
        JOIN users u ON u.id=CASE WHEN c.user_a=:user THEN c.user_b ELSE c.user_a END
        LEFT JOIN shared_private_conversation_invitations i ON i.conversation_id=c.id
        LEFT JOIN shared_private_message_reads r ON r.conversation_id=c.id AND r.user_id=:user
        LEFT JOIN shared_private_messages m ON m.conversation_id=c.id AND m.sender_id<>:user
            AND m.seq>COALESCE(r.last_read_seq,0) AND m.deleted_at IS NULL
        WHERE (c.user_a=:user OR c.user_b=:user) AND c.user_a<>c.user_b
            AND (i.status IS NULL OR i.status=\'accepted\') AND c.id>:cursor
            AND (:search=\'\' OR instr(genesis_fold(COALESCE(NULLIF(u.display_name,\'\'),\'GENESIS\')||\' \'||s.title),:search)>0)
        GROUP BY c.id ORDER BY c.id LIMIT 51');
    $q->execute(['user'=>$userId,'cursor'=>$cursor ?? '','search'=>$search]);
    $rows = $q->fetchAll(); $more = count($rows) > 50; $rows = array_slice($rows,0,50);
    return ['contacts'=>array_map(static function(array $row): array {
        $row['unread']=(int)$row['unread']; $row['latestSeq']=(int)$row['latestSeq']; return $row;
    },$rows),'nextCursor'=>$more ? $rows[49]['id'] : null];
}

function genesisSharedPrivateMessages(string $userId, string $conversationId, int $before = 0): array
{
    genesisSharedPrivateAccess($userId,$conversationId);
    if ($before < 0) throw new InvalidArgumentException('INVALID_MESSAGE_CURSOR');
    $q = genesisDb()->prepare('SELECT seq,id,sender_id AS senderId,payload_json,revision,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
        FROM shared_private_messages WHERE conversation_id=? AND (CAST(? AS INTEGER)=0 OR seq<CAST(? AS INTEGER)) ORDER BY seq DESC LIMIT 51');
    $q->execute([$conversationId,$before,$before]); $rows = $q->fetchAll();
    $more = count($rows)>50; $rows = array_slice($rows,0,50);
    $cursor = $more ? (int)$rows[49]['seq'] : null;
    $rows = array_map(static function(array $r): array {
        $r['payload'] = $r['payload_json'] === null ? null : json_decode($r['payload_json'],true);
        unset($r['payload_json']); $r['seq']=(int)$r['seq']; $r['revision']=(int)$r['revision']; return $r;
    }, array_reverse($rows));
    return ['messages'=>$rows,'nextCursor'=>$cursor];
}

function genesisSharedPrivatePayload(mixed $payload, array $conversation): string
{
    if (!is_array($payload) || array_diff(array_keys($payload),['version','iv','ciphertext','keyIds']) || ($payload['version'] ?? null)!==1
        || !is_string($payload['iv'] ?? null) || !preg_match('/\A[A-Za-z0-9_-]{16}\z/',$payload['iv'])
        || !is_string($payload['ciphertext'] ?? null) || !preg_match('/\A[A-Za-z0-9_-]{22,44000}\z/',$payload['ciphertext'])
        || !is_array($payload['keyIds'] ?? null) || count($payload['keyIds'])!==2) throw new InvalidArgumentException('INVALID_CIPHERTEXT');
    foreach ([$conversation['user_a'],$conversation['user_b']] as $id) {
        $q = genesisDb()->prepare('SELECT key_id FROM shared_messaging_keys WHERE user_id=?'); $q->execute([$id]);
        if (($payload['keyIds'][$id] ?? '') !== $q->fetchColumn()) throw new InvalidArgumentException('INVALID_MESSAGE_KEY');
    }
    return json_encode($payload,JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function genesisSharedPrivateSave(string $userId, string $conversationId, array $input, string $method = 'POST', ?string $id = null): array
{
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $conversation = genesisSharedPrivateAccess($userId,$conversationId);
        $id = $id ?? ($input['id'] ?? null);
        if (!is_string($id) || !preg_match('/\A[a-f0-9-]{36}\z/',$id)) throw new InvalidArgumentException('INVALID_MESSAGE_ID');
        $q = $db->prepare('SELECT * FROM shared_private_messages WHERE id=? AND conversation_id=?'); $q->execute([$id,$conversationId]); $existing = $q->fetch();
        if ($existing && $existing['sender_id'] !== $userId) throw new GenesisSharedAccessException('MESSAGE_AUTHOR_REQUIRED',403);
        if ($method!=='POST' && (!$existing || $existing['deleted_at']!==null)) throw new GenesisSharedAccessException('MESSAGE_NOT_FOUND');
        if ($method!=='POST' && ($input['expectedRevision'] ?? null)!==(int)$existing['revision']) throw new GenesisSharedAccessException('MESSAGE_REVISION_CONFLICT',409);
        $payload = $method==='DELETE' ? null : genesisSharedPrivatePayload($input['payload'] ?? null,$conversation);
        if ($payload !== null && strlen($payload)>strlen($existing['payload_json'] ?? '')) {
            $q=$db->prepare('SELECT COALESCE(SUM(length(payload_json)),0) FROM shared_private_messages WHERE sender_id=?');$q->execute([$userId]);
            if ((int)$q->fetchColumn()+strlen($payload)-strlen($existing['payload_json'] ?? '')>536870912) throw new GenesisSharedAccessException('MESSAGE_STORAGE_LIMIT',409);
        }
        if ($method==='POST' && $existing) {
            if ($existing['revision']!=1 || $existing['payload_json']!==$payload || $existing['deleted_at']!==null) throw new GenesisSharedAccessException('MESSAGE_REVISION_CONFLICT',409);
        } elseif ($method==='POST') {
            $q = $db->prepare('SELECT COUNT(*) FROM shared_private_messages WHERE sender_id=? AND created_at>=?'); $q->execute([$userId,gmdate('Y-m-d\TH:i:s\Z',time()-60)]);
            if ((int)$q->fetchColumn()>=30) throw new GenesisSharedAccessException('MESSAGE_RATE_LIMIT',429);
            $q=$db->prepare('SELECT COUNT(*) FROM shared_private_messages WHERE sender_id=?');$q->execute([$userId]);
            if((int)$q->fetchColumn()>=100000)throw new GenesisSharedAccessException('MESSAGE_STORAGE_LIMIT',409);
            $db->prepare('INSERT INTO shared_private_messages(id,conversation_id,sender_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
                ->execute([$id,$conversationId,$userId,$payload,genesisNow(),genesisNow()]);
            genesisEmailQueuePrivateMessage($conversation,$userId,$id);
        } else {
            $db->prepare('UPDATE shared_private_messages SET payload_json=?,revision=revision+1,updated_at=?,deleted_at=? WHERE id=?')
                ->execute([$payload,genesisNow(),$method==='DELETE' ? genesisNow() : null,$id]);
        }
        if ($method === 'DELETE') {
            $db->prepare('DELETE FROM shared_private_files WHERE message_id=?')->execute([$id]);
        } elseif (array_key_exists('attachmentIds', $input)) {
            $ids = $input['attachmentIds'];
            if (!is_array($ids) || !array_is_list($ids) || count($ids)>5 || count(array_unique($ids, SORT_REGULAR))!==count($ids)) throw new InvalidArgumentException('INVALID_PRIVATE_FILES');
            foreach ($ids as $fileId) {
                if (!is_string($fileId)) throw new InvalidArgumentException('INVALID_PRIVATE_FILES');
                $q=$db->prepare('SELECT f.*,COUNT(c.chunk_index) AS uploaded FROM shared_private_files f LEFT JOIN shared_private_file_chunks c ON c.file_id=f.id WHERE f.id=? GROUP BY f.id');$q->execute([$fileId]);$file=$q->fetch();
                if (!$file || $file['sender_id']!==$userId || $file['conversation_id']!==$conversationId || ($file['message_id']!==null && $file['message_id']!==$id) || (int)$file['uploaded']!==(int)$file['chunk_count']) throw new GenesisSharedAccessException('PRIVATE_FILE_NOT_READY',409);
                $db->prepare('UPDATE shared_private_files SET message_id=? WHERE id=?')->execute([$id,$fileId]);
            }
            $q=$db->prepare('SELECT id FROM shared_private_files WHERE message_id=?');$q->execute([$id]);
            foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $fileId) if (!in_array($fileId,$ids,true)) $db->prepare('DELETE FROM shared_private_files WHERE id=?')->execute([$fileId]);
        }
        $db->commit(); return ['ok'=>true,'id'=>$id];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

/** Atomic deletion leaves the conversation identity stable for either open window. */
function genesisSharedPrivateClear(string $userId, string $conversationId): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        genesisSharedPrivateAccess($userId,$conversationId);
        $db->prepare('DELETE FROM shared_private_files WHERE conversation_id=?')->execute([$conversationId]);
        $db->prepare('DELETE FROM shared_private_messages WHERE conversation_id=?')->execute([$conversationId]);
        $db->prepare('DELETE FROM shared_private_message_reads WHERE conversation_id=?')->execute([$conversationId]);
        $db->commit();
    } catch(Throwable $error) {$db->rollBack();throw $error;}
}

function genesisSharedPrivateFileChunk(string $userId,string $conversationId,string $id,int $chunk,?array $input=null): array
{
    if (!preg_match('/\A[a-f0-9-]{36}\z/',$id) || $chunk<0 || $chunk>40) throw new InvalidArgumentException('INVALID_PRIVATE_FILE');
    $db=genesisDb();
    if ($input===null) {
        genesisSharedPrivateAccess($userId,$conversationId);
        $q=$db->prepare('SELECT c.ciphertext FROM shared_private_file_chunks c JOIN shared_private_files f ON f.id=c.file_id JOIN shared_private_messages m ON m.id=f.message_id WHERE f.id=? AND f.conversation_id=? AND c.chunk_index=? AND m.deleted_at IS NULL');$q->execute([$id,$conversationId,$chunk]);
        $cipher=$q->fetchColumn();if($cipher===false)throw new GenesisSharedAccessException('PRIVATE_FILE_NOT_FOUND');
        return ['ciphertext'=>$cipher];
    }
    $count=$input['chunks']??null;$size=$input['bytes']??null;$cipher=$input['ciphertext']??null;
    if(array_diff(array_keys($input),['chunks','bytes','ciphertext']) || !is_int($count) || !is_int($size) || $size<16 || $size>10485776 || $count!==(int)ceil($size/262144) || $chunk>=$count || !is_string($cipher) || strlen($cipher)>349526 || !preg_match('/\A[A-Za-z0-9_-]+\z/',$cipher))throw new InvalidArgumentException('INVALID_PRIVATE_FILE');
    $raw=base64_decode(strtr($cipher,'-_','+/'),true);
    if($raw===false || strlen($raw)!==min(262144,$size-$chunk*262144) || rtrim(strtr(base64_encode($raw),'+/','-_'),'=')!==$cipher)throw new InvalidArgumentException('INVALID_PRIVATE_FILE');
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedPrivateAccess($userId,$conversationId);
        // Abandoned uploads cannot consume a user's quota indefinitely.
        $db->prepare('DELETE FROM shared_private_files WHERE message_id IS NULL AND created_at<?')->execute([gmdate('Y-m-d\TH:i:s\Z',time()-86400)]);
        $q=$db->prepare('SELECT * FROM shared_private_files WHERE id=?');$q->execute([$id]);$file=$q->fetch();
        if($file && ($file['sender_id']!==$userId || $file['conversation_id']!==$conversationId || $file['message_id']!==null || (int)$file['chunk_count']!==$count || (int)$file['byte_size']!==$size))throw new GenesisSharedAccessException('PRIVATE_FILE_CONFLICT',409);
        if(!$file){
            $q=$db->prepare('SELECT COALESCE(SUM(byte_size),0),COUNT(*) FROM shared_private_files WHERE sender_id=?');$q->execute([$userId]);$quota=$q->fetch(PDO::FETCH_NUM);
            if((int)$quota[0]+$size>104857600 || (int)$quota[1]>=1000)throw new GenesisSharedAccessException('MESSAGE_STORAGE_LIMIT',409);
            $db->prepare('INSERT INTO shared_private_files(id,conversation_id,sender_id,chunk_count,byte_size,created_at) VALUES(?,?,?,?,?,?)')->execute([$id,$conversationId,$userId,$count,$size,genesisNow()]);
        }
        $q=$db->prepare('SELECT ciphertext FROM shared_private_file_chunks WHERE file_id=? AND chunk_index=?');$q->execute([$id,$chunk]);$old=$q->fetchColumn();
        if($old!==false && $old!==$cipher)throw new GenesisSharedAccessException('PRIVATE_FILE_CONFLICT',409);
        $db->prepare('INSERT OR IGNORE INTO shared_private_file_chunks(file_id,chunk_index,ciphertext) VALUES(?,?,?)')->execute([$id,$chunk,$cipher]);
        $db->commit();return ['ok'=>true];
    } catch(Throwable $error){$db->rollBack();throw $error;}
}

function genesisSharedPrivateDiscardFile(string $userId,string $conversationId,string $id): void
{
    genesisSharedPrivateAccess($userId,$conversationId);
    genesisDb()->prepare('DELETE FROM shared_private_files WHERE id=? AND conversation_id=? AND sender_id=? AND message_id IS NULL')->execute([$id,$conversationId,$userId]);
}

function genesisSharedPrivateRead(string $userId, string $conversationId, array $input): void
{
    genesisSharedPrivateAccess($userId,$conversationId);
    $seq = $input['seq'] ?? null;
    if (!is_int($seq) || $seq<0) throw new InvalidArgumentException('INVALID_READ_CURSOR');
    $q = genesisDb()->prepare('SELECT COALESCE(MAX(seq),0) FROM shared_private_messages WHERE conversation_id=?'); $q->execute([$conversationId]);
    if ($seq>(int)$q->fetchColumn()) throw new InvalidArgumentException('INVALID_READ_CURSOR');
    genesisDb()->prepare('INSERT INTO shared_private_message_reads(conversation_id,user_id,last_read_seq) VALUES(?,?,?)
        ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_seq=MAX(last_read_seq,excluded.last_read_seq)')->execute([$conversationId,$userId,$seq]);
}
