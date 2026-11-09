<?php
declare(strict_types=1);

const GENESIS_PARTNER_SHARE_BPS = 5000;
const GENESIS_PARTNER_MAX_MINOR = 1000000000000;

function genesisPartnersEnabled(): bool
{
    return function_exists('genesisConfig') && (genesisConfig()['partners']['enabled'] ?? false) === true;
}

function genesisPartnersRequireEnabled(): void
{
    if (!genesisPartnersEnabled()) throw new GenesisResourceLimitException(503, 'PARTNERS_DISABLED');
}

function genesisPartnerOwner(string $actorId): array
{
    genesisPartnersRequireEnabled();
    $actor = genesisFindUser($actorId);
    if (!$actor || !genesisIsAdminUser($actor) || !genesisSessionIsPrimaryGoogleUser($actor))
        throw new GenesisResourceLimitException(403, 'FORBIDDEN');
    return $actor;
}

function genesisPartnerRow(PDO $db, string $id): array
{
    $q = $db->prepare('SELECT * FROM partners WHERE id=?'); $q->execute([$id]);
    return $q->fetch() ?: throw new GenesisResourceLimitException(404, 'PARTNER_NOT_FOUND');
}

function genesisPartnerAccess(string $userId): ?array
{
    if (!genesisPartnersEnabled()) return null;
    $q = genesisDb()->prepare('SELECT id,panel_enabled FROM partners WHERE user_id=?'); $q->execute([$userId]);
    $row = $q->fetch();
    return $row && (bool)$row['panel_enabled'] ? ['panelEnabled' => true] : null;
}

function genesisPartnerPolicy(PDO $db): ?array
{
    $row = $db->query('SELECT p.* FROM partner_settings s JOIN partner_policies p ON p.id=s.policy_id WHERE s.singleton=1')->fetch();
    return $row ?: null;
}

function genesisPartnerMoney(mixed $value, bool $signed = false): int
{
    if (!is_int($value) || abs($value) > GENESIS_PARTNER_MAX_MINOR || (!$signed && $value < 0))
        throw new InvalidArgumentException('PARTNER_MONEY_INVALID');
    return $value;
}

function genesisPartnerValidDate(mixed $value): bool
{
    if (!is_string($value) || preg_match('/\A\d{4}-\d{2}-\d{2}\z/D', $value) !== 1) return false;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date !== false && $date->format('Y-m-d') === $value;
}

/** Round the cumulative entitlement, then take its delta; partial refunds cannot accumulate rounding drift. */
function genesisPartnerHalf(int $baseMinor): int
{
    genesisPartnerMoney($baseMinor, true);
    $absolute = abs($baseMinor);
    $rounded = intdiv($absolute, 2) + $absolute % 2;
    return $baseMinor < 0 ? -$rounded : $rounded;
}

function genesisPartnerText(mixed $value, int $maximum, bool $required = true): string
{
    if (!is_string($value) || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)
        || mb_strlen(trim($value)) > $maximum || ($required && trim($value) === ''))
        throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
    return trim($value);
}

function genesisPartnerFields(array $input, array $allowed): void
{
    if (array_diff(array_keys($input), [...$allowed, 'requestId'])) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
}

function genesisPartnerAudit(PDO $db, string $actor, string $action, ?string $partner, ?string $resource, string $reason): void
{
    $db->prepare('INSERT INTO partner_audit(id,partner_id,actor_id,action,resource_id,reason,created_at) VALUES(?,?,?,?,?,?,?)')
        ->execute([genesisUuid(), $partner, $actor, $action, $resource, $reason, genesisNow()]);
}

/** The first harmless write acquires SQLite's writer before balances, revisions or receipts are read. */
function genesisPartnerWrite(PDO $db): void
{
    $db->beginTransaction();
    try { $db->exec('UPDATE partner_settings SET revision=revision WHERE singleton=1'); }
    catch (Throwable $error) { $db->rollBack(); throw $error; }
}

