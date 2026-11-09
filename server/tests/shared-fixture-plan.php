<?php
declare(strict_types=1);

/** Ordinary Business fixture for collaboration behavior suites, never an admin bypass.
 * These suites predate package enforcement; Free authorization has separate API tests.
 */
function genesisTestGrantCollaboration(string $userId): void
{
    if (PHP_SAPI !== 'cli' || (getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated' && !getenv('GENESIS_SMOKE_ROOT'))
        || !in_array(parse_url(genesisConfig()['app_url'], PHP_URL_HOST), ['127.0.0.1', 'localhost.invalid'], true)) {
        throw new RuntimeException('Synthetic collaboration fixture required');
    }
    $user = genesisFindUser($userId);
    if (!$user) throw new RuntimeException('Fixture user missing');
    if (($user['subscription_plan'] ?? 'free') === 'free') {
        genesisDb()->prepare("UPDATE users SET subscription_plan='business',subscription_valid_until='2035-01-01T00:00:00Z' WHERE id=?")
            ->execute([$userId]);
    }
}

function genesisTestEnableSharedProjects(string $userId): array
{
    genesisTestGrantCollaboration($userId);
    return genesisUpdateAccountPreferences($userId, ['sharedProjectsEnabled' => true]);
}
