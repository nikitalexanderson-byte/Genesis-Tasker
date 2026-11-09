<?php
declare(strict_types=1);

const GENESIS_BACKUP_NOTICE = 'backup-3.2.2-v1';

function genesisBackupEnabled(): bool { return (genesisConfig()['backup_v1_enabled'] ?? false) === true; }

/** This product gate is stricter than a cached plan, JWT, archive or rollout switch. */
function genesisBackupRequirePaid(string $userId): array
{
    $user = genesisFindUser($userId);
    if (!$user) throw new GenesisResourceLimitException(401, 'AUTH_REQUIRED');
    $access = genesisFeatureAccessForUser($user);
    if (!in_array($access['effectivePlan'], ['standard','standart','premium','business','premium4life'], true)
        || !in_array('data-export', $access['allowedFeatures'], true))
        throw new GenesisResourceLimitException(403, 'FEATURE_SUBSCRIPTION_REQUIRED');
    return $user;
}

function genesisBackupStatus(string $userId): array
{
    $user = genesisFindUser($userId);
    return ['enabled'=>genesisBackupEnabled(), 'noticeVersion'=>GENESIS_BACKUP_NOTICE,
        'generation'=>(int)$user['data_generation'], 'offlineExport'=>false, 'driveEnabled'=>false,
        'serverSigningConfigured'=>!empty(genesisConfig()['backup_signing_active_kid'])];
}

function genesisBackupAuthorize(string $userId, array $input): array
{
    if (!genesisBackupEnabled()) throw new GenesisResourceLimitException(503, 'BACKUP_DISABLED');
    if (array_keys($input)!==['noticeVersion'] || $input['noticeVersion']!==GENESIS_BACKUP_NOTICE)
        throw new GenesisResourceLimitException(409, 'BACKUP_NOTICE_REQUIRED');
    $user=genesisBackupRequirePaid($userId);
    genesisDb()->prepare('INSERT OR IGNORE INTO backup_notices VALUES(?,?,?)')->execute([$userId,GENESIS_BACKUP_NOTICE,genesisNow()]);
    return ['ownerId'=>$userId, 'generation'=>(int)$user['data_generation'], 'authorizedAt'=>genesisNow(), 'offlineExport'=>false];
}

/** Only owner-scoped encrypted personal data. No identity, billing, session, key or token table. */
function genesisBackupPersonalRows(string $owner): array
{
    $tables=['workspace_blobs','personal_mindmaps','personal_mindmap_versions','personal_mindmap_deletions',
        'personal_diary_notes','personal_diary_deletions','personal_diary_settings','personal_diary_dreams','dream_journal_preferences',
        'stoicheion_workspaces','aurora_workspaces','personal_recovered_tasks','personal_recovered_task_deletions'];
    $result=[]; $bytes=0; $count=0;
    foreach ($tables as $table) {
        $q=genesisDb()->prepare("SELECT * FROM $table WHERE user_id=?"); $q->execute([$owner]); $rows=[];
        while($row=$q->fetch(PDO::FETCH_ASSOC)) {
            $bytes+=strlen(json_encode($row,JSON_THROW_ON_ERROR));
            if(++$count>50000 || $bytes>16*1024*1024) throw new GenesisResourceLimitException(413,'BACKUP_TOO_LARGE');
            unset($row['user_id']);$rows[]=$row;
        }
        $result[$table]=$rows;
    }
    // Physis uses its own E2EE key. Preserve wire data; never export account/private key wrappers.
    $q=genesisDb()->prepare('SELECT id,revision,sequence,updated_at,deleted_at,envelope_json FROM physis_records WHERE owner_id=?');$q->execute([$owner]);
    $result['physis_records']=[];
    while($row=$q->fetch(PDO::FETCH_ASSOC)){
        $bytes+=strlen(json_encode($row,JSON_THROW_ON_ERROR));
        if($bytes>16*1024*1024||++$count>50000)throw new GenesisResourceLimitException(413,'BACKUP_TOO_LARGE');
        $result['physis_records'][]=$row;
    }
    return $result;
}

function genesisBackupRevisionHash(string $owner): string
{
    return hash('sha256',json_encode(genesisBackupPersonalRows($owner),JSON_THROW_ON_ERROR));
}

