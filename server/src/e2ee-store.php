<?php
declare(strict_types=1);
require_once __DIR__ . '/e2ee-commands.php';

/** Transport/storage has no unwrap/decrypt API and accepts no client root/private keys. */
function genesisE2eeJson(mixed $value): string { return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function genesisE2eeAllowedContentDomains(string $kind): array
{
    if ($kind === 'personal') return ['workspace','diary','dream-journal','mindmap','physis','aurora','stoicheion','attachment','local-snapshot','outbox','draft','key-check'];
    if ($kind === 'project' || $kind === 'space') return ['shared-project','shared-comment','mindmap','attachment','key-check'];
    throw new InvalidArgumentException('E2EE_INVALID_SCOPE');
}
function genesisE2eeRow(PDO $db, string $sql, array $parameters): array|false
{
    $q = $db->prepare($sql); $q->execute($parameters); $row = $q->fetch(); $q->closeCursor(); return $row;
}
function genesisE2eeAccess(string $actor, string $kind, string $resource, string $permission): void
{
    if ($kind === 'personal') {
        if (!hash_equals($actor, $resource)) throw new GenesisResourceLimitException(403, 'E2EE_SCOPE_FORBIDDEN');
    } elseif ($kind === 'project') {
        genesisSharedProjectAccess($resource, $actor, $permission === 'manage' ? 'owner' : $permission, true);
    } elseif ($kind === 'space') {
        $space = genesisSharedSpaceAccess($resource, $actor);
        if ($permission !== 'read' && $space['member_role'] !== 'owner') throw new GenesisResourceLimitException(403, 'E2EE_SCOPE_FORBIDDEN');
    } else throw new InvalidArgumentException('E2EE_INVALID_SCOPE');
}
function genesisE2eeScope(string $actor, string $scopeId, string $permission = 'read'): array
{
    $row = genesisE2eeRow(genesisDb(), 'SELECT * FROM e2ee_scopes WHERE scope_id=?', [genesisE2eeIdentifier($scopeId)]);
    if (!$row) throw new GenesisResourceLimitException(404, 'E2EE_SCOPE_NOT_FOUND');
    genesisE2eeAccess($actor, $row['kind'], $row['resource_id'], $permission);
    return $row;
}
/** The current ACL role is signed by the pinned owner during enrollment. */
function genesisE2eeDeviceRole(string $actor, array $scope): string
{
    genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'read');
    if($actor===$scope['owner_id'])return 'owner';
    if($scope['kind']==='project') {
        $project=genesisSharedProjectAccess($scope['resource_id'],$actor,'read',true);
        return $project['permissions']['editTasks']?'writer':($project['permissions']['comment']?'commenter':'reader');
    }
    return 'reader';
}
function genesisE2eeRequireDirectoryAuthority(array $scope, array|false $device, bool $recovery): void
{
    if(!$recovery && (!$device || $device['user_id']!==$scope['owner_id'] || $device['role']!=='owner'))
        throw new GenesisResourceLimitException(403,'E2EE_DIRECTORY_FORBIDDEN');
    genesisE2eeAccess($scope['owner_id'],$scope['kind'],$scope['resource_id'],'manage');
}
function genesisE2eeEpochKeys(PDO $db,string $scopeId): array
{
    $epochs=[];$q=$db->prepare('SELECT signed_command FROM e2ee_events WHERE scope_id=? ORDER BY revision');$q->execute([$scopeId]);
    while($row=$q->fetch()) {
        $event=json_decode($row['signed_command'],true,512,JSON_THROW_ON_ERROR)['command'];
        if($event['action']==='bootstrap')$epochs[1]=$event['payload']['keyId'];
        elseif($event['action']==='rotate')$epochs[$event['payload']['cryptoEpoch']]=$event['payload']['keyId'];
    }$q->closeCursor();return $epochs;
}
function genesisE2eeCapsule(mixed $source): array
{
    $capsule = genesisE2eeExactFields($source, ['suite','enc','ciphertext']);
    if ($capsule['suite'] !== 'DHKEM-P256-HKDFSHA256-A256GCM') genesisE2eeInvalid();
    $enc = genesisE2eeDecode($capsule['enc'], 65);
    if ($enc[0] !== "\4") genesisE2eeInvalid();
    genesisE2eeDecode($capsule['ciphertext'], 48);
    return $capsule;
}
function genesisE2eePublicKeys(mixed $source): array
{
    $keys = genesisE2eeExactFields($source, ['signingKey','receivingKey']);
    genesisE2eePublicPem($keys['signingKey']);
    $receiving = genesisE2eeDecode($keys['receivingKey'], 65);
    if ($receiving[0] !== "\4") genesisE2eeInvalid();
    // OpenSSL validates that the uncompressed point lies on P-256.
    genesisE2eePublicPem(rtrim(strtr(base64_encode(hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $receiving), '+/', '-_'), '='));
    return $keys;
}
function genesisE2eeRecoveryKit(mixed $source, string $owner): array
{
    $kit = genesisE2eeExactFields($source, ['protocol','ownerId','authority','protectedKeys']);
    if ($kit['protocol'] !== 1 || $kit['ownerId'] !== $owner) genesisE2eeInvalid();
    genesisE2eePublicKeys($kit['authority']);
    $bundle = genesisE2eeExactFields($kit['protectedKeys'], ['protocol','ownerId','purpose','salt','nonce','ciphertext']);
    if ($bundle['protocol'] !== 1 || $bundle['ownerId'] !== $owner || $bundle['purpose'] !== 'recovery-authority') genesisE2eeInvalid();
    genesisE2eeDecode($bundle['salt'], 32); genesisE2eeDecode($bundle['nonce'], 12); genesisE2eeDecode($bundle['ciphertext'], 16, 65552);
    return $kit;
}

