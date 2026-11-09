<?php
declare(strict_types=1);
require_once __DIR__ . '/habit-reminder-plan.php';
require_once __DIR__ . '/calendar.php';
require_once __DIR__ . '/web-push.php';
require_once __DIR__ . '/shared-content-storage.php';
require_once __DIR__ . '/background-jobs.php';
require_once __DIR__ . '/habit-reminder-delivery.php';

function genesisHabitReminderDevices(string $userId): array
{
    $q = genesisDb()->prepare('SELECT * FROM habit_reminder_devices WHERE user_id=? AND enabled=1 ORDER BY created_at,id');
    $q->execute([$userId]); $rows = $q->fetchAll(); $q->closeCursor(); return $rows;
}

function genesisHabitReminderProfile(string $userId): ?array
{
    $q = genesisDb()->prepare('SELECT * FROM habit_reminder_profiles WHERE user_id=?');
    $q->execute([$userId]); $row = $q->fetch(); $q->closeCursor(); return $row ?: null;
}

function genesisHabitReminderStatus(string $userId, ?string $deviceKey = null): array
{
    $devices = genesisHabitReminderDevices($userId); $profile = genesisHabitReminderProfile($userId);
    $device = null;
    if ($deviceKey !== null) {
        $q = genesisDb()->prepare('SELECT id,revision,enabled,time_zone,max_per_day,snooze_minutes FROM habit_reminder_devices WHERE user_id=? AND device_key=?');
        $q->execute([$userId,$deviceKey]); $device = $q->fetch() ?: null; $q->closeCursor();
    }
    $q = genesisDb()->prepare('SELECT version FROM workspace_blobs WHERE user_id=?');
    $q->execute([$userId]); $version = (int)($q->fetchColumn() ?: 0); $q->closeCursor();
    $capabilities = genesisPushConfiguration();
    return ['capabilities'=>array_intersect_key($capabilities,array_flip(['available','blocker','publicKey'])),
        'hasDevices'=>(bool)$devices,'device'=>$device,'workspaceVersion'=>$version,
        'profile'=>$profile ? ['revision'=>(int)$profile['revision'],'needsRefresh'=>(bool)$profile['needs_refresh']
            || !$profile['expires_at'] || strtotime($profile['expires_at']) <= time(),
            'expiresAt'=>$profile['expires_at'],'workspaceVersion'=>(int)$profile['workspace_version']] : null];
}

