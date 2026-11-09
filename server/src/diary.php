<?php
declare(strict_types=1);

/** Server civil day; device wall clocks never authorize a future entry. */
function genesisDreamClock(string $timeZone): array
{
    if (!in_array($timeZone, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true) && $timeZone !== 'UTC')
        throw new InvalidArgumentException('DREAM_INVALID_TIME_ZONE');
    $now = new DateTimeImmutable(genesisNow());
    return ['serverNow'=>$now->format('Y-m-d\TH:i:s\Z'), 'today'=>$now->setTimezone(new DateTimeZone($timeZone))->format('Y-m-d'), 'timeZone'=>$timeZone];
}

function genesisDreamMetadata(mixed $value): ?array
{
    if ($value === null) return null;
    if (!is_array($value) || array_diff(array_keys($value), ['day','timeZone']) || count($value) !== 2
        || !is_string($value['day'] ?? null) || !is_string($value['timeZone'] ?? null))
        throw new InvalidArgumentException('DREAM_INVALID_DATE');
    $day = DateTimeImmutable::createFromFormat('!Y-m-d', $value['day'], new DateTimeZone('UTC'));
    if (!$day || $day->format('Y-m-d') !== $value['day'] || $value['day'] < '0001-01-01')
        throw new InvalidArgumentException('DREAM_INVALID_DATE');
    $clock = genesisDreamClock($value['timeZone']);
    if ($value['day'] > $clock['today']) throw new GenesisResourceLimitException(422, 'DREAM_FUTURE_DATE');
    return ['day'=>$value['day'], 'timeZone'=>$value['timeZone']];
}

function genesisDiaryNotes(string $userId): array
{
    $q=genesisDb()->prepare('SELECT id,revision,schema_version,iv,ciphertext,updated_at FROM personal_diary_notes WHERE user_id=? ORDER BY updated_at DESC');
    $q->execute([$userId]);
    return array_map(static fn(array $row): array => ['id'=>$row['id'],'revision'=>(int)$row['revision'],'schemaVersion'=>(int)$row['schema_version'],
        'iv'=>$row['iv'],'ciphertext'=>$row['ciphertext'],'updatedAt'=>$row['updated_at']],$q->fetchAll());
}

function genesisDiaryDeletions(string $userId): array
{
    $q=genesisDb()->prepare('SELECT id,revision,local_only,updated_at FROM personal_diary_deletions WHERE user_id=?');
    $q->execute([$userId]);
    return array_map(static fn(array $row): array => ['id'=>$row['id'],'revision'=>(int)$row['revision'],'updatedAt'=>$row['updated_at'],'localOnly'=>(bool)$row['local_only']],$q->fetchAll());
}

function genesisDiarySettings(string $userId): array
{
    $q=genesisDb()->prepare('SELECT sync_enabled,revision FROM personal_diary_settings WHERE user_id=?');$q->execute([$userId]);$row=$q->fetch();
    return ['syncEnabled'=>$row?(bool)$row['sync_enabled']:true,'revision'=>$row?(int)$row['revision']:0];
}

function genesisDreamSettings(string $userId): array
{
    $q=genesisDb()->prepare('SELECT today_mode,revision FROM dream_journal_preferences WHERE user_id=?');
    $q->execute([$userId]);$row=$q->fetch();
    return ['todayMode'=>$row?$row['today_mode']:'off','revision'=>$row?(int)$row['revision']:0];
}