function genesisPartnerMutate(string $actorId, string $action, array $input, callable $change): array
{
    genesisPartnerOwner($actorId);
    $requestId = $input['requestId'] ?? null;
    if (!is_string($requestId) || preg_match('/\A[a-zA-Z0-9_-]{16,100}\z/D', $requestId) !== 1)
        throw new InvalidArgumentException('PARTNER_REQUEST_ID_INVALID');
    $canonical = $input; ksort($canonical);
    $hash = hash('sha256', json_encode([$action, $canonical], JSON_THROW_ON_ERROR));
    $db = genesisDb(); genesisPartnerWrite($db);
    try {
        $q = $db->prepare('SELECT * FROM partner_mutation_receipts WHERE actor_id=? AND request_id=?'); $q->execute([$actorId, $requestId]);
        if ($receipt = $q->fetch()) {
            if (!hash_equals($receipt['payload_hash'], $hash)) throw new GenesisResourceLimitException(409, 'PARTNER_REQUEST_CONFLICT');
            $result = json_decode($receipt['result_json'], true, 32, JSON_THROW_ON_ERROR); $db->commit(); return $result;
        }
        $result = $change($db);
        $db->prepare('INSERT INTO partner_mutation_receipts(actor_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)')
            ->execute([$actorId, $requestId, $hash, json_encode($result, JSON_THROW_ON_ERROR), genesisNow()]);
        $db->commit(); return $result;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisPartnerRevision(array $row, mixed $expected): void
{
    if (!is_int($expected) || $expected !== (int)$row['revision']) throw new GenesisResourceLimitException(409, 'PARTNER_REVISION_CONFLICT');
}

function genesisPartnerLookup(string $actorId, mixed $email): array
{
    genesisPartnerOwner($actorId);
    $email = mb_strtolower(genesisPartnerText($email, 254));
    $allowed = genesisConfig()['partners']['allowed_emails'] ?? [];
    if (!is_array($allowed) || !in_array($email, array_map(static fn($value) => mb_strtolower(trim((string)$value)), $allowed), true))
        throw new GenesisResourceLimitException(403, 'PARTNER_TARGET_NOT_APPROVED');
    $user = genesisFindUserByEmail($email);
    if (!$user || genesisUserProvider($user) !== 'google' || genesisIsAdminUser($user))
        throw new GenesisResourceLimitException(404, 'PARTNER_EXISTING_ACCOUNT_REQUIRED');
    return ['id' => $user['id'], 'email' => $user['email'], 'displayName' => $user['display_name'] ?? ''];
}

function genesisPartnerConfigure(string $actorId, array $input): array
{
    genesisPartnerFields($input, ['expectedRevision', 'invitationDays', 'retentionDays', 'confirmed']);
    if (($input['confirmed'] ?? null) !== true || !is_int($input['invitationDays'] ?? null)
        || $input['invitationDays'] < 1 || $input['invitationDays'] > 365
        || !array_key_exists('retentionDays', $input) || $input['retentionDays'] !== null) throw new InvalidArgumentException('PARTNER_POLICY_CONFIRMATION_REQUIRED');
    return genesisPartnerMutate($actorId, 'policy', $input, static function (PDO $db) use ($actorId, $input): array {
        $settings = $db->query('SELECT * FROM partner_settings WHERE singleton=1')->fetch();
        genesisPartnerRevision($settings, $input['expectedRevision'] ?? null);
        $db->prepare('INSERT INTO partner_policies(share_bps,invitation_days,retention_days,confirmed_at,actor_id) VALUES(?,?,?,?,?)')
            ->execute([GENESIS_PARTNER_SHARE_BPS, $input['invitationDays'], $input['retentionDays'], genesisNow(), $actorId]);
        $id = (int)$db->lastInsertId();
        $db->prepare('UPDATE partner_settings SET policy_id=?,revision=revision+1 WHERE singleton=1')->execute([$id]);
        genesisPartnerAudit($db, $actorId, 'policy-confirmed', null, (string)$id, 'Owner confirmed invitation and financial retention periods');
        return ['policyId' => $id, 'revision' => (int)$settings['revision'] + 1];
    });
}

function genesisPartnerClientLookup(string $actorId, mixed $email): array
{
    genesisPartnerOwner($actorId);
    $user = genesisFindUserByEmail(mb_strtolower(genesisPartnerText($email, 254)));
    if (!$user || genesisUserProvider($user) !== 'google') throw new GenesisResourceLimitException(404, 'PARTNER_EXISTING_ACCOUNT_REQUIRED');
    $q = genesisDb()->prepare('SELECT c.id,c.partner_id,p.label FROM partner_clients c JOIN partners p ON p.id=c.partner_id WHERE c.user_id=? AND c.ended_at IS NULL');
    $q->execute([$user['id']]); $binding = $q->fetch();
    return ['id' => $user['id'], 'email' => $user['email'], 'displayName' => $user['display_name'] ?? '',
        'binding' => $binding ? ['id' => $binding['id'], 'partnerId' => $binding['partner_id'], 'label' => $binding['label']] : null];
}

function genesisPartnerAssign(string $actorId, array $input): array
{
    genesisPartnerFields($input, ['userId', 'email', 'label']);
    $target = genesisPartnerLookup($actorId, $input['email'] ?? null);
    if ($target['id'] !== ($input['userId'] ?? null)) throw new GenesisResourceLimitException(409, 'PARTNER_TARGET_CHANGED');
    $label = genesisPartnerText($input['label'] ?? null, 120);
    return genesisPartnerMutate($actorId, 'assign', $input, static function (PDO $db) use ($actorId, $input, $target, $label): array {
        $current = genesisPartnerLookup($actorId, $target['email']);
        if ($current['id'] !== $target['id']) throw new GenesisResourceLimitException(409, 'PARTNER_TARGET_CHANGED');
        $q = $db->prepare('SELECT id FROM partners WHERE user_id=?'); $q->execute([$target['id']]);
        if ($q->fetch()) throw new GenesisResourceLimitException(409, 'PARTNER_ALREADY_ASSIGNED');
        $id = genesisUuid(); $code = 'p_' . rtrim(strtr(base64_encode(random_bytes(15)), '+/', '-_'), '=');
        $db->prepare('INSERT INTO partners(id,user_id,label,code,created_at) VALUES(?,?,?,?,?)')->execute([$id, $target['id'], $label, $code, genesisNow()]);
        genesisPartnerAudit($db, $actorId, 'partner-assigned', $id, $target['id'], 'Existing verified Google account selected by owner');
        return ['id' => $id];
    });
}

function genesisPartnerUpdate(string $actorId, string $partnerId, array $input): array
{
    genesisPartnerFields($input, ['expectedRevision', 'acceptsInvitations', 'panelEnabled', 'reason']);
    if (!is_bool($input['acceptsInvitations'] ?? null) || !is_bool($input['panelEnabled'] ?? null)) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
    $reason = genesisPartnerText($input['reason'] ?? null, 500);
    return genesisPartnerMutate($actorId, 'availability:' . $partnerId, $input, static function (PDO $db) use ($partnerId, $actorId, $input, $reason): array {
        $partner = genesisPartnerRow($db, $partnerId); genesisPartnerRevision($partner, $input['expectedRevision'] ?? null);
        if ($input['acceptsInvitations'] && (!$partner['user_id'] || !genesisPartnerPolicy($db)))
            throw new GenesisResourceLimitException(409, 'PARTNER_POLICY_CONFIRMATION_REQUIRED');
        $db->prepare('UPDATE partners SET accepts_invitations=?,panel_enabled=?,revision=revision+1 WHERE id=?')
            ->execute([(int)$input['acceptsInvitations'], (int)$input['panelEnabled'], $partnerId]);
        genesisPartnerAudit($db, $actorId, 'availability-changed', $partnerId, null, $reason);
        return ['revision' => (int)$partner['revision'] + 1];
    });
}

function genesisPartnerManualBind(string $actorId, string $partnerId, array $input): array
{
    genesisPartnerFields($input, ['userId', 'expectedClientId', 'reason', 'noHistoricalAccrual']);
    $reason = genesisPartnerText($input['reason'] ?? null, 500);
    if (($input['noHistoricalAccrual'] ?? null) !== true || !is_string($input['userId'] ?? null)
        || !(is_null($input['expectedClientId'] ?? null) || is_string($input['expectedClientId']))) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
    return genesisPartnerMutate($actorId, 'manual-client:' . $partnerId, $input, static function (PDO $db) use ($partnerId, $actorId, $input, $reason): array {
        $partner = genesisPartnerRow($db, $partnerId); $policy = genesisPartnerPolicy($db);
        $user = genesisFindUser($input['userId']);
        if (!$user || !$policy || !$partner['user_id']) throw new GenesisResourceLimitException(409, 'PARTNER_POLICY_CONFIRMATION_REQUIRED');
        if ($partner['user_id'] === $user['id'] || genesisIsAdminUser($user)) throw new GenesisResourceLimitException(409, 'PARTNER_SELF_REFERRAL');
        $q = $db->prepare('SELECT * FROM partner_clients WHERE user_id=? AND ended_at IS NULL'); $q->execute([$user['id']]); $old = $q->fetch();
        if (($old['id'] ?? null) !== ($input['expectedClientId'] ?? null)) throw new GenesisResourceLimitException(409, 'PARTNER_CLIENT_CONFLICT');
        if ($old && $old['partner_id'] === $partnerId) throw new GenesisResourceLimitException(409, 'PARTNER_CLIENT_CONFLICT');
        $now = genesisNow();
        if ($old) {
            $db->prepare('UPDATE partner_clients SET ended_at=? WHERE id=?')->execute([$now, $old['id']]);
            $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$old['partner_id']]);
            genesisPartnerAudit($db, $actorId, 'client-binding-ended', $old['partner_id'], $old['id'], $reason);
        }
        $id = genesisUuid();
        $db->prepare("INSERT INTO partner_clients(id,partner_id,user_id,policy_id,source,bound_at) VALUES(?,?,?,?,'owner-review',?)")
            ->execute([$id, $partnerId, $user['id'], $policy['id'], $now]);
        $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$partnerId]);
        genesisPartnerAudit($db, $actorId, 'client-manually-bound-forward-only', $partnerId, $id, $reason);
        return ['clientId' => $id, 'boundAt' => $now];
    });
}