function genesisBackupServerSnapshot(string $owner,array $input): array
{
    genesisBackupAuthorize($owner,$input);
    $kid=genesisConfig()['backup_signing_active_kid']??'';
    $encoded=genesisConfig()['backup_signing_secret_keys'][$kid]??'';
    $key=is_string($encoded)?base64_decode($encoded,true):false;
    if(!is_string($kid)||!preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/D',$kid)||!is_string($key)||strlen($key)!==SODIUM_CRYPTO_SIGN_SECRETKEYBYTES)
        throw new GenesisResourceLimitException(503,'BACKUP_SIGNING_NOT_CONFIGURED');
    $db=genesisDb();$db->beginTransaction();
    try {
        $payload=['schema'=>1,'kind'=>'server_snapshot','backupId'=>genesisUuid(),'ownerId'=>$owner,'createdAt'=>genesisNow(),
            'generation'=>(int)genesisFindUser($owner)['data_generation'],'tables'=>genesisBackupPersonalRows($owner),
            'completeness'=>['google'=>'not-fetched','shared'=>'separate-permissioned-export','attachments'=>'only-embedded-content','billingEvidence'=>'absent']];
        $serialized=json_encode($payload,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
        $digest=hash('sha256',$serialized);$signed='genesis-server-snapshot-v1:'.$payload['backupId'].':'.$owner.':'.$digest;
        $db->commit();
    } catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    genesisBackupRequirePaid($owner); // Recheck immediately before delivery.
    return ['payload'=>$serialized,'digest'=>$digest,'kid'=>$kid,'signature'=>base64_encode(sodium_crypto_sign_detached($signed,$key))];
}

function genesisBackupVerifyServerSnapshot(string $owner,array $evidence): void
{
    if(array_keys($evidence)!==['payload','digest','kid','signature'] || !is_string($evidence['payload']) || strlen($evidence['payload'])>16*1024*1024
        || !is_string($evidence['kid']) || !is_string($evidence['signature']) || !is_string($evidence['digest']))throw new InvalidArgumentException('BACKUP_EVIDENCE_INVALID');
    $key=base64_decode(genesisConfig()['backup_signing_public_keys'][$evidence['kid']]??'',true);
    $signature=base64_decode($evidence['signature'],true);
    $payload=json_decode($evidence['payload'],true,48,JSON_THROW_ON_ERROR);
    if(!is_string($key)||strlen($key)!==SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES||!is_string($signature)||strlen($signature)!==SODIUM_CRYPTO_SIGN_BYTES
        ||($payload['schema']??null)!==1||($payload['kind']??'')!=='server_snapshot'||!is_string($payload['ownerId']??null)
        ||!hash_equals($owner,$payload['ownerId'])||!hash_equals(hash('sha256',$evidence['payload']),$evidence['digest'])
        ||!sodium_crypto_sign_verify_detached($signature,'genesis-server-snapshot-v1:'.($payload['backupId']??'').':'.$owner.':'.$evidence['digest'],$key))
        throw new GenesisResourceLimitException(403,'BACKUP_OWNER_OR_SIGNATURE');
}

/** Ordinary CRUD restrictions are used for restore too; historical deletes are never replayed. */
function genesisBackupApplyOperations(string $owner,array $operations): array
{
    $counts=[];$seen=[];
    if(count($operations)>1000)throw new GenesisResourceLimitException(413,'BACKUP_OPERATION_LIMIT');
    foreach($operations as $operation) {
        if(!is_array($operation)||array_diff(array_keys($operation),['section','id','input'])||!is_string($operation['section']??null)||!is_array($operation['input']??null))throw new InvalidArgumentException('BACKUP_OPERATION_INVALID');
        $section=$operation['section'];$id=$operation['id']??'';$key=$section.':'.$id;
        if(isset($seen[$key])||!is_string($id))throw new InvalidArgumentException('BACKUP_OPERATION_DUPLICATE');$seen[$key]=true;
        $body=$operation['input'];
        switch($section) {
            case 'workspace': genesisSaveWorkspaceEnvelope($owner,$body); break;
            case 'mindmaps': genesisSaveMindmap($owner,$id,$body); break;
            case 'diary': genesisSaveDiaryNote($owner,$id,$body); break;
            case 'stoicheion': genesisSaveStoicheionWorkspace($owner,$body); break;
            case 'aurora': genesisSaveAuroraWorkspace($owner,$body); break;
            case 'recovered-tasks': genesisSaveRecoveredTask($owner,$id,$body); break;
            default: throw new InvalidArgumentException('BACKUP_SECTION_UNSUPPORTED');
        }
        $counts[$section]=($counts[$section]??0)+1;
    }
    return $counts;
}

function genesisBackupPreview(string $owner,array $input): array
{
    genesisBackupAuthorize($owner,['noticeVersion'=>$input['noticeVersion']??null]);
    if(array_diff(array_keys($input),['noticeVersion','operations','serverEvidence'])||!is_array($input['operations']??null)||!array_is_list($input['operations'])||!$input['operations'])throw new InvalidArgumentException('BACKUP_PREVIEW_INVALID');
    if(isset($input['serverEvidence']))genesisBackupVerifyServerSnapshot($owner,$input['serverEvidence']);
    $serialized=json_encode($input['operations'],JSON_THROW_ON_ERROR);
    if(strlen($serialized)>16*1024*1024)throw new GenesisResourceLimitException(413,'BACKUP_TOO_LARGE');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $revision=genesisBackupRevisionHash($owner);$generation=(int)genesisFindUser($owner)['data_generation'];
        $counts=genesisBackupApplyOperations($owner,$input['operations']);$db->rollBack();
    } catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    $id=genesisUuid();$hash=hash('sha256',$serialized);$encrypted=genesisEncrypt($serialized);
    genesisBeginWriteTransaction($db);
    try {
        genesisBackupRequirePaid($owner);
        $db->prepare('DELETE FROM backup_stages WHERE expires_at<?')->execute([time()]);
        $q=$db->prepare('SELECT COUNT(*),COALESCE(SUM(length(payload_enc)),0) FROM backup_stages WHERE user_id=?');$q->execute([$owner]);$usage=$q->fetch(PDO::FETCH_NUM);
        if((int)$usage[0]>=3||(int)$usage[1]+strlen($encrypted)>64*1024*1024)throw new GenesisResourceLimitException(429,'BACKUP_STAGING_FULL');
        $db->prepare('INSERT INTO backup_stages VALUES(?,?,?,?,?,?,?,?)')->execute([$id,$owner,$hash,$generation,$revision,$encrypted,genesisNow(),time()+1800]);$db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
    return ['stageId'=>$id,'digest'=>$hash,'generation'=>$generation,'counts'=>$counts,'expiresIn'=>1800,'deleted'=>0,'externalWrites'=>0];
}

function genesisBackupCommit(string $owner,array $input): array
{
    genesisBackupAuthorize($owner,['noticeVersion'=>$input['noticeVersion']??null]);
    if(array_diff(array_keys($input),['noticeVersion','stageId','digest','operationId','confirmed'])||($input['confirmed']??false)!==true
        ||!is_string($input['stageId']??null)||!is_string($input['digest']??null)||!is_string($input['operationId']??null)
        ||preg_match('/\A[a-f0-9-]{36}\z/D',$input['operationId'])!==1)throw new InvalidArgumentException('BACKUP_CONFIRM_REQUIRED');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        genesisBackupRequirePaid($owner);
        $q=$db->prepare('SELECT * FROM backup_receipts WHERE user_id=? AND operation_id=?');$q->execute([$owner,$input['operationId']]);$receipt=$q->fetch();
        if($receipt){if(!hash_equals($receipt['payload_hash'],$input['digest']))throw new GenesisResourceLimitException(409,'BACKUP_OPERATION_REUSED');$db->commit();return ['generation'=>(int)$receipt['generation'],'duplicate'=>true];}
        $q=$db->prepare('SELECT * FROM backup_stages WHERE user_id=? AND id=?');$q->execute([$owner,$input['stageId']]);$stage=$q->fetch();
        if(!$stage||$stage['expires_at']<time()||!hash_equals($stage['payload_hash'],$input['digest']))throw new GenesisResourceLimitException(409,'BACKUP_STAGE_EXPIRED');
        $generation=(int)genesisFindUser($owner)['data_generation'];
        if($generation!==(int)$stage['generation']||!hash_equals($stage['revision_hash'],genesisBackupRevisionHash($owner)))throw new GenesisResourceLimitException(409,'BACKUP_PREVIEW_CHANGED');
        // Keep up to two recent rollback snapshots; expiry never removes the sole survivor.
        $q=$db->prepare('SELECT id,length(snapshot_enc) AS bytes FROM backup_safety_snapshots WHERE user_id=? ORDER BY created_at DESC,id DESC');$q->execute([$owner]);$old=$q->fetchAll();
        if(count($old)>=2)$db->prepare('DELETE FROM backup_safety_snapshots WHERE user_id=? AND id<>?')->execute([$owner,$old[0]['id']]);
        $safety=genesisEncrypt(json_encode(genesisBackupPersonalRows($owner),JSON_THROW_ON_ERROR));
        if(strlen($safety)+(int)($old[0]['bytes']??0)>64*1024*1024)throw new GenesisResourceLimitException(413,'BACKUP_SAFETY_FULL');
        $db->prepare('INSERT INTO backup_safety_snapshots VALUES(?,?,?,?,?)')->execute([genesisUuid(),$owner,$safety,genesisNow(),time()+30*86400]);
        $operations=json_decode(genesisDecrypt($stage['payload_enc']),true,48,JSON_THROW_ON_ERROR);
        $counts=genesisBackupApplyOperations($owner,$operations);
        genesisBackupRequirePaid($owner);
        $generation++;
        $db->prepare('UPDATE users SET data_generation=? WHERE id=?')->execute([$generation,$owner]);
        $db->prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?)')->execute([$owner,$input['operationId'],$input['digest'],$generation,genesisNow()]);
        $db->prepare('DELETE FROM backup_stages WHERE user_id=?')->execute([$owner]);$db->commit();
        return ['generation'=>$generation,'duplicate'=>false,'counts'=>$counts];
    } catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisRecoveredTasks(string $owner): array
{
    $q=genesisDb()->prepare('SELECT id,revision,iv,ciphertext,updated_at AS updatedAt FROM personal_recovered_tasks WHERE user_id=? ORDER BY id');$q->execute([$owner]);return $q->fetchAll();
}

function genesisSaveRecoveredTask(string $owner,string $id,array $input): array
{
    if(!preg_match('/\Arestored-[a-f0-9]{32}\z/D',$id)||array_diff(array_keys($input),['iv','ciphertext','expectedRevision'])
        ||!is_int($input['expectedRevision']??null)||$input['expectedRevision']<0||!is_string($input['iv']??null)||strlen($input['iv'])!==16||strlen((string)base64_decode($input['iv'],true))!==12
        ||!is_string($input['ciphertext']??null)||strlen($input['ciphertext'])<24||strlen($input['ciphertext'])>300000||base64_decode($input['ciphertext'],true)===false)throw new InvalidArgumentException('RECOVERED_TASK_INVALID');
    $db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT 1 FROM personal_recovered_task_deletions WHERE user_id=? AND id=?');$q->execute([$owner,$id]);
        if($q->fetchColumn())throw new GenesisResourceLimitException(409,'RECOVERED_TASK_DELETED');
        $q=$db->prepare('SELECT revision FROM personal_recovered_tasks WHERE user_id=? AND id=?');$q->execute([$owner,$id]);$old=$q->fetchColumn();
        if((int)($old?:0)!==$input['expectedRevision'])throw new GenesisResourceLimitException(409,'RECOVERED_TASK_CONFLICT');
        $q=$db->prepare('SELECT COUNT(*),COALESCE(SUM(length(ciphertext)),0) FROM personal_recovered_tasks WHERE user_id=?');$q->execute([$owner]);$usage=$q->fetch(PDO::FETCH_NUM);
        if($old===false&&((int)$usage[0]>=10000||(int)$usage[1]+strlen($input['ciphertext'])>16000000))throw new GenesisResourceLimitException(413,'RECOVERED_TASK_LIMIT');
        $next=$input['expectedRevision']+1;$now=genesisNow();
        $db->prepare('INSERT INTO personal_recovered_tasks VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET revision=excluded.revision,iv=excluded.iv,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at')->execute([$owner,$id,$next,$input['iv'],$input['ciphertext'],$now]);
        if($owns)$db->commit();return ['revision'=>$next,'updatedAt'=>$now];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisDeleteRecoveredTask(string $owner,string $id,int $revision): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('DELETE FROM personal_recovered_tasks WHERE user_id=? AND id=? AND revision=?');$q->execute([$owner,$id,$revision]);
        if($q->rowCount()!==1)throw new GenesisResourceLimitException(409,'RECOVERED_TASK_CONFLICT');
        $db->prepare('INSERT INTO personal_recovered_task_deletions VALUES(?,?,?,?)')->execute([$owner,$id,$revision+1,genesisNow()]);$db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisBackupRequireGeneration(string $owner,?string $sent): void
{
    $generation=(int)genesisFindUser($owner)['data_generation'];
    if($generation>0&&($sent===null||!ctype_digit($sent)||(int)$sent!==$generation))throw new GenesisResourceLimitException(409,'BACKUP_RECONCILIATION_REQUIRED');
}

/** Scheduled housekeeping never deletes the most recent safety copy for any owner. */
function genesisBackupMaintenance(): void
{
    $db=genesisDb();
    $db->prepare('DELETE FROM backup_stages WHERE expires_at<?')->execute([time()]);
    $db->prepare('DELETE FROM backup_safety_snapshots WHERE expires_at<? AND id NOT IN (SELECT newer.id FROM backup_safety_snapshots newer WHERE newer.id=(SELECT recent.id FROM backup_safety_snapshots recent WHERE recent.user_id=newer.user_id ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1))')->execute([time()]);
    $db->prepare("UPDATE account_recovery_requests SET state='invalidated' WHERE expires_at<? AND state IN ('pending','approved')")->execute([time()]);
    $cutoff=gmdate('Y-m-d\TH:i:s\Z',time()-365*86400);
    $db->prepare("DELETE FROM account_recovery_requests WHERE created_at<? AND state NOT IN ('pending','approved')")->execute([$cutoff]);
    $db->prepare('DELETE FROM google_security_events WHERE created_at<?')->execute([$cutoff]);
    $db->prepare("DELETE FROM account_security_outbox WHERE state='done' AND created_at<?")->execute([gmdate('Y-m-d\TH:i:s\Z',time()-14*86400)]);
}
