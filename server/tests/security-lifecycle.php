<?php
declare(strict_types=1);
// Included by the isolated shared-projects suite. No provider requests or real data.
$securityUsers = [];
$savedSecuritySession = $_SESSION;
$db = genesisDb();
$addSecurityUser = static function (string $name) use (&$securityUsers, $db): array {
    $id = genesisUuid();
    $db->prepare('INSERT INTO users (id, google_sub, email, display_name, shared_projects_enabled, created_at, updated_at)
        VALUES (:id, :sub, :email, :name, 1, :now, :now)')->execute([
            'id' => $id, 'sub' => 'synthetic-' . $id, 'email' => $id . '@example.test',
            'name' => $name, 'now' => genesisNow()]);
    genesisTestGrantCollaboration($id);
    $securityUsers[] = $id;
    return genesisFindUser($id);
};
try {
    $owner = $addSecurityUser('Synthetic owner');
    $manager = $addSecurityUser('Synthetic manager');
    $reader = $addSecurityUser('Synthetic reader');
    $recipient = $addSecurityUser('Synthetic recipient');
    $secondarySub = 'synthetic-linked-' . genesisUuid();
    $insertLink = static function () use ($db, $owner, $secondarySub): string {
        $id = genesisUuid();
        $db->prepare('INSERT INTO linked_google_accounts (id, owner_user_id, google_sub, email, display_name, created_at, updated_at)
            VALUES (:id, :owner, :sub, :email, :name, :now, :now)')->execute([
                'id' => $id, 'owner' => $owner['id'], 'sub' => $secondarySub,
                'email' => 'linked@example.test', 'name' => 'Synthetic linked identity', 'now' => genesisNow()]);
        return $id;
    };
    $linkId = $insertLink();
    genesisEstablishGoogleSession($owner, $secondarySub);
    $linkedSession = $_SESSION;
    sharedExpect(genesisCurrentUserId() === $owner['id'], 'A valid linked login was lost.');
    sharedExpect(!genesisSessionIsPrimaryGoogleUser($owner), 'Linked login inherited primary privileges.');
    genesisRemoveLinkedGoogleAccount($owner['id'], $linkId); // No tokens: never calls the provider.
    sharedExpect(genesisCurrentUserId() === null, 'Unlinked identity retained its session.');
    $insertLink();
    $_SESSION = $linkedSession;
    sharedExpect(genesisCurrentUserId() === null, 'Relinking revived an old identity session.');
    genesisEstablishGoogleSession($owner, $owner['google_sub']);
    sharedExpect(genesisSessionIsPrimaryGoogleUser($owner), 'Primary session was denied.');
    $_SESSION = ['user_id' => $owner['id'], 'csrf' => 'synthetic'];
    sharedExpect(genesisCurrentUserId() === null, 'Legacy cookie was assigned primary authority.');
    $admin = $addSecurityUser('Synthetic admin');
    $admin['email'] = genesisAdminEmail();
    $db->prepare('UPDATE users SET email = :email WHERE id = :id')->execute(['email' => $admin['email'], 'id' => $admin['id']]);
    genesisEstablishGoogleSession($admin, $admin['google_sub']);
    sharedExpect(genesisUserForClient($admin)['isAdmin'], 'Primary admin lost administrative capability.');
    $db->prepare('UPDATE linked_google_accounts SET owner_user_id = :admin WHERE owner_user_id = :owner')
        ->execute(['admin' => $admin['id'], 'owner' => $owner['id']]);
    genesisEstablishGoogleSession($admin, $secondarySub);
    sharedExpect(genesisUserForClient($admin)['isAdmin'], 'A verified linked login lost its canonical account privileges.');
    sharedExpect(genesisUserForClient($admin)['uid'] === $admin['id'], 'A linked login created a different account.');
    sharedExpect(genesisSessionOwnsGoogleAccount($admin), 'A verified linked login lost its account.');
    sharedExpect(!genesisSessionOwnsGoogleAccount($owner), 'A linked login gained another account.');
    require __DIR__ . '/security-auth-http.php';
    securityHttpLifecycle($admin, $secondarySub);

    $space = genesisSharedCreateSpace($owner['id'], ['title' => 'Synthetic lifecycle space']);
    $source = genesisSharedCreateProject($owner['id'], $space['id'], ['title' => 'Visible source']);
    $private = genesisSharedCreateProject($owner['id'], $space['id'], ['title' => 'Private destination']);
    foreach ([$manager, $reader] as $user) {
        $db->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at) VALUES (:space, :user, 'guest', :now)")
            ->execute(['space' => $space['id'], 'user' => $user['id'], 'now' => genesisNow()]);
        $db->prepare('INSERT INTO shared_project_members (project_id, user_id, role, joined_at) VALUES (:project, :user, :role, :now)')
            ->execute(['project' => $source['id'], 'user' => $user['id'],
                'role' => $user['id'] === $manager['id'] ? 'manager' : 'viewer', 'now' => genesisNow()]);
    }
    $invite = genesisSharedInvite($manager['id'], $source['id'], ['email' => $recipient['email'], 'role' => 'manager']);
    genesisSharedRemoveMember($owner['id'], $source['id'], $manager['id']);
    sharedReject(static fn() => genesisSharedAcceptInvite($recipient['id'], ['id' => $invite['id']]), 404);
    // A pre-fix pending invite must also fail even when revoked_at was never set.
    $db->prepare('UPDATE shared_invitations SET revoked_at = NULL WHERE id = :id')->execute(['id' => $invite['id']]);
    sharedReject(static fn() => genesisSharedAcceptInvite($recipient['id'], ['id' => $invite['id']]), 404);
    $valid = genesisSharedInvite($owner['id'], $source['id'], ['email' => $recipient['email'], 'role' => 'manager']);
    genesisSharedAcceptInvite($recipient['id'], ['id' => $valid['id']]);
    $demoted = genesisSharedInvite($recipient['id'], $source['id'], ['email' => $manager['email'], 'role' => 'member']);
    genesisSharedSetMemberRole($owner['id'], $source['id'], $recipient['id'], ['role' => 'viewer']);
    sharedReject(static fn() => genesisSharedAcceptInvite($manager['id'], ['id' => $demoted['id']]), 404);
    $db->prepare('UPDATE shared_invitations SET revoked_at = NULL WHERE id = :id')->execute(['id' => $demoted['id']]);
    sharedReject(static fn() => genesisSharedAcceptInvite($manager['id'], ['id' => $demoted['id']]), 403);

    $sourceStatus = genesisSharedProjectSnapshot($owner['id'], $source['id'])['statuses'][0]['id'];
    $privateStatus = genesisSharedProjectSnapshot($owner['id'], $private['id'])['statuses'][0]['id'];
    $task = genesisSharedTask($owner['id'], $source['id'], ['title' => 'Previously visible title', 'statusId' => $sourceStatus]);
    $move = genesisSharedMoveTask($owner['id'], $source['id'], $task['id'], [
        'destinationProjectId' => $private['id'], 'statusId' => $privateStatus, 'expectedRevision' => 1, 'position' => 0]);
    genesisSharedTask($owner['id'], $private['id'], ['title' => 'PRIVATE_NEW_SYNTHETIC_TITLE',
        'statusId' => $privateStatus, 'expectedRevision' => $move['revision']], $task['id']);
    sharedReject(static fn() => genesisSharedProjectSnapshot($reader['id'], $private['id']), 404);
    $notifications = genesisSharedNotifications($reader['id']);
    sharedExpect(count($notifications) > 0, 'Historical notifications disappeared.');
    sharedExpect(!array_filter($notifications, static fn($event) => $event['taskTitle'] === 'PRIVATE_NEW_SYNTHETIC_TITLE'),
        'Source notification disclosed a private destination title.');
    sharedExpect((bool)array_filter($notifications, static fn($event) => $event['taskTitle'] === 'Previously visible title'),
        'Allowed historical title was not preserved.');
    foreach ([genesisSharedInbox($reader['id']), genesisSharedActivity($reader['id'], $source['id'], null, null),
        genesisSharedProjectSnapshot($reader['id'], $source['id'])] as $visible) {
        sharedExpect(!str_contains(json_encode($visible, JSON_THROW_ON_ERROR), 'PRIVATE_NEW_SYNTHETIC_TITLE'),
            'Related source feed or project payload disclosed a private destination title.');
    }
    sharedReject(static fn() => genesisSharedActivity($reader['id'], $private['id'], null, null), 404);
    require __DIR__ . '/resource-limits.php';
} finally {
    $_SESSION = $savedSecuritySession;
    foreach ($securityUsers as $id) if (genesisFindUser($id)) genesisDeleteAccount($id);
}
echo "Authentication and collaboration lifecycle regressions passed.\n";