function genesisPartnerRecordPayout(string $actorId, string $partnerId, array $input): array
{
    genesisPartnerFields($input, ['expectedRevision', 'amountMinor', 'paidOn', 'note', 'alreadyPaid']);
    $amount = genesisPartnerMoney($input['amountMinor'] ?? null);
    $date = $input['paidOn'] ?? null; $note = genesisPartnerText($input['note'] ?? '', 1000, false);
    if ($amount <= 0 || ($input['alreadyPaid'] ?? null) !== true || !genesisPartnerValidDate($date)
        || $date > (new DateTimeImmutable('now', new DateTimeZone(genesisConfig()['timezone'] ?? 'Europe/Moscow')))->format('Y-m-d'))
        throw new InvalidArgumentException('PARTNER_PAYOUT_INVALID');
    return genesisPartnerMutate($actorId, 'payout:' . $partnerId, $input, static function (PDO $db) use ($partnerId, $actorId, $input, $amount, $date, $note): array {
        $partner = genesisPartnerRow($db, $partnerId); genesisPartnerRevision($partner, $input['expectedRevision'] ?? null);
        $id = genesisUuid();
        $db->prepare('INSERT INTO partner_payouts(id,partner_id,paid_on,amount_minor,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?)')
            ->execute([$id, $partnerId, $date, $amount, $note, $actorId, genesisNow()]);
        $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$partnerId]);
        genesisPartnerAudit($db, $actorId, 'completed-external-payout-recorded', $partnerId, $id, $note);
        return ['id' => $id, 'revision' => (int)$partner['revision'] + 1];
    });
}