function genesisUpdateDreamSettings(string $userId,array $input): array
{
    $mode=$input['todayMode']??null;$revision=$input['expectedRevision']??null;
    if(array_diff(array_keys($input),['todayMode','expectedRevision']) || count($input)!==2
        || !in_array($mode,['off','morning','all-day'],true) || !is_int($revision) || $revision<0)
        throw new InvalidArgumentException('DREAM_INVALID_SETTINGS');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $old=genesisDreamSettings($userId);
        // Exact retry after a lost receipt is harmless; a stale different choice is a conflict.
        if($old['revision']===$revision+1 && $old['todayMode']===$mode){$db->commit();return ['dreamSettings'=>$old];}
        if($old['revision']!==$revision)throw new GenesisResourceLimitException(409,'DREAM_SETTINGS_CONFLICT');
        $db->prepare('INSERT INTO dream_journal_preferences(user_id,today_mode,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET today_mode=excluded.today_mode,revision=excluded.revision,updated_at=excluded.updated_at')
            ->execute([$userId,$mode,$revision+1,genesisNow()]);
        $db->commit();return ['dreamSettings'=>genesisDreamSettings($userId)];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

function genesisDiarySnapshot(string $userId): string
{
    $q=genesisDb()->prepare('SELECT id,revision FROM personal_diary_notes WHERE user_id=? ORDER BY id');$q->execute([$userId]);
    return hash('sha256',json_encode(array_map(static fn(array $row):array=>[$row['id'],(int)$row['revision']],$q->fetchAll()),JSON_THROW_ON_ERROR));
}

/** The client must durably retain this exact snapshot before asking to remove server copies. */
function genesisUpdateDiarySettings(string $userId,array $input): array
{
    $enabled=$input['syncEnabled']??null;$revision=$input['expectedRevision']??null;$snapshot=$input['expectedSnapshot']??null;
    if(!is_bool($enabled)||!is_int($revision)||$revision<0||!is_string($snapshot)||!preg_match('/^[a-f0-9]{64}$/D',$snapshot)
        ||array_diff(array_keys($input),['syncEnabled','expectedRevision','expectedSnapshot']))throw new InvalidArgumentException('Invalid diary settings.');
    $hash=hash('sha256',json_encode([$enabled,$revision,$snapshot],JSON_THROW_ON_ERROR));$db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT revision,command_hash,removed_count FROM personal_diary_settings WHERE user_id=?');$q->execute([$userId]);$old=$q->fetch();
        if($old&&hash_equals($old['command_hash'],$hash)){
            $db->commit();return ['settings'=>genesisDiarySettings($userId),'snapshot'=>genesisDiarySnapshot($userId),'deleted'=>genesisDiaryDeletions($userId),'removed'=>(int)$old['removed_count']];
        }
        if((int)($old['revision']??0)!==$revision)throw new GenesisResourceLimitException(409,'DIARY_SETTINGS_CONFLICT');
        if(!hash_equals(genesisDiarySnapshot($userId),$snapshot))throw new GenesisResourceLimitException(409,'DIARY_SNAPSHOT_CHANGED');
        $now=genesisNow();$removed=0;
        if(!$enabled){
            $q=$db->prepare('SELECT id,revision FROM personal_diary_notes WHERE user_id=?');$q->execute([$userId]);$notes=$q->fetchAll();$removed=count($notes);
            foreach($notes as $note)$db->prepare('INSERT INTO personal_diary_deletions(user_id,id,revision,local_only,updated_at) VALUES(?,?,?,?,?)')
                ->execute([$userId,$note['id'],(int)$note['revision']+1,1,$now]);
            $db->prepare('DELETE FROM personal_diary_notes WHERE user_id=?')->execute([$userId]);
        }
        $db->prepare('INSERT INTO personal_diary_settings VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET sync_enabled=excluded.sync_enabled,revision=excluded.revision,command_hash=excluded.command_hash,removed_count=excluded.removed_count,updated_at=excluded.updated_at')
            ->execute([$userId,(int)$enabled,$revision+1,$hash,$removed,$now]);
        $db->commit();return ['settings'=>genesisDiarySettings($userId),'snapshot'=>genesisDiarySnapshot($userId),'deleted'=>genesisDiaryDeletions($userId),'removed'=>$removed];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Revision-checked, idempotent deletion. No title, text, IV or ciphertext survives here. */
function genesisDeleteDiaryNote(string $userId,string $id,array $input): array
{
    $revision=$input['expectedRevision']??null;
    if(!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id) || array_keys($input)!==['expectedRevision'] || !is_int($revision) || $revision<1)
        throw new InvalidArgumentException('Invalid diary deletion.');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT revision,updated_at FROM personal_diary_deletions WHERE user_id=? AND id=?');$q->execute([$userId,$id]);$deleted=$q->fetch();
        if($deleted){
            if((int)$deleted['revision']!==$revision+1)throw new GenesisResourceLimitException(409,'DIARY_REVISION_CONFLICT');
            $db->commit();return ['id'=>$id,'revision'=>(int)$deleted['revision'],'updatedAt'=>$deleted['updated_at'],'deleted'=>true];
        }
        $q=$db->prepare('SELECT revision FROM personal_diary_notes WHERE user_id=? AND id=?');$q->execute([$userId,$id]);$old=$q->fetch();
        if(!$old)throw new GenesisResourceLimitException(404,'DIARY_NOTE_NOT_FOUND');
        if((int)$old['revision']!==$revision)throw new GenesisResourceLimitException(409,'DIARY_REVISION_CONFLICT');
        $now=genesisNow();$next=$revision+1;
        $db->prepare('DELETE FROM personal_diary_notes WHERE user_id=? AND id=?')->execute([$userId,$id]);
        $db->prepare('INSERT INTO personal_diary_deletions(user_id,id,revision,updated_at) VALUES(?,?,?,?)')->execute([$userId,$id,$next,$now]);
        $db->commit();return ['id'=>$id,'revision'=>$next,'updatedAt'=>$now,'deleted'=>true];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}

/** Only ciphertext reaches SQLite. Concurrent edits require an explicit client decision. */
function genesisSaveDiaryNote(string $userId,string $id,array $input): array
{
    $revision=$input['expectedRevision']??null;$iv=$input['iv']??null;$ciphertext=$input['ciphertext']??null;
    $adviceId = $input['adviceId'] ?? null;
    $dream = genesisDreamMetadata($input['dream'] ?? null);
    if ($dream !== null) {
        if ($adviceId !== null) throw new InvalidArgumentException('DREAM_INVALID_NOTE');
        genesisRequireFeature($userId, 'dream-journal');
    }
    if (($adviceId !== null && (!is_string($adviceId) || preg_match('/\Aadvice-[a-f0-9]{24}\z/D',$adviceId)!==1))
        || !preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id) || array_diff(array_keys($input),['expectedRevision','schemaVersion','iv','ciphertext','adviceId','dream'])
        || ($input['schemaVersion']??null)!==1 || !is_int($revision) || $revision<0
        || !is_string($iv) || strlen($iv)!==16 || strlen((string)base64_decode($iv,true))!==12
        || !is_string($ciphertext) || strlen($ciphertext)<24 || strlen($ciphertext)>300_000 || base64_decode($ciphertext,true)===false)
        throw new InvalidArgumentException('Invalid diary envelope.');
    $hash=hash('sha256','v1:'.$revision.':'.$iv.':'.$ciphertext.($dream===null?'':':dream:'.json_encode($dream,JSON_THROW_ON_ERROR)));$db=genesisDb();$owns=!$db->inTransaction();if($owns)genesisBeginWriteTransaction($db);
    try {
        if(!genesisDiarySettings($userId)['syncEnabled'])throw new GenesisResourceLimitException(409,'DIARY_SYNC_DISABLED');
        $q=$db->prepare('SELECT 1 FROM personal_diary_deletions WHERE user_id=? AND id=?');$q->execute([$userId,$id]);
        if($q->fetchColumn())throw new GenesisResourceLimitException(409,'DIARY_NOTE_DELETED');
        $q=$db->prepare('SELECT revision,payload_hash,updated_at FROM personal_diary_notes WHERE user_id=? AND id=?');$q->execute([$userId,$id]);$old=$q->fetch();
        $q=$db->prepare('SELECT 1 FROM personal_diary_dreams WHERE user_id=? AND note_id=?');$q->execute([$userId,$id]);
        if ($q->fetchColumn() && $dream===null) throw new InvalidArgumentException('DREAM_METADATA_REQUIRED');
        if ($adviceId !== null) {
            $q=$db->prepare('SELECT 1 FROM daily_advice_entries WHERE user_id=? AND advice_id=? LIMIT 1');$q->execute([$userId,$adviceId]);
            if (!$q->fetchColumn()) throw new GenesisResourceLimitException(403,'DIARY_ADVICE_NOT_DRAWN');
            $q=$db->prepare('SELECT note_id FROM personal_diary_advice_references WHERE user_id=? AND advice_id=?');$q->execute([$userId,$adviceId]);
            $linked=$q->fetchColumn();
            if ($linked !== false && $linked !== $id) throw new GenesisResourceLimitException(409,'DIARY_ADVICE_ALREADY_SAVED');
        }
        if($old&&hash_equals($old['payload_hash'],$hash)){
            if ($adviceId !== null) $db->prepare('INSERT OR IGNORE INTO personal_diary_advice_references VALUES(?,?,?)')->execute([$userId,$id,$adviceId]);
            if($owns)$db->commit();return ['revision'=>(int)$old['revision'],'updatedAt'=>$old['updated_at']];
        }
        if((int)($old['revision']??0)!==$revision)throw new GenesisResourceLimitException(409,'DIARY_REVISION_CONFLICT');
        $q=$db->prepare('SELECT COUNT(*),COALESCE(SUM(length(ciphertext)),0) FROM personal_diary_notes WHERE user_id=? AND id<>?');$q->execute([$userId,$id]);$usage=$q->fetch(PDO::FETCH_NUM);
        if (!$old && $adviceId === null) {
            $q=$db->prepare('SELECT COUNT(*) FROM personal_diary_notes n WHERE n.user_id=? AND NOT EXISTS(SELECT 1 FROM personal_diary_advice_references a WHERE a.user_id=n.user_id AND a.note_id=n.id)');$q->execute([$userId]);
            genesisRequireFeatureQuota($userId,'diary',(int)$q->fetchColumn());
        }
        if((!$old && (int)$usage[0]>=20000) || (int)$usage[1]+strlen($ciphertext)>20_000_000)throw new GenesisResourceLimitException(413,'DIARY_STORAGE_LIMIT');
        $now=genesisNow();$next=$revision+1;
        $db->prepare('INSERT INTO personal_diary_notes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET revision=excluded.revision,schema_version=excluded.schema_version,iv=excluded.iv,ciphertext=excluded.ciphertext,payload_hash=excluded.payload_hash,updated_at=excluded.updated_at')
            ->execute([$userId,$id,$next,1,$iv,$ciphertext,$hash,$now]);
        if ($adviceId !== null) $db->prepare('INSERT OR IGNORE INTO personal_diary_advice_references VALUES(?,?,?)')->execute([$userId,$id,$adviceId]);
        if ($dream!==null) $db->prepare('INSERT INTO personal_diary_dreams(user_id,note_id,dream_day,time_zone) VALUES(?,?,?,?) ON CONFLICT(user_id,note_id) DO UPDATE SET dream_day=excluded.dream_day,time_zone=excluded.time_zone')->execute([$userId,$id,$dream['day'],$dream['timeZone']]);
        if($owns)$db->commit();return ['revision'=>$next,'updatedAt'=>$now];
    }catch(Throwable $error){if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}