/** Registration cannot enable anything before the explicit consent action. No workspace is accepted here. */
function genesisHabitReminderRegister(string $userId, array $input, ?array $testCapabilities = null): array
{
    genesisHabitReminderKeys($input, ['deviceKey','subscription','timeZone','maxPerDay','snoozeMinutes','consent','expectedRevision','requestId']);
    if (($input['consent'] ?? null) !== true || !is_string($input['deviceKey'] ?? null)
        || !preg_match('/^[a-zA-Z0-9_-]{16,100}$/D',$input['deviceKey'])) throw new InvalidArgumentException('HABIT_REMINDER_CONSENT_REQUIRED');
    if (!is_int($input['expectedRevision'] ?? null) || $input['expectedRevision'] < 0
        || !is_string($input['requestId'] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{16,100}$/D',$input['requestId']))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_REVISION');
    $capabilities = $testCapabilities ?? genesisPushConfiguration();
    if (empty($capabilities['available'])) throw new DomainException('HABIT_REMINDER_PUSH_UNAVAILABLE');
    $subscription = genesisPushSubscription(is_array($input['subscription'] ?? null) ? $input['subscription'] : []);
    $zone = genesisHabitReminderZone($input['timeZone'] ?? null);
    $maximum = $input['maxPerDay'] ?? 128; $snooze = $input['snoozeMinutes'] ?? 10;
    if (!in_array($maximum,[4,12,24,64,128],true) || !in_array($snooze,[5,10,15,30,60],true))
        throw new InvalidArgumentException('INVALID_HABIT_REMINDER_FREQUENCY');
    $hash = hash('sha256',json_encode([$subscription,$zone,$maximum,$snooze],JSON_THROW_ON_ERROR));
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $q = $db->prepare('SELECT * FROM habit_reminder_devices WHERE user_id=? AND device_key=?');
        $q->execute([$userId,$input['deviceKey']]); $previous = $q->fetch(); $q->closeCursor();
        if ($previous && $previous['enabled'] && $previous['request_id'] === $input['requestId'] && $previous['request_hash'] === $hash) {
            $db->commit(); return ['id'=>$previous['id'],'revision'=>(int)$previous['revision']];
        }
        if ($input['expectedRevision'] !== ($previous ? (int)$previous['revision'] : 0))
            throw new DomainException('HABIT_REMINDER_DEVICE_CONFLICT');
        if ((!$previous || !$previous['enabled']) && count(genesisHabitReminderDevices($userId)) >= 10) throw new DomainException('HABIT_REMINDER_DEVICE_LIMIT');
        $now = genesisNow(); $id = $previous['id'] ?? genesisUuid();
        $revision = $previous ? (int)$previous['revision'] + 1 : 1;
        $db->prepare('INSERT INTO habit_reminder_devices(id,user_id,device_key,encrypted_subscription,time_zone,max_per_day,snooze_minutes,revision,created_at,updated_at,request_id,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,device_key) DO UPDATE SET encrypted_subscription=excluded.encrypted_subscription,time_zone=excluded.time_zone,max_per_day=excluded.max_per_day,snooze_minutes=excluded.snooze_minutes,revision=excluded.revision,enabled=1,request_id=excluded.request_id,request_hash=excluded.request_hash,updated_at=excluded.updated_at')
            ->execute([$id,$userId,$input['deviceKey'],genesisSharedContentEncrypt(json_encode($subscription,JSON_THROW_ON_ERROR)),
                $zone,$maximum,$snooze,$revision,$previous['created_at'] ?? $now,$now,$input['requestId'],$hash]);
        $db->prepare('INSERT OR IGNORE INTO habit_reminder_profiles(user_id,updated_at) VALUES(?,?)')->execute([$userId,$now]);
        $profile = genesisHabitReminderProfile($userId);
        if ($profile && !$profile['needs_refresh'] && $profile['encrypted_plan']) {
            $plan = json_decode(genesisSharedContentDecrypt($profile['encrypted_plan']),true,32,JSON_THROW_ON_ERROR);
            genesisHabitReminderSchedule($userId,$plan,(int)$profile['revision']);
        }
        $db->commit(); return ['id'=>$id,'revision'=>$revision];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisHabitReminderCancelDeliveries(string $userId, ?string $deviceId = null): void
{
    $db = genesisDb(); $filter = $deviceId === null ? '' : ' AND device_id=?';
    $args = $deviceId === null ? [$userId] : [$userId,$deviceId];
    $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE kind='habit-notification' AND state IN ('pending','running') AND unique_key IN (SELECT 'habit-notification:'||id FROM habit_reminder_deliveries WHERE user_id=?".$filter.')')
        ->execute([genesisNow(),...$args]);
    $db->prepare("UPDATE habit_reminder_deliveries SET state='cancelled',error_code=NULL,updated_at=? WHERE user_id=?".$filter." AND state IN ('pending','sending')")
        ->execute([genesisNow(),...$args]);
}

function genesisHabitReminderDelete(string $userId, string $deviceId, ?int $expectedRevision = null): void
{
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT revision,enabled FROM habit_reminder_devices WHERE id=? AND user_id=?');
        $q->execute([$deviceId,$userId]); $device=$q->fetch(); $q->closeCursor();
        if ($device && $device['enabled']) {
            if ($expectedRevision !== null && $expectedRevision !== (int)$device['revision']) throw new DomainException('HABIT_REMINDER_DEVICE_CONFLICT');
            genesisHabitReminderCancelDeliveries($userId,$deviceId);
            // A revision tombstone rejects an enable request delayed until after disable/logout.
            $db->prepare('UPDATE habit_reminder_devices SET enabled=0,encrypted_subscription=NULL,revision=revision+1,updated_at=? WHERE id=? AND user_id=?')
                ->execute([genesisNow(),$deviceId,$userId]);
        }
        if (!genesisHabitReminderDevices($userId)) $db->prepare('DELETE FROM habit_reminder_profiles WHERE user_id=?')->execute([$userId]);
        $db->commit();
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisHabitReminderInvalidate(string $userId, int $workspaceVersion): void
{
    if (!genesisHabitReminderDevices($userId)) return;
    genesisDb()->prepare('INSERT INTO habit_reminder_profiles(user_id,workspace_version,needs_refresh,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET workspace_version=excluded.workspace_version,needs_refresh=1,updated_at=excluded.updated_at')
        ->execute([$userId,$workspaceVersion,genesisNow()]);
    genesisHabitReminderCancelDeliveries($userId);
}

/** Called inside the accepted workspace transaction, or by the version-checked refresh endpoint. */
function genesisHabitReminderSavePlan(string $userId, int $workspaceVersion, array $plan): void
{
    if (!genesisHabitReminderDevices($userId)) return;
    $db = genesisDb(); $previous = genesisHabitReminderProfile($userId);
    $hash = hash('sha256',json_encode([$plan['rows'],$plan['tone'],$plan['quietHoursStart'],$plan['quietHoursEnd'],$plan['expiresAt']],JSON_THROW_ON_ERROR));
    $revision = $previous ? (int)$previous['revision'] : 0;
    if (!$previous || $previous['plan_hash'] !== $hash || $previous['needs_refresh']) $revision++;
    $db->prepare('INSERT INTO habit_reminder_profiles(user_id,encrypted_plan,plan_hash,workspace_version,revision,expires_at,needs_refresh,updated_at) VALUES(?,?,?,?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_plan=excluded.encrypted_plan,plan_hash=excluded.plan_hash,workspace_version=excluded.workspace_version,revision=excluded.revision,expires_at=excluded.expires_at,needs_refresh=0,updated_at=excluded.updated_at')
        ->execute([$userId,genesisSharedContentEncrypt(json_encode($plan,JSON_THROW_ON_ERROR)),$hash,$workspaceVersion,$revision,$plan['expiresAt'],genesisNow()]);
    if (!$previous || $revision !== (int)$previous['revision']) genesisHabitReminderSchedule($userId,$plan,$revision);
}

function genesisHabitReminderRefresh(string $userId, array $input): array
{
    genesisHabitReminderKeys($input,['workspaceVersion','plan']);
    if (!is_int($input['workspaceVersion'] ?? null) || $input['workspaceVersion'] < 0) throw new InvalidArgumentException('INVALID_HABIT_REMINDER_PLAN');
    $plan = genesisHabitReminderPlan($input['plan'] ?? null);
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        $q = $db->prepare('SELECT version FROM workspace_blobs WHERE user_id=?'); $q->execute([$userId]);
        $currentVersion = (int)($q->fetchColumn() ?: 0); $q->closeCursor();
        if ($currentVersion !== $input['workspaceVersion']) throw new GenesisWorkspaceConflictException($currentVersion);
        genesisHabitReminderSavePlan($userId,$currentVersion,$plan); $db->commit();
        return ['ok'=>true,'expiresAt'=>$plan['expiresAt']];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

/** Stable delivery IDs survive schedule refresh, retries and simultaneous workspace writers. */
function genesisHabitReminderSchedule(string $userId, array $plan, int $revision): void
{
    $db = genesisDb(); $now = new DateTimeImmutable(genesisNow());
    foreach (genesisHabitReminderDevices($userId) as $device) {
        $keep = []; $daily = []; $ordered=[];
        foreach ($plan['rows'] as $row) {
            $at = $row['kind'] === 'goal' ? genesisCalendarWallDateTime($row['date'],$row['localTime'],$device['time_zone'])
                : new DateTimeImmutable($row['at']);
            $at = $at->setTimezone(new DateTimeZone('UTC'));
            $ordered[]=['at'=>$at,'row'=>$row];
        }
        usort($ordered,static fn($a,$b)=>$a['at']<=>$b['at'] ?: strcmp($a['row']['id'],$b['row']['id']));
        foreach ($ordered as $entry) {
            $at=$entry['at']; $row=$entry['row'];
            $endOfDay = (new DateTimeImmutable($row['date'].' 00:00',new DateTimeZone($row['kind'] === 'goal' ? $device['time_zone'] : $row['timeZone'])))->modify('+1 day');
            $expires = min($at->getTimestamp()+7200,strtotime($plan['expiresAt']),$endOfDay->getTimestamp());
            if ($expires <= $now->getTimestamp() || (!$row['allowDuringQuietHours'] && genesisHabitReminderQuiet($at,$device['time_zone'],$plan['quietHoursStart'],$plan['quietHoursEnd']))) continue;
            $day = $at->setTimezone(new DateTimeZone($device['time_zone']))->format('Y-m-d');
            if (($daily[$day] ?? 0) >= (int)$device['max_per_day']) continue;
            $daily[$day] = ($daily[$day] ?? 0) + 1;
            $eventKey = hash('sha256',$row['id']);
            $q = $db->prepare('SELECT id,state,scheduled_at FROM habit_reminder_deliveries WHERE device_id=? AND event_key=?');
            $q->execute([$device['id'],$eventKey]); $existing = $q->fetch(); $q->closeCursor();
            $id = $existing['id'] ?? genesisUuid(); $keep[$id] = true;
            if ($existing && $existing['state'] === 'sent') continue;
            $scheduled = $at->format('Y-m-d\TH:i:s\Z'); $stamp = genesisNow();
            $target = [...$row,'at'=>$at->format('Y-m-d\TH:i:s.v\Z')];
            $db->prepare("INSERT INTO habit_reminder_deliveries(id,user_id,device_id,profile_revision,event_key,encrypted_target,scheduled_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id,event_key) DO UPDATE SET profile_revision=excluded.profile_revision,encrypted_target=excluded.encrypted_target,scheduled_at=excluded.scheduled_at,expires_at=excluded.expires_at,state=CASE WHEN habit_reminder_deliveries.state='sending' THEN 'sending' ELSE 'pending' END,error_code=NULL,updated_at=excluded.updated_at")
                ->execute([$id,$userId,$device['id'],$revision,$eventKey,genesisSharedContentEncrypt(json_encode($target,JSON_THROW_ON_ERROR)),
                    $scheduled,gmdate('Y-m-d\TH:i:s\Z',$expires),$stamp,$stamp]);
            genesisBackgroundEnqueue('habit-notification','habit-notification:'.$id,['deliveryId'=>$id],$scheduled);
            $db->prepare("UPDATE background_jobs SET state='pending',attempts=CASE WHEN state='pending' THEN attempts ELSE 0 END,available_at=?,error_code=NULL,updated_at=? WHERE unique_key=? AND kind='habit-notification' AND state IN ('pending','cancelled','failed','succeeded')")
                ->execute([$scheduled,$stamp,'habit-notification:'.$id]);
        }
        // Snoozes retain their own scheduled time while their original occurrence is still in the plan.
        $q=$db->prepare("SELECT id,encrypted_target FROM habit_reminder_deliveries WHERE device_id=? AND snooze_of IS NOT NULL AND state IN ('pending','sending') AND expires_at>?");
        $q->execute([$device['id'],genesisNow()]); $snoozes=$q->fetchAll(); $q->closeCursor();
        $valid=array_column($plan['rows'],null,'id');
        foreach($snoozes as $snooze) {
            $target=json_decode(genesisSharedContentDecrypt($snooze['encrypted_target']),true,16,JSON_THROW_ON_ERROR);
            if(isset($valid[$target['id']]) && ($valid[$target['id']]['ruleId'] ?? null) === ($target['ruleId'] ?? null)) {
                $keep[$snooze['id']]=true;
                $db->prepare('UPDATE habit_reminder_deliveries SET profile_revision=? WHERE id=?')->execute([$revision,$snooze['id']]);
            }
        }
        $q = $db->prepare("SELECT id FROM habit_reminder_deliveries WHERE user_id=? AND device_id=? AND state IN ('pending','sending')");
        $q->execute([$userId,$device['id']]); $old = $q->fetchAll(PDO::FETCH_COLUMN); $q->closeCursor();
        foreach ($old as $id) if (!isset($keep[$id])) {
            $db->prepare("UPDATE habit_reminder_deliveries SET state='cancelled',updated_at=? WHERE id=?")->execute([genesisNow(),$id]);
            $db->prepare("UPDATE background_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE unique_key=? AND state IN ('pending','running')")
                ->execute([genesisNow(),'habit-notification:'.$id]);
        }
    }
}

/** Optional metadata must never prevent an encrypted personal save, including older clients. */
function genesisHabitReminderWorkspaceSaved(string $userId,int $version,array $payload): void
{
    if (!genesisHabitReminderDevices($userId)) return;
    $db=genesisDb();$db->exec('SAVEPOINT habit_reminder_metadata');
    try {
        $plan=genesisHabitReminderPlan($payload['habitReminderPlan'] ?? null);
        genesisHabitReminderSavePlan($userId,$version,$plan);
        $db->exec('RELEASE habit_reminder_metadata');
    } catch (Throwable) {
        $db->exec('ROLLBACK TO habit_reminder_metadata');$db->exec('RELEASE habit_reminder_metadata');
        genesisHabitReminderInvalidate($userId,$version);
    }
}

/** Bounded retention of opaque receipts; events older than seven days cannot re-enter a fresh plan. */
function genesisHabitReminderMaintenance(): void
{
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try{
        $q=$db->prepare('SELECT user_id FROM habit_reminder_profiles WHERE needs_refresh=0 AND expires_at<=? LIMIT 100');
        $q->execute([genesisNow()]);$expired=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
        foreach($expired as $userId){
            genesisHabitReminderCancelDeliveries($userId);
            $db->prepare('UPDATE habit_reminder_profiles SET needs_refresh=1,encrypted_plan=NULL,updated_at=? WHERE user_id=?')->execute([genesisNow(),$userId]);
        }
        $q=$db->prepare("SELECT id FROM habit_reminder_deliveries WHERE expires_at<? AND state<>'sending' LIMIT 500");
        $q->execute([gmdate('Y-m-d\TH:i:s\Z',time()-7*86400)]);$ids=$q->fetchAll(PDO::FETCH_COLUMN);$q->closeCursor();
        foreach($ids as $id){
            $db->prepare("DELETE FROM background_jobs WHERE kind='habit-notification' AND unique_key=? AND state<>'running'")->execute(['habit-notification:'.$id]);
            $db->prepare("DELETE FROM habit_reminder_deliveries WHERE id=? AND NOT EXISTS(SELECT 1 FROM background_jobs WHERE kind='habit-notification' AND unique_key=? AND state='running')")
                ->execute([$id,'habit-notification:'.$id]);
        }
        $db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