function genesisPartnerCorrectPayout(string $actorId, string $partnerId, string $payoutId, array $input): array
{
    genesisPartnerFields($input, ['expectedRevision', 'deltaMinor', 'reason']);
    $delta = genesisPartnerMoney($input['deltaMinor'] ?? null, true); $reason = genesisPartnerText($input['reason'] ?? null, 500);
    if ($delta === 0) throw new InvalidArgumentException('PARTNER_MONEY_INVALID');
    return genesisPartnerMutate($actorId, 'payout-correction:' . $payoutId, $input, static function (PDO $db) use ($partnerId, $payoutId, $actorId, $input, $delta, $reason): array {
        $partner = genesisPartnerRow($db, $partnerId); genesisPartnerRevision($partner, $input['expectedRevision'] ?? null);
        $q = $db->prepare('SELECT p.amount_minor+COALESCE(SUM(c.delta_minor),0) FROM partner_payouts p LEFT JOIN partner_payout_corrections c ON c.payout_id=p.id WHERE p.id=? AND p.partner_id=? GROUP BY p.id');
        $q->execute([$payoutId, $partnerId]); $current = $q->fetchColumn();
        if ($current === false) throw new GenesisResourceLimitException(404, 'PARTNER_PAYOUT_NOT_FOUND');
        if ((int)$current + $delta < 0) throw new InvalidArgumentException('PARTNER_MONEY_INVALID');
        $id = genesisUuid();
        $db->prepare('INSERT INTO partner_payout_corrections(id,payout_id,delta_minor,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)')
            ->execute([$id, $payoutId, $delta, $reason, $actorId, genesisNow()]);
        $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$partnerId]);
        genesisPartnerAudit($db, $actorId, 'payout-corrected', $partnerId, $payoutId, $reason);
        return ['id' => $id, 'revision' => (int)$partner['revision'] + 1];
    });
}

require_once __DIR__ . '/partner-referrals.php';
require_once __DIR__ . '/partner-billing.php';
require_once __DIR__ . '/partner-reports.php';
