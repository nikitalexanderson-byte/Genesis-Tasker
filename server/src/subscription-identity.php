<?php
declare(strict_types=1);

/** The canonical workspace owner pays once; linked Google accounts use that entitlement. */
function genesisSubscriptionIdentityHashes(array $user): array
{
    $keys = [];
    $subject = trim((string)($user['google_sub'] ?? ''));
    $email = strtolower(trim((string)($user['email'] ?? '')));
    if (preg_match('/\A([^@]+)@(gmail\.com|googlemail\.com)\z/D', $email, $parts)) {
        $email = str_replace('.', '', explode('+', $parts[1], 2)[0]) . '@gmail.com';
    }
    if ($subject !== '') $keys[] = genesisIdentifierHash('subscription-google', $subject);
    if ($email !== '') $keys[] = genesisIdentifierHash('subscription-email', $email);
    return $keys ?: [genesisIdentifierHash('subscription-account', (string)$user['id'])];
}

function genesisSubscriptionRevokedAt(PDO $db, array $user): ?string
{
    $keys = genesisSubscriptionIdentityHashes($user);
    $query = $db->prepare('SELECT MAX(revoked_at) FROM subscription_revocations WHERE identity_hash IN (' . implode(',', array_fill(0, count($keys), '?')) . ')');
    $query->execute($keys);
    return $query->fetchColumn() ?: null;
}

/** Called in the same transaction as reset/delete, before cascading account rows away. */
function genesisSubscriptionRevoke(PDO $db, array $user, string $stamp): void
{
    $owns=!$db->inTransaction();if($owns)$db->beginTransaction();
    try {
        $stamp=(new DateTimeImmutable($stamp))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        require_once __DIR__.'/subscription-trials.php';
        genesisTrialRevoke($db,$user,(int)strtotime($stamp));
        $identities = [$user];
        if (function_exists('genesisLinkedGoogleAccounts')) $identities = [...$identities, ...genesisLinkedGoogleAccounts((string)$user['id'])];
        $keys = [];
        foreach ($identities as $identity) $keys = [...$keys, ...genesisSubscriptionIdentityHashes($identity)];
        foreach (array_unique($keys) as $identity) {
            $db->prepare('INSERT INTO subscription_revocations(identity_hash,revoked_at) VALUES(?,?)
                ON CONFLICT(identity_hash) DO UPDATE SET revoked_at=excluded.revoked_at,revision=revision+1')->execute([$identity,$stamp]);
            // A purchased seat never returns to the pool: the offer admits twelve new people in total.
            $db->prepare('UPDATE billing_lifetime_seats SET revoked_at=? WHERE owner_hash=? AND purchased_at IS NOT NULL')->execute([$stamp,$identity]);
        }
        $db->prepare('INSERT INTO subscription_access_state(user_id,revision,receipts_after,automatic_grants_blocked) VALUES(?,1,?,1)
            ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,receipts_after=excluded.receipts_after,automatic_grants_blocked=1')->execute([$user['id'],$stamp]);
        $db->prepare("UPDATE users SET subscription_plan='free',subscription_valid_until=NULL,forecast_elite_plus=0,forecast_privilege_revision=forecast_privilege_revision+CASE WHEN forecast_elite_plus=1 THEN 1 ELSE 0 END WHERE id=?")->execute([$user['id']]);
        if($owns)$db->commit();
    } catch(Throwable $error) {if($owns&&$db->inTransaction())$db->rollBack();throw $error;}
}

function genesisSubscriptionState(PDO $db, array $user): array
{
    $query = $db->prepare('SELECT * FROM subscription_access_state WHERE user_id=?'); $query->execute([$user['id']]);
    $row = $query->fetch();
    return $row ?: ['revision'=>0,'materialized_billing'=>0,'receipts_after'=>genesisSubscriptionRevokedAt($db,$user),
        'automatic_grants_blocked'=>genesisSubscriptionRevokedAt($db,$user) !== null ? 1 : 0];
}