/** First trust is pinned in the independently saved recovery kit, never a server boolean. */
function genesisE2eeBootstrap(string $actor, mixed $source): array
{
    $packet = genesisE2eeExactFields($source, ['command','signature']); $command = genesisE2eeCommand($packet['command']);
    $p = genesisE2eeExactFields($command['payload'], ['kind','resourceId','keyId','generation','recoveryKit','recoveryCapsule','deviceKeys','deviceCapsule','selfProof']);
    genesisE2eeIdentifier($p['resourceId']); genesisE2eeIdentifier($p['keyId']); genesisE2eeInteger($p['generation'], 1);
    if ($command['action'] !== 'bootstrap' || $command['ownerId'] !== $actor || $command['expectedRevision'] !== 0
        || $command['checkpointHash'] !== 'genesis' || $command['securityEpoch'] !== 1 || $command['deviceId'] === 'recovery') genesisE2eeInvalid();
    genesisE2eeAccess($actor, $p['kind'], $p['resourceId'], 'manage');
    $kit = genesisE2eeRecoveryKit($p['recoveryKit'], $actor); $keys = genesisE2eePublicKeys($p['deviceKeys']);
    genesisE2eeCapsule($p['deviceCapsule']); genesisE2eeCapsule($p['recoveryCapsule']);
    genesisE2eeVerifyCommand($packet, $kit['authority']['signingKey']);
    // Device possession signs the bootstrap excluding its own proof (recovery signs everything).
    $selfCommand = $command; unset($selfCommand['payload']['selfProof']);
    if (openssl_verify(genesisE2eeCommandBytes($selfCommand), genesisE2eeSignatureDer(genesisE2eeDecode($p['selfProof'], 64)),
        genesisE2eePublicPem($keys['signingKey']), OPENSSL_ALGO_SHA256) !== 1) throw new DomainException('E2EE_UNTRUSTED_DEVICE');
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $existing=genesisE2eeRow($db, 'SELECT * FROM e2ee_scopes WHERE scope_id=? OR (kind=? AND resource_id=?)', [$command['scopeId'],$p['kind'],$p['resourceId']]);
        if($existing) {
            $receipt=genesisE2eeRow($db,'SELECT * FROM e2ee_receipts WHERE scope_id=? AND operation_id=?',[$command['scopeId'],$command['operationId']]);
            if($existing['scope_id']===$command['scopeId'] && $existing['owner_id']===$actor && $receipt
                && hash_equals($receipt['payload_hash'],genesisE2eeCommandHash($command))) {
                $result=json_decode($receipt['result'],true,512,JSON_THROW_ON_ERROR);$db->commit();return$result;
            }
            throw new DomainException('E2EE_SCOPE_ALREADY_INITIALIZED');
        }
        if ($p['kind'] === 'personal') {
            $user = genesisE2eeRow($db, 'SELECT data_generation FROM users WHERE id=?', [$actor]);
            if ($p['generation'] <= (int)$user['data_generation']) throw new DomainException('E2EE_STALE_GENERATION');
        }
        $hash = genesisE2eeCommandHash($command); $now = genesisNow();
        $db->prepare('INSERT INTO e2ee_scopes(scope_id,owner_id,kind,resource_id,state,directory_revision,crypto_epoch,security_epoch,key_id,generation,
            recovery_signing_key,recovery_receiving_key,recovery_kit,recovery_capsule,checkpoint_hash,created_at,updated_at)
            VALUES(?,?,?,?,\'preparing\',1,1,1,?,?,?,?,?,?,?,?,?)')->execute([$command['scopeId'],$actor,$p['kind'],$p['resourceId'],$p['keyId'],$p['generation'],
                $kit['authority']['signingKey'],$kit['authority']['receivingKey'],genesisE2eeJson($kit),genesisE2eeJson($p['recoveryCapsule']),$hash,$now,$now]);
        $db->prepare("INSERT INTO e2ee_devices(scope_id,device_id,user_id,role,signing_key,receiving_key,root_capsule,enrolled_at) VALUES(?,?,?,'owner',?,?,?,?)")
            ->execute([$command['scopeId'],$command['deviceId'],$actor,$keys['signingKey'],$keys['receivingKey'],genesisE2eeJson($p['deviceCapsule']),$now]);
        $db->prepare('INSERT INTO e2ee_events VALUES(?,1,?,?,?)')->execute([$command['scopeId'],'genesis',$hash,genesisE2eeJson($packet)]);
        $result = ['directoryRevision'=>1,'checkpointHash'=>$hash,'state'=>'preparing'];
        $db->prepare('INSERT INTO e2ee_receipts VALUES(?,?,?,?)')->execute([$command['scopeId'],$command['operationId'],$hash,genesisE2eeJson($result)]);
        $db->commit(); return $result;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** A challenge never approves a key. A live trusted/recovery key must sign its exact contents. */
function genesisE2eeCreateChallenge(string $actor, string $scopeId, string $sessionBinding, array $input): array
{
    genesisE2eeScope($actor, $scopeId);
    genesisE2eeExactFields($input, ['deviceId','keys']); genesisE2eeIdentifier($input['deviceId']);
    if ($input['deviceId'] === 'recovery') genesisE2eeInvalid();
    $keys = genesisE2eePublicKeys($input['keys']);
    if (strlen($sessionBinding) < 16 || strlen($sessionBinding) > 256) genesisE2eeInvalid();
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $db->prepare('DELETE FROM e2ee_challenges WHERE expires_at<?')->execute([time()]);
        $count = genesisE2eeRow($db, 'SELECT COUNT(*) AS amount FROM e2ee_challenges WHERE scope_id=? AND user_id=? AND consumed=0', [$scopeId,$actor]);
        if ((int)$count['amount'] >= 10) throw new GenesisResourceLimitException(429, 'E2EE_CHALLENGE_LIMIT');
        $scope=genesisE2eeScope($actor,$scopeId);
        $row = ['id'=>bin2hex(random_bytes(16)),'scopeId'=>$scopeId,'userId'=>$actor,'role'=>genesisE2eeDeviceRole($actor,$scope),'sessionHash'=>hash('sha256',$sessionBinding),
            'deviceId'=>$input['deviceId'],'signingKey'=>$keys['signingKey'],'receivingKey'=>$keys['receivingKey'],
            'nonce'=>bin2hex(random_bytes(32)),'expiresAt'=>time()+300];
        $db->prepare('INSERT INTO e2ee_challenges(id,scope_id,user_id,role,session_hash,device_id,signing_key,receiving_key,nonce,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
            ->execute(array_values($row));
        $db->commit(); return $row;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
function genesisE2eeChallengePublic(array $row): array
{
    return ['id'=>$row['id'],'scopeId'=>$row['scope_id'],'userId'=>$row['user_id'],'role'=>$row['role'],'sessionHash'=>$row['session_hash'],
        'deviceId'=>$row['device_id'],'signingKey'=>$row['signing_key'],'receivingKey'=>$row['receiving_key'],
        'nonce'=>$row['nonce'],'expiresAt'=>(int)$row['expires_at']];
}
function genesisE2eeCheckpointEvent(PDO $db, array &$scope, array $packet): void
{
    $next = (int)$scope['directory_revision'] + 1;
    $hash = rtrim(strtr(base64_encode(hash('sha256', $scope['checkpoint_hash'] . "\0" . genesisE2eeCommandHash($packet['command']), true)), '+/', '-_'), '=');
    $db->prepare('INSERT INTO e2ee_events VALUES(?,?,?,?,?)')->execute([$scope['scope_id'],$next,$scope['checkpoint_hash'],$hash,genesisE2eeJson($packet)]);
    $db->prepare('UPDATE e2ee_scopes SET directory_revision=?,checkpoint_hash=?,updated_at=? WHERE scope_id=?')
        ->execute([$next,$hash,genesisNow(),$scope['scope_id']]);
    $scope['directory_revision']=$next; $scope['checkpoint_hash']=$hash;
}

/** All verification, ACL, epoch, replay and compare-and-swap checks share one SQLite write lock. */
function genesisE2eeExecute(string $actor, mixed $source, string $sessionBinding): array
{
    $packet=genesisE2eeExactFields($source,['command','signature']);$command=genesisE2eeCommand($packet['command']);
    if(str_starts_with($command['action'],'migration-'))return genesisE2eeWithPersonalIo($actor,true,static fn():array=>genesisE2eeExecuteLocked($actor,$source,$sessionBinding));
    return genesisE2eeExecuteLocked($actor,$source,$sessionBinding);
}
function genesisE2eeExecuteLocked(string $actor,mixed $source,string $sessionBinding): array
{
    $packet = genesisE2eeExactFields($source, ['command','signature']); $c = genesisE2eeCommand($packet['command']);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $scope = genesisE2eeScope($actor, $c['scopeId']);
        if ($c['ownerId'] !== $scope['owner_id']) throw new DomainException('E2EE_CONTEXT_MISMATCH');
        $recovery = $c['deviceId'] === 'recovery';
        $device = $recovery ? false : genesisE2eeRow($db, 'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?', [$c['scopeId'],$c['deviceId']]);
        if (!$recovery && (!$device || $device['revoked'] || ($device['user_id'] !== $actor && $c['action'] !== 'enroll'))) throw new DomainException('E2EE_REVOKED_DEVICE');
        if ($recovery && $actor !== $scope['owner_id'] && $c['action']!=='enroll') throw new GenesisResourceLimitException(403,'E2EE_SCOPE_FORBIDDEN');
        if(!in_array($c['action'],['put','cancel-put'],true))genesisE2eeRequireDirectoryAuthority($scope,$device,$recovery);
        genesisE2eeVerifyCommand($packet, $recovery ? $scope['recovery_signing_key'] : $device['signing_key']);
        $fingerprint = genesisE2eeCommandHash($c);
        $receipt = genesisE2eeRow($db, 'SELECT * FROM e2ee_receipts WHERE scope_id=? AND operation_id=?', [$c['scopeId'],$c['operationId']]);
        if ($receipt) {
            if (!hash_equals($receipt['payload_hash'],$fingerprint)) throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
            $result=json_decode($receipt['result'],true,512,JSON_THROW_ON_ERROR); $db->commit(); return $result;
        }
        if ($c['securityEpoch'] !== (int)$scope['security_epoch']) throw new DomainException('E2EE_STALE_EPOCH');
        if ($c['expectedRevision'] !== (int)$scope['directory_revision']) throw new DomainException('E2EE_DIRECTORY_CONFLICT');
        if (!hash_equals($scope['checkpoint_hash'],$c['checkpointHash'])) throw new DomainException('E2EE_CHECKPOINT_MISMATCH');
        $p = $c['payload'];
        if ($c['action'] === 'enroll') {
            // The submitter is the candidate session; approval may be signed by a different trusted device.
            // Only the independently pinned owner's device/recovery may approve it.
            genesisE2eeExactFields($p, ['challenge','capsule','historyCapsules','selfProof']); genesisE2eeCapsule($p['capsule']);
            $epochs=genesisE2eeEpochKeys($db,$c['scopeId']);
            if(!is_array($p['historyCapsules'])||!array_is_list($p['historyCapsules'])||count($p['historyCapsules'])!==count($epochs)-1)throw new DomainException('E2EE_HISTORY_INCOMPLETE');
            $history=[];
            foreach($p['historyCapsules'] as $grant) {
                genesisE2eeExactFields($grant,['cryptoEpoch','keyId','capsule']);$epoch=genesisE2eeInteger($grant['cryptoEpoch'],1);genesisE2eeCapsule($grant['capsule']);
                if($epoch>=(int)$scope['crypto_epoch']||isset($history[$epoch])||($epochs[$epoch]??null)!==$grant['keyId'])throw new DomainException('E2EE_HISTORY_INCOMPLETE');
                $history[$epoch]=true;
            }
            $challenge = genesisE2eeExactFields($p['challenge'], ['id','scopeId','userId','role','sessionHash','deviceId','signingKey','receivingKey','nonce','expiresAt']);
            $stored = genesisE2eeRow($db, 'SELECT * FROM e2ee_challenges WHERE id=? AND scope_id=?', [$challenge['id'],$c['scopeId']]);
            if (!$stored || $stored['consumed'] || (int)$stored['expires_at'] < time()
                || $stored['user_id'] !== $actor || $stored['role']!==genesisE2eeDeviceRole($actor,$scope) || !hash_equals($stored['session_hash'], hash('sha256',$sessionBinding))
                || genesisE2eeCanonical(genesisE2eeChallengePublic($stored)) !== genesisE2eeCanonical($challenge)) throw new DomainException('E2EE_CHALLENGE_INVALID');
            if(openssl_verify("GENESIS-E2EE-ENROLLMENT\0v1\0".genesisE2eeCanonical($challenge),genesisE2eeSignatureDer(genesisE2eeDecode($p['selfProof'],64)),
                genesisE2eePublicPem($stored['signing_key']),OPENSSL_ALGO_SHA256)!==1)throw new DomainException('E2EE_UNTRUSTED_DEVICE');
            if (genesisE2eeRow($db,'SELECT 1 FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$c['scopeId'],$stored['device_id']])) throw new DomainException('E2EE_DEVICE_ALREADY_KNOWN');
            $db->prepare('INSERT INTO e2ee_devices(scope_id,device_id,user_id,role,signing_key,receiving_key,root_capsule,enrolled_at) VALUES(?,?,?,?,?,?,?,?)')
                ->execute([$c['scopeId'],$stored['device_id'],$actor,$stored['role'],$stored['signing_key'],$stored['receiving_key'],genesisE2eeJson($p['capsule']),genesisNow()]);
            $db->prepare('UPDATE e2ee_challenges SET consumed=1 WHERE id=?')->execute([$stored['id']]);
            genesisE2eeCheckpointEvent($db,$scope,$packet);
            $result=['directoryRevision'=>$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash']];
        } elseif ($c['action'] === 'rotate') {
            genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'manage');
            if (!in_array($scope['state'],['active','retirement'],true)) throw new DomainException('E2EE_NOT_ACTIVE');
            genesisE2eeExactFields($p,['revokedDeviceIds','cryptoEpoch','securityEpoch','keyId','capsules','recoveryCapsule','retiredManifestHash','retiredObjectCount']);
            $retired=genesisE2eeManifest($db,$scope);genesisE2eeDecode($p['retiredManifestHash'],32);genesisE2eeInteger($p['retiredObjectCount']);
            if($retired['manifestHash']!==$p['retiredManifestHash']||$retired['objectCount']!==$p['retiredObjectCount'])throw new DomainException('E2EE_MANIFEST_MISMATCH');
            $heads=genesisE2eeObjectHeads($db,$scope);
            $db->prepare('INSERT INTO e2ee_retired_manifests VALUES(?,?,?,?,?)')->execute([$scope['scope_id'],$scope['crypto_epoch'],$scope['generation'],$retired['manifestHash'],genesisE2eeJson($heads)]);
            if (!is_array($p['revokedDeviceIds']) || !array_is_list($p['revokedDeviceIds']) || count($p['revokedDeviceIds'])>256
                || !is_array($p['capsules']) || !array_is_list($p['capsules']) || count($p['capsules'])>256
                || $p['cryptoEpoch']!==(int)$scope['crypto_epoch']+1 || $p['securityEpoch']!==(int)$scope['security_epoch']+1
                || in_array(genesisE2eeIdentifier($p['keyId']),genesisE2eeEpochKeys($db,$c['scopeId']),true)) genesisE2eeInvalid();
            genesisE2eeCapsule($p['recoveryCapsule']);
            $revoked=[];
            foreach($p['revokedDeviceIds'] as $id) { genesisE2eeIdentifier($id);if(isset($revoked[$id]))genesisE2eeInvalid();$revoked[$id]=true; }
            $q=$db->prepare('SELECT * FROM e2ee_devices WHERE scope_id=? AND revoked=0 ORDER BY device_id');$q->execute([$c['scopeId']]);$current=$q->fetchAll();$q->closeCursor();
            $known=array_column($current,null,'device_id');foreach($revoked as $id=>$_)if(!isset($known[$id]))genesisE2eeInvalid();
            $capsules=[];
            foreach($p['capsules'] as $entry) {
                genesisE2eeExactFields($entry,['deviceId','capsule']);$id=genesisE2eeIdentifier($entry['deviceId']);genesisE2eeCapsule($entry['capsule']);
                if(isset($capsules[$id]) || !isset($known[$id]) || isset($revoked[$id]) || genesisE2eeJson($entry['capsule'])===$known[$id]['root_capsule'])genesisE2eeInvalid();
                $capsules[$id]=$entry['capsule'];
            }
            if(count($capsules)!==count($known)-count($revoked) || $capsules===[])throw new DomainException('E2EE_ROTATION_INCOMPLETE');
            foreach($current as $entry) {
                $id=$entry['device_id'];
                if(isset($revoked[$id])) {
                    $db->prepare('UPDATE e2ee_devices SET revoked=1 WHERE scope_id=? AND device_id=?')->execute([$c['scopeId'],$id]);
                    // Invalidate every account session for this device's owner; surviving devices
                    // reauthenticate but retain their independently wrapped new root.
                    $db->prepare('UPDATE users SET security_epoch=security_epoch+1 WHERE id=?')->execute([$entry['user_id']]);
                } else $db->prepare('UPDATE e2ee_devices SET root_capsule=? WHERE scope_id=? AND device_id=?')->execute([genesisE2eeJson($capsules[$id]),$c['scopeId'],$id]);
            }
            $db->prepare('UPDATE e2ee_scopes SET crypto_epoch=?,security_epoch=?,key_id=?,recovery_capsule=?,seal_count=0 WHERE scope_id=?')
                ->execute([$p['cryptoEpoch'],$p['securityEpoch'],$p['keyId'],genesisE2eeJson($p['recoveryCapsule']),$c['scopeId']]);
            genesisE2eeCheckpointEvent($db,$scope,$packet);
            $result=['directoryRevision'=>$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash'],
                'cryptoEpoch'=>$p['cryptoEpoch'],'securityEpoch'=>$p['securityEpoch'],'signInRequired'=>$revoked!==[]];
        } elseif ($c['action'] === 'cancel-put') {
            if($recovery)throw new DomainException('E2EE_DEVICE_REQUIRED');
            genesisE2eeExactFields($p,['original']);$original=genesisE2eeExactFields($p['original'],['command','signature']);
            $old=genesisE2eeCommand($original['command']);
            if($old['action']!=='put'||$old['ownerId']!==$scope['owner_id']||$old['scopeId']!==$scope['scope_id']
              ||$old['deviceId']!==$c['deviceId']||$old['operationId']===$c['operationId'])throw new DomainException('E2EE_CONTEXT_MISMATCH');
            genesisE2eeVerifyCommand($original,$device['signing_key']);$oldHash=genesisE2eeCommandHash($old);
            $oldReceipt=genesisE2eeRow($db,'SELECT * FROM e2ee_receipts WHERE scope_id=? AND operation_id=?',[$c['scopeId'],$old['operationId']]);
            if($oldReceipt) {
                if(!hash_equals($oldHash,$oldReceipt['payload_hash']))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
                $oldResult=json_decode($oldReceipt['result'],true,512,JSON_THROW_ON_ERROR);
            } else {
                // An operation tombstone shares this writer lock with puts. A delayed
                // original request can never race a newly prepared replacement.
                $oldResult=['cancelled'=>true];$db->prepare('INSERT INTO e2ee_receipts VALUES(?,?,?,?)')->execute([$c['scopeId'],$old['operationId'],$oldHash,genesisE2eeJson($oldResult)]);
            }
            $result=['operationReceipt'=>['payloadHash'=>$oldHash,'result'=>$oldResult]];
        } elseif ($c['action'] === 'put') {
            if ($recovery) throw new DomainException('E2EE_DEVICE_REQUIRED');
            genesisE2eeExactFields($p,['envelope','expectedObjectRevision','migrationId','fence']);
            $expected=genesisE2eeInteger($p['expectedObjectRevision']); $envelope=genesisE2eeValidateEnvelope($p['envelope']); $ctx=$envelope['context'];
            $comment=$ctx['domain']==='shared-comment';
            if($comment && $expected!==0)throw new GenesisResourceLimitException(403,'E2EE_COMMENT_IMMUTABLE');
            genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],$comment?'comment':'write');
            if(!in_array($device['role'],$comment?['owner','writer','commenter']:['owner','writer'],true))throw new GenesisResourceLimitException(403,'E2EE_WRITE_FORBIDDEN');
            if(!in_array($ctx['domain'],genesisE2eeAllowedContentDomains($scope['kind']),true))
                throw new DomainException('E2EE_CONTEXT_MISMATCH');
            if ($ctx['ownerId']!==$scope['owner_id'] || $ctx['scopeId']!==$scope['scope_id'] || $ctx['deviceId']!==$c['deviceId']
                || $ctx['operationId']!==$c['operationId'] || $ctx['cryptoEpoch']!==(int)$scope['crypto_epoch'] || $ctx['securityEpoch']!==(int)$scope['security_epoch']
                || $ctx['keyId']!==$scope['key_id'] || $ctx['dataGeneration']!==(int)$scope['generation'] || $ctx['revision']!==$expected+1)
                throw new DomainException('E2EE_CONTEXT_MISMATCH');
            genesisE2eeVerifyEnvelope($envelope,$ctx,genesisE2eePublicPem($device['signing_key']));
            if (!in_array($scope['state'],['active','retirement'],true)) {
                $lease=genesisE2eeRequireLease($db,$scope,$c['deviceId']);
                if($p['migrationId']!==$lease['migration_id'] || genesisE2eeInteger($p['fence'],1)!==(int)$lease['fence'])throw new DomainException('E2EE_MIGRATION_FENCED');
            } elseif($p['migrationId']!==null || $p['fence']!==0)genesisE2eeInvalid();
            if ($scope['state']==='verified') throw new DomainException('E2EE_MIGRATION_SEALED');
            $stored=genesisE2eeRow($db,'SELECT revision FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain=? AND object_id=?',[$c['scopeId'],$scope['generation'],$ctx['domain'],$ctx['objectId']]);
            if (($stored?(int)$stored['revision']:0)!==$expected) throw new DomainException('E2EE_OBJECT_CONFLICT');
            if(!$stored && (int)genesisE2eeRow($db,'SELECT COUNT(*) AS amount FROM e2ee_objects WHERE scope_id=? AND generation=?',[$c['scopeId'],$scope['generation']])['amount']>=10000)
                throw new GenesisResourceLimitException(413,'E2EE_SCOPE_OBJECT_LIMIT');
            if ((int)$scope['seal_count']>=4294967296) throw new DomainException('E2EE_ROTATION_REQUIRED');
            $hash=rtrim(strtr(base64_encode(hash('sha256',genesisE2eeSignatureData($envelope),true)),'+/','-_'),'=');
            $db->prepare('INSERT INTO e2ee_objects VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope_id,generation,domain,object_id) DO UPDATE SET revision=excluded.revision,envelope=excluded.envelope,payload_hash=excluded.payload_hash')
                ->execute([$c['scopeId'],$scope['generation'],$ctx['domain'],$ctx['objectId'],$ctx['revision'],genesisE2eeJson($envelope),$hash]);
            $db->prepare('UPDATE e2ee_scopes SET seal_count=seal_count+1 WHERE scope_id=?')->execute([$c['scopeId']]);
            $result=['revision'=>$ctx['revision'],'payloadHash'=>$hash,'generation'=>(int)$scope['generation']];
        } elseif (in_array($c['action'],['migration-start','migration-resume','migration-verify','migration-commit','migration-cancel'],true)) {
            if ($recovery) throw new DomainException('E2EE_DEVICE_REQUIRED');
            genesisE2eeAccess($actor,$scope['kind'],$scope['resource_id'],'manage');
            $result=genesisE2eeMigrationCommand($db,$scope,$c,$packet);
        } else throw new InvalidArgumentException('E2EE_UNKNOWN_ACTION');
        $db->prepare('INSERT INTO e2ee_receipts VALUES(?,?,?,?)')->execute([$c['scopeId'],$c['operationId'],$fingerprint,genesisE2eeJson($result)]);
        $db->commit(); return $result;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisE2eeRequireLease(PDO $db,array $scope,string $device): array
{
    $lease=genesisE2eeRow($db,'SELECT * FROM e2ee_migrations WHERE scope_id=?',[$scope['scope_id']]);
    if (!$lease || (int)$lease['lease_until']<time() || $lease['device_id']!==$device
        ||(int)$lease['target_generation']!==(int)$scope['generation']) throw new DomainException('E2EE_MIGRATION_FENCED');
    if($scope['kind']==='personal') {
        $legacy=genesisE2eeRow($db,'SELECT data_generation FROM users WHERE id=?',[$scope['resource_id']]);
        if(!$legacy||(int)$scope['generation']<=(int)$legacy['data_generation'])throw new DomainException('E2EE_STALE_GENERATION');
    }
    return $lease;
}
function genesisE2eeManifest(PDO $db,array $scope): array
{
    $objects=genesisE2eeObjectHeads($db,$scope);
    return ['objectCount'=>count($objects),'manifestHash'=>rtrim(strtr(base64_encode(hash('sha256',genesisE2eeCanonical($objects),true)),'+/','-_'),'=')];
}
function genesisE2eeObjectHeads(PDO $db,array $scope): array
{
    $q=$db->prepare('SELECT domain,object_id AS objectId,revision,payload_hash AS payloadHash FROM e2ee_objects WHERE scope_id=? AND generation=? ORDER BY domain,object_id');
    $q->execute([$scope['scope_id'],$scope['generation']]); $objects=$q->fetchAll(); $q->closeCursor();
    if(count($objects)>10000)throw new GenesisResourceLimitException(413,'E2EE_SCOPE_OBJECT_LIMIT');return $objects;
}
function genesisE2eeMigrationCommand(PDO $db,array &$scope,array $c,array $packet): array
{
    $p=$c['payload'];
    if (in_array($scope['state'],['active','retirement'],true)) throw new DomainException('E2EE_ALREADY_ACTIVE');
    if($c['action']==='migration-resume') {
        genesisE2eeExactFields($p,['migrationId','fence','sourceHash','pendingOperationId','pendingHash']);
        genesisE2eeIdentifier($p['migrationId']);genesisE2eeInteger($p['fence'],1);genesisE2eeDecode($p['sourceHash'],32);
        $lease=genesisE2eeRow($db,'SELECT * FROM e2ee_migrations WHERE scope_id=?',[$scope['scope_id']]);
        if(!$lease || $lease['migration_id']!==$p['migrationId'] || $lease['device_id']!==$c['deviceId']
          || (int)$lease['fence']!==$p['fence'])throw new DomainException('E2EE_MIGRATION_FENCED');
        if(!hash_equals($lease['source_hash'],$p['sourceHash']) || !hash_equals($lease['source_hash'],genesisE2eeSourceHash($db,$scope)))
            throw new DomainException('E2EE_SOURCE_CHANGED');
        $receipt=null;
        if($p['pendingOperationId']!==null) {
            genesisE2eeIdentifier($p['pendingOperationId']);genesisE2eeDecode($p['pendingHash'],32);
            $row=genesisE2eeRow($db,'SELECT * FROM e2ee_receipts WHERE scope_id=? AND operation_id=?',[$scope['scope_id'],$p['pendingOperationId']]);
            if($row) {
                if(!hash_equals($row['payload_hash'],$p['pendingHash']))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
                $receipt=['payloadHash'=>$row['payload_hash'],'result'=>json_decode($row['result'],true,512,JSON_THROW_ON_ERROR)];
            }
        } elseif($p['pendingHash']!==null)genesisE2eeInvalid();
        $fence=(int)$lease['fence']+1;$until=time()+900;genesisE2eeInteger($fence,1);
        // This write lock proves whether the pending operation committed before
        // invalidating old packets. Never guess after an ambiguous timeout.
        $db->prepare('UPDATE e2ee_migrations SET fence=?,lease_until=? WHERE scope_id=?')->execute([$fence,$until,$scope['scope_id']]);
        return ['fence'=>$fence,'leaseUntil'=>$until,'generation'=>(int)$scope['generation'],'pendingReceipt'=>$receipt];
    }
    if ($c['action']==='migration-start') {
        genesisE2eeExactFields($p,['migrationId','sourceHash']); genesisE2eeIdentifier($p['migrationId']); genesisE2eeDecode($p['sourceHash'],32);
        $previous=genesisE2eeRow($db,'SELECT * FROM e2ee_migrations WHERE scope_id=?',[$scope['scope_id']]);
        if ($previous && (int)$previous['lease_until']>=time() && ($previous['device_id']!==$c['deviceId'] || $previous['migration_id']!==$p['migrationId']))
            throw new DomainException('E2EE_MIGRATION_BUSY');
        $source=genesisE2eeSourceHash($db,$scope);
        if (!hash_equals($source,$p['sourceHash'])) throw new DomainException('E2EE_SOURCE_CHANGED');
        if($previous && $previous['migration_id']===$p['migrationId'] && !hash_equals($previous['source_hash'],$source))throw new DomainException('E2EE_SOURCE_CHANGED');
        $fence=$previous?(int)$previous['fence']+1:1; $until=time()+900;
        $target=(int)$scope['generation'];
        if($previous && $previous['migration_id']!==$p['migrationId']) {
            // Abandoned shadow objects are retained, never mixed into the next attempt.
            $target++;
        }
        if($scope['kind']==='personal') {
            $legacy=genesisE2eeRow($db,'SELECT data_generation FROM users WHERE id=?',[$scope['resource_id']]);
            if(!$legacy)throw new DomainException('E2EE_SOURCE_UNAVAILABLE');
            // A restore may occur after directory bootstrap, before the first
            // lease or between cancelled attempts. Never cut over to its older
            // generation or reuse abandoned shadow objects.
            $target=max($target,(int)$legacy['data_generation']+1);
        }
        if($target>9007199254740991)throw new DomainException('E2EE_ROTATION_REQUIRED');
        if($target!==(int)$scope['generation']) {
            $scope['generation']=$target;
            $db->prepare('UPDATE e2ee_scopes SET generation=? WHERE scope_id=?')->execute([$scope['generation'],$scope['scope_id']]);
        }
        $db->prepare('INSERT INTO e2ee_migrations VALUES(?,?,?,?,?,?,?,NULL,NULL) ON CONFLICT(scope_id) DO UPDATE SET migration_id=excluded.migration_id,device_id=excluded.device_id,source_hash=excluded.source_hash,target_generation=excluded.target_generation,fence=excluded.fence,lease_until=excluded.lease_until,manifest_hash=NULL,verified_checkpoint=NULL')
            ->execute([$scope['scope_id'],$p['migrationId'],$c['deviceId'],$source,$scope['generation'],$fence,$until]);
        $db->prepare("UPDATE e2ee_scopes SET state='uploading' WHERE scope_id=?")->execute([$scope['scope_id']]);
        return ['migrationId'=>$p['migrationId'],'fence'=>$fence,'leaseUntil'=>$until,'generation'=>(int)$scope['generation']];
    }
    $lease=$c['action']==='migration-cancel'?genesisE2eeRow($db,'SELECT * FROM e2ee_migrations WHERE scope_id=?',[$scope['scope_id']]):genesisE2eeRequireLease($db,$scope,$c['deviceId']);
    if(!$lease||$lease['device_id']!==$c['deviceId'])throw new DomainException('E2EE_MIGRATION_FENCED');
    if ($c['action']==='migration-verify') {
        genesisE2eeExactFields($p,['migrationId','fence','manifestHash','objectCount','verifiedCheckpoint']);
        genesisE2eeDecode($p['manifestHash'],32); genesisE2eeDecode($p['verifiedCheckpoint'],32); genesisE2eeInteger($p['objectCount'],1);
        $manifest=genesisE2eeManifest($db,$scope);
        if ($scope['state']!=='uploading' || $p['manifestHash']!==$manifest['manifestHash'] || $p['objectCount']!==$manifest['objectCount']) throw new DomainException('E2EE_MANIFEST_MISMATCH');
        $db->prepare('UPDATE e2ee_migrations SET manifest_hash=?,verified_checkpoint=? WHERE scope_id=?')->execute([$p['manifestHash'],$p['verifiedCheckpoint'],$scope['scope_id']]);
        $db->prepare("UPDATE e2ee_scopes SET state='verified' WHERE scope_id=?")->execute([$scope['scope_id']]);
        $result=['state'=>'verified','manifestHash'=>$p['manifestHash']];
    } elseif ($c['action']==='migration-commit') {
        genesisE2eeExactFields($p,['migrationId','fence','manifestHash','verifiedCheckpoint','generation','objectCount']);
        $heads=genesisE2eeObjectHeads($db,$scope);genesisE2eeInteger($p['objectCount']);
        if ($scope['state']!=='verified' || $p['manifestHash']!==$lease['manifest_hash'] || $p['verifiedCheckpoint']!==$lease['verified_checkpoint']
            || $p['objectCount']!==count($heads) || $p['generation']!==(int)$scope['generation'] || !hash_equals($lease['source_hash'],genesisE2eeSourceHash($db,$scope))) throw new DomainException('E2EE_MIGRATION_UNVERIFIED');
        $db->prepare('INSERT INTO e2ee_retired_manifests VALUES(?,0,?,?,?)')->execute([$scope['scope_id'],$scope['generation'],$p['manifestHash'],genesisE2eeJson($heads)]);
        $db->prepare("UPDATE e2ee_scopes SET state='active' WHERE scope_id=?")->execute([$scope['scope_id']]);
        genesisE2eeCheckpointEvent($db,$scope,$packet);
        $result=['state'=>'active','directoryRevision'=>$scope['directory_revision'],'checkpointHash'=>$scope['checkpoint_hash']];
    } else {
        genesisE2eeExactFields($p,['migrationId','fence']);
        $db->prepare("UPDATE e2ee_scopes SET state='preparing' WHERE scope_id=?")->execute([$scope['scope_id']]);
        $db->prepare('UPDATE e2ee_migrations SET lease_until=0,manifest_hash=NULL,verified_checkpoint=NULL WHERE scope_id=?')->execute([$scope['scope_id']]);
        $result=['state'=>'preparing'];
    }
    if ($p['migrationId']!==$lease['migration_id'] || genesisE2eeInteger($p['fence'],1)!==(int)$lease['fence']) throw new DomainException('E2EE_MIGRATION_FENCED');
    return $result;
}

function genesisE2eeDirectory(string $actor,string $scopeId): array
{
    $scope=genesisE2eeScope($actor,$scopeId); $db=genesisDb();
    $q=$db->prepare('SELECT device_id AS deviceId,user_id AS userId,role,signing_key AS signingKey,receiving_key AS receivingKey,revoked FROM e2ee_devices WHERE scope_id=? ORDER BY device_id');
    $q->execute([$scopeId]);$devices=$q->fetchAll();$q->closeCursor();
    $q=$db->prepare('SELECT signed_command FROM e2ee_events WHERE scope_id=? ORDER BY revision');$q->execute([$scopeId]);
    $events=array_map(static fn(array $r):array=>json_decode($r['signed_command'],true,512,JSON_THROW_ON_ERROR),$q->fetchAll());$q->closeCursor();
    return ['scopeId'=>$scopeId,'ownerId'=>$scope['owner_id'],'state'=>$scope['state'],'directoryRevision'=>(int)$scope['directory_revision'],
        'cryptoEpoch'=>(int)$scope['crypto_epoch'],'securityEpoch'=>(int)$scope['security_epoch'],'keyId'=>$scope['key_id'],'generation'=>(int)$scope['generation'],
        'checkpointHash'=>$scope['checkpoint_hash'],'recoveryKit'=>json_decode($scope['recovery_kit'],true,512,JSON_THROW_ON_ERROR),'devices'=>$devices,'events'=>$events];
}

/** Read ciphertext only through a trusted device proof; owner login alone never returns a raw key. */
function genesisE2eeRead(string $actor,array $packet,string $sessionBinding): array
{
    $command=genesisE2eeCommand($packet['command']??null);
    if(str_starts_with($command['action'],'legacy-'))return genesisE2eeWithPersonalIo($actor,true,static fn():array=>genesisE2eeReadTransaction($actor,$packet,$sessionBinding));
    return genesisE2eeReadTransaction($actor,$packet,$sessionBinding);
}
function genesisE2eeReadTransaction(string $actor,array $packet,string $sessionBinding): array
{
    // Authorization and reading share the writer lock: revocation, lease replacement
    // and cutover cannot race a legacy migration read (which can include an OLD key).
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $result=genesisE2eeReadLocked($actor,$packet,$sessionBinding);$db->commit();return$result;
    } catch(Throwable $error) {if($db->inTransaction())$db->rollBack();throw$error;}
}
function genesisE2eeReadLocked(string $actor,array $packet,string $sessionBinding): array
{
    // Read identities are signed but do not create command receipts or change data.
    $c=genesisE2eeCommand($packet['command']??null);$scope=genesisE2eeScope($actor,$c['scopeId']);
    if (!in_array($c['action'],['read','get','receipt','sealed-heads','legacy-workspace','legacy-aurora','legacy-stoicheion','legacy-advice','legacy-tasks','legacy-diary'],true) || $c['ownerId']!==$scope['owner_id'] || $c['securityEpoch']!==(int)$scope['security_epoch']
        || $c['expectedRevision']!==(int)$scope['directory_revision'] || !hash_equals($scope['checkpoint_hash'],$c['checkpointHash'])) throw new DomainException('E2EE_STALE_EPOCH');
    $device=genesisE2eeRow(genesisDb(),'SELECT * FROM e2ee_devices WHERE scope_id=? AND device_id=?',[$c['scopeId'],$c['deviceId']]);
    if (!$device || $device['revoked'] || $device['user_id']!==$actor) throw new DomainException('E2EE_REVOKED_DEVICE');
    genesisE2eeVerifyCommand($packet,$device['signing_key']);
    if($c['action']==='legacy-workspace') {
        require_once __DIR__.'/e2ee-legacy-workspace.php';
        return genesisE2eeLegacyWorkspace(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='legacy-aurora') {
        require_once __DIR__.'/e2ee-legacy-aurora.php';
        return genesisE2eeLegacyAurora(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='legacy-stoicheion') {
        require_once __DIR__.'/e2ee-legacy-stoicheion.php';
        return genesisE2eeLegacyStoicheion(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='legacy-advice') {
        require_once __DIR__.'/e2ee-legacy-advice.php';
        return genesisE2eeLegacyAdvice(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='legacy-tasks') {
        require_once __DIR__.'/e2ee-legacy-tasks.php';
        return genesisE2eeLegacyTasks(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='legacy-diary') {
        require_once __DIR__.'/e2ee-legacy-diary.php';
        return genesisE2eeLegacyDiary(genesisDb(),$actor,$scope,$c);
    }
    if($c['action']==='sealed-heads') {
        genesisE2eeExactFields($c['payload'],['cryptoEpoch']);genesisE2eeInteger($c['payload']['cryptoEpoch']);
        $row=genesisE2eeRow(genesisDb(),'SELECT * FROM e2ee_retired_manifests WHERE scope_id=? AND crypto_epoch=?',[$c['scopeId'],$c['payload']['cryptoEpoch']]);
        if(!$row)throw new GenesisResourceLimitException(404,'E2EE_MANIFEST_NOT_FOUND');
        return ['objects'=>json_decode($row['objects_json'],true,512,JSON_THROW_ON_ERROR),'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
    }
    if($c['action']==='receipt') {
        genesisE2eeExactFields($c['payload'],['operationId','payloadHash']);genesisE2eeIdentifier($c['payload']['operationId']);genesisE2eeDecode($c['payload']['payloadHash'],32);
        $receipt=genesisE2eeRow(genesisDb(),'SELECT * FROM e2ee_receipts WHERE scope_id=? AND operation_id=?',[$c['scopeId'],$c['payload']['operationId']]);
        if($receipt&&!hash_equals($receipt['payload_hash'],$c['payload']['payloadHash']))throw new DomainException('E2EE_IDEMPOTENCY_CONFLICT');
        return ['receipt'=>$receipt?['payloadHash'=>$receipt['payload_hash'],'result'=>json_decode($receipt['result'],true,512,JSON_THROW_ON_ERROR)]:null,
            'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
    }
    genesisE2eeExactFields($c['payload'],$c['action']==='get'?['domain','objectId']:['domain','after','limit']);
    if (!in_array($c['payload']['domain'],GENESIS_E2EE_DOMAINS,true)) genesisE2eeInvalid();
    $single=$c['action']==='get';$after=$single?genesisE2eeIdentifier($c['payload']['objectId']):$c['payload']['after']; if ($after!=='') genesisE2eeIdentifier($after);
    $limit=$single?1:genesisE2eeInteger($c['payload']['limit'],1); if ($limit>50) genesisE2eeInvalid();
    $q=genesisDb()->prepare('SELECT envelope FROM e2ee_objects WHERE scope_id=? AND generation=? AND domain=? AND object_id'.($single?'=':'>').'? ORDER BY object_id LIMIT ?');
    $q->bindValue(1,$c['scopeId']);$q->bindValue(2,(int)$scope['generation'],PDO::PARAM_INT);$q->bindValue(3,$c['payload']['domain']);$q->bindValue(4,$after);$q->bindValue(5,$limit,PDO::PARAM_INT);$q->execute();
    $envelopes=[];$bytes=0;
    while($row=$q->fetch()) { $bytes+=strlen($row['envelope']); if($bytes>12*1024*1024 && $envelopes!==[])break; $envelopes[]=json_decode($row['envelope'],true,512,JSON_THROW_ON_ERROR); }
    $q->closeCursor();
    return ['envelopes'=>$envelopes,'deviceCapsule'=>json_decode($device['root_capsule'],true,512,JSON_THROW_ON_ERROR),
        'checkpointHash'=>$scope['checkpoint_hash'],'directoryRevision'=>(int)$scope['directory_revision']];
}
