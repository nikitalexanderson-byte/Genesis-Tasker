<?php
declare(strict_types=1);

function genesisPartnerInviteHash(mixed $token): ?string
{
    return is_string($token) && preg_match('/\A[a-zA-Z0-9_-]{43}\z/D', $token) === 1 ? hash('sha256', $token) : null;
}

function genesisPartnerInvite(PDO $db, ?string $hash, ?int $now = null): ?array
{
    if (!$hash) return null;
    $q = $db->prepare('SELECT i.*,p.code,p.label,p.user_id,p.accepts_invitations FROM partner_invites i JOIN partners p ON p.id=i.partner_id
        WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.expires_at>?');
    $q->execute([$hash, gmdate('Y-m-d\TH:i:s\Z', $now ?? time())]);
    return $q->fetch() ?: null;
}

/** Anonymous random invitation tokens only: no IP, email, device fingerprint or cross-device identity. */
function genesisPartnerCapture(PDO $db, string $code, ?string $existingToken, ?int $now = null): array
{
    genesisPartnersRequireEnabled(); $now ??= time();
    if (function_exists('genesisCurrentUserId') && genesisCurrentUserId() !== null)
        throw new GenesisResourceLimitException(409, 'PARTNER_NEW_ACCOUNT_ONLY');
    if (preg_match('/\Ap_[a-zA-Z0-9_-]{20}\z/D', $code) !== 1) throw new InvalidArgumentException('PARTNER_CODE_INVALID');
    genesisPartnerWrite($db);
    try {
        $db->prepare('DELETE FROM partner_invites WHERE expires_at<=?')->execute([gmdate('Y-m-d\TH:i:s\Z', $now)]);
        if ($old = genesisPartnerInvite($db, genesisPartnerInviteHash($existingToken), $now)) {
            $db->commit(); return ['token' => $existingToken, 'expiresAt' => $old['expires_at'], 'label' => $old['label'], 'preserved' => true];
        }
        $policy = genesisPartnerPolicy($db);
        $q = $db->prepare('SELECT * FROM partners WHERE code=? AND accepts_invitations=1 AND user_id IS NOT NULL'); $q->execute([$code]); $partner = $q->fetch();
        if (!$policy || !$partner) throw new GenesisResourceLimitException(404, 'PARTNER_CODE_UNAVAILABLE');
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $stamp = gmdate('Y-m-d\TH:i:s\Z', $now); $until = gmdate('Y-m-d\TH:i:s\Z', $now + (int)$policy['invitation_days'] * 86400);
        $db->prepare('INSERT INTO partner_invites(token_hash,partner_id,policy_id,created_at,expires_at) VALUES(?,?,?,?,?)')
            ->execute([hash('sha256', $token), $partner['id'], $policy['id'], $stamp, $until]);
        $db->prepare('INSERT INTO partner_visit_days(partner_id,day,visits) VALUES(?,?,1) ON CONFLICT(partner_id,day) DO UPDATE SET visits=visits+1')
            ->execute([$partner['id'], gmdate('Y-m-d', $now)]);
        $db->commit(); return ['token' => $token, 'expiresAt' => $until, 'label' => $partner['label'], 'preserved' => false];
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}

function genesisPartnerSetInviteCookie(?string $token, ?string $expiresAt = null): void
{
    setcookie('genesis_referral', $token ?? '', ['expires' => $token === null ? 1 : (int)strtotime((string)$expiresAt),
        'path' => '/', 'secure' => (genesisConfig()['cookie_secure'] ?? true) === true, 'httponly' => true, 'samesite' => 'Lax']);
    if ($token === null) unset($_COOKIE['genesis_referral']); else $_COOKIE['genesis_referral'] = $token;
}

function genesisPartnerOAuthInvitation(string $purpose): ?string
{
    if (!genesisPartnersEnabled() || $purpose !== 'login' || genesisCurrentUserId() !== null) return null;
    $hash = genesisPartnerInviteHash($_COOKIE['genesis_referral'] ?? null);
    return genesisPartnerInvite(genesisDb(), $hash) ? $hash : null;
}

/** Called only from the new-account INSERT transaction, never from an existing/linked account login. */
function genesisPartnerBindRegistration(PDO $db, string $userId, ?string $hash, ?int $now = null): void
{
    if (!genesisPartnersEnabled() || !$hash) return;
    if (!$db->inTransaction()) throw new LogicException('PARTNER_REGISTRATION_TRANSACTION_REQUIRED');
    $now ??= time(); $stamp = gmdate('Y-m-d\TH:i:s\Z', $now);
    $invite = genesisPartnerInvite($db, $hash, $now);
    if (!$invite || !$invite['user_id'] || !(bool)$invite['accepts_invitations']) return;
    $consume = $db->prepare('UPDATE partner_invites SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL'); $consume->execute([$stamp, $hash]);
    if (!$consume->rowCount() || $invite['user_id'] === $userId) return;
    $q = $db->prepare('SELECT id FROM partner_clients WHERE user_id=? AND ended_at IS NULL'); $q->execute([$userId]);
    if ($q->fetch()) return;
    $id = genesisUuid();
    $db->prepare("INSERT INTO partner_clients(id,partner_id,user_id,policy_id,source,bound_at) VALUES(?,?,?,?,'google-registration',?)")
        ->execute([$id, $invite['partner_id'], $userId, $invite['policy_id'], $stamp]);
    $db->prepare('UPDATE partners SET revision=revision+1 WHERE id=?')->execute([$invite['partner_id']]);
}

/** A completed login attempt consumes its invitation even if it authenticated an existing account. */
function genesisPartnerFinishOAuth(?string $hash): void
{
    if (genesisPartnersEnabled() && $hash) {
        genesisDb()->prepare('UPDATE partner_invites SET consumed_at=COALESCE(consumed_at,?) WHERE token_hash=?')->execute([genesisNow(), $hash]);
    }
    if (isset($_COOKIE['genesis_referral'])) genesisPartnerSetInviteCookie(null);
}
