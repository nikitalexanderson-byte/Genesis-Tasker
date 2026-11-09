<?php
declare(strict_types=1);
require_once __DIR__.'/forecast-privileges.php';

/** Server-owned policy; enabling package limits requires the user's approved matrix. */
function genesisFeatureAccessPolicy(): array
{
    static $policy;
    return $policy ??= json_decode((string)file_get_contents(dirname(__DIR__) . '/resources/feature-access-policy.json'), true, 32, JSON_THROW_ON_ERROR);
}

/** Strict seconds-precision ISO timestamp. Never normalize an invalid date into paid time. */
function genesisSubscriptionExpiry(mixed $value): int|false
{
    if (!is_string($value) || preg_match('/\A(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-](\d{2}):(\d{2}))\z/D', $value, $parts) !== 1) return false;
    if (!checkdate((int)$parts[2], (int)$parts[3], (int)$parts[1])
        || (int)$parts[4] > 23 || (int)$parts[5] > 59 || (int)$parts[6] > 59) return false;
    // Match java.time's maximum zone offset. At eighteen hours no minutes remain.
    if (isset($parts[8]) && ((int)$parts[8] > 18 || (int)$parts[9] > 59
        || ((int)$parts[8] === 18 && (int)$parts[9] !== 0))) return false;
    return strtotime($value);
}

/** Pure resolver: callers must pass a database user, never request/profile/import fields. */
function genesisResolveFeatureAccess(array $user, array $policy, int $now): array
{
    $plans = ['free', 'standart', 'premium', 'business', 'premium4life'];
    $candidate = ($user['subscription_plan'] ?? null) === 'standard' ? 'standart' : ($user['subscription_plan'] ?? null);
    $declared = in_array($candidate, $plans, true) ? $candidate : 'free';
    $lifetime = $declared === 'premium4life';
    $expiry = genesisSubscriptionExpiry($user['subscription_valid_until'] ?? null);
    // Legacy administrative plan labels alone are not verified payment evidence.
    $effective = $lifetime ? 'business' : ($declared !== 'free' && $expiry !== false && $expiry > $now ? $declared : 'free');
    $enabled = ($policy['enforcementEnabled'] ?? false) === true;
    $features = $policy['features'] ?? [];
    $disabled = $policy['disabledFeatures'] ?? [];
    $allowed = [];
    foreach ($features as $feature => $availablePlans) {
        if (!in_array($feature, $disabled, true) && (!$enabled || $lifetime || in_array($effective, $availablePlans, true))) $allowed[] = $feature;
    }
    $freeFeatures=array_keys(array_filter($features,static fn(array $values):bool=>in_array('free',$values,true)));
    if(genesisForecastFreeAccess($user)&&!in_array('future-modeling',$disabled,true)){
        $allowed=array_values(array_unique([...$allowed,'future-modeling']));
        $freeFeatures=array_values(array_unique([...$freeFeatures,'future-modeling']));
    }
    return [
        'schemaVersion' => 1,
        'policyRevision' => (string)$policy['revision'],
        'enforcementEnabled' => $enabled,
        'declaredPlan' => $declared,
        'effectivePlan' => $effective,
        'lifetimePremium' => $lifetime,
        'validUntil' => !$lifetime && $expiry !== false ? gmdate('Y-m-d\TH:i:s\Z', $expiry) : null,
        'evaluatedAt' => gmdate('Y-m-d\TH:i:s\Z', $now),
        'allowedFeatures' => $allowed,
        'disabledFeatures' => $disabled,
        'limits' => $policy['limits'][$effective] ?? [],
        'freeLimits' => $policy['limits']['free'] ?? [],
        'adviceDailyLimit' => $policy['adviceDailyLimit'][$effective] ?? null,
        'freeAdviceDailyLimit' => $policy['adviceDailyLimit']['free'] ?? null,
        // Clients can re-evaluate expiry while open without trusting a local plan selector.
        'freeFeatures' => $freeFeatures,
    ];
}

function genesisFeatureAccessForUser(array $user): array
{
    require_once __DIR__.'/subscription-trials.php';
    return genesisTrialSnapshotForUser($user,time())['featureAccess'];
}

/** Future API mutations use this in addition to their existing owner/role/CSRF checks. */
function genesisRequireFeature(string $userId, string $feature): void
{
    $user = genesisFindUser($userId);
    if ($user === null) genesisJson(['error' => 'UNAUTHORIZED'], 401);
    $access = genesisFeatureAccessForUser($user);
    if (in_array($feature, $access['disabledFeatures'], true) || ($access['enforcementEnabled'] && !in_array($feature, $access['allowedFeatures'], true))) {
        genesisJson(['error' => 'FEATURE_SUBSCRIPTION_REQUIRED', 'feature' => $feature], 403);
    }
}

function genesisFeatureLimit(string $userId, string $resource): ?int
{
    $user = genesisFindUser($userId);
    if (!$user) throw new DomainException('AUTH_REQUIRED');
    $access = genesisFeatureAccessForUser($user);
    return $access['enforcementEnabled'] ? ($access['limits'][$resource] ?? null) : null;
}

/** Only new resources consume a slot; edits and retries of existing resources remain possible. */
function genesisRequireFeatureQuota(string $userId, string $resource, int $count): void
{
    $limit = genesisFeatureLimit($userId,$resource);
    if ($limit !== null && $count >= $limit) throw new GenesisResourceLimitException(403,'SUBSCRIPTION_QUOTA_'.$resource);
}

/** Shared capacity belongs to the workspace owner, across all of their spaces.
 * Only root projects consume project slots. Archived/trash rows retain their slots until
 * physical deletion; restoring them is zero growth. Call mutation checks under the writer lock.
 */
function genesisSharedUserResourceUsage(string $owner, string $resource): array
{
    $db=genesisDb();
    $sql=match($resource) {
        'shared-projects' => 'SELECT COUNT(*) FROM shared_projects r JOIN resource_space_owners o ON o.space_id=r.space_id WHERE o.user_id=? AND r.parent_id IS NULL AND r.is_inbox=0 AND r.kind=\'project\'',
        'shared-mindmaps' => 'SELECT COUNT(*) FROM shared_mindmaps r JOIN resource_space_owners o ON o.space_id=r.space_id WHERE o.user_id=?',
        default => throw new InvalidArgumentException('INVALID_SHARED_QUOTA_RESOURCE'),
    };
    $q=$db->prepare($sql);$q->execute([$owner]);
    $count=(int)$q->fetchColumn();$user=genesisFindUser($owner);
    if (!$user) throw new DomainException('AUTH_REQUIRED');
    $access=genesisFeatureAccessForUser($user);
    $limit=$access['enforcementEnabled']
        ? (in_array('shared-projects',$access['allowedFeatures'],true) ? ($access['limits'][$resource]??null) : 0)
        : null;
    return ['owner'=>$owner,'count'=>$count,'limit'=>$limit];
}

function genesisSharedOwnerResourceUsage(string $spaceId, string $resource): array
{
    $q=genesisDb()->prepare('SELECT user_id FROM resource_space_owners WHERE space_id=?');$q->execute([$spaceId]);
    $owner=$q->fetchColumn();
    if (!is_string($owner) || $owner==='') throw new DomainException('SHARED_SPACE_OWNER_REQUIRED');
    return genesisSharedUserResourceUsage($owner,$resource);
}

/** Public counts describe the owner's complete pool, never the viewing member's creations. */
function genesisSharedProjectQuota(array $usage): array
{
    return ['count'=>$usage['count'],'limit'=>$usage['limit'],
        'remaining'=>$usage['limit']===null?null:max(0,$usage['limit']-$usage['count']),'ownerId'=>$usage['owner']];
}

function genesisRequireSharedUserQuota(string $owner, string $resource, int $growth=1): void
{
    if ($growth<0) throw new InvalidArgumentException('INVALID_QUOTA_GROWTH');
    if ($growth===0) return;
    $usage=genesisSharedUserResourceUsage($owner,$resource);
    if ($usage['limit']!==null && $usage['count']+$growth>$usage['limit'])
        throw new GenesisResourceLimitException(403,'SUBSCRIPTION_QUOTA_'.$resource);
}

function genesisRequireSharedOwnerQuota(string $spaceId, string $resource, int $growth=1): void
{
    if ($growth<0) throw new InvalidArgumentException('INVALID_QUOTA_GROWTH');
    if ($growth===0) return;
    $usage=genesisSharedOwnerResourceUsage($spaceId,$resource);
    if ($usage['limit']!==null && $usage['count']+$growth>$usage['limit'])
        throw new GenesisResourceLimitException(403,'SUBSCRIPTION_QUOTA_'.$resource);
}

/** Client-reported opaque IDs are committed atomically with the encrypted document/CAS.
 * The server cannot cryptographically prove the contents of end-to-end ciphertext.
 * Official clients derive this census from the exact document they encrypt, including offline merges.
 */
function genesisWorkspaceResourceCensus(string $userId, array $payload, int $version, bool $existingEnvelope): void
{
    $db=genesisDb();$user=genesisFindUser($userId);
    $input=$payload['quotaUsage']??null;
    if ($input===null) {
        // Preserve older installations belonging to the existing lifetime cohort.
        if (($user['subscription_plan']??'free')==='premium4life') return;
        throw new GenesisResourceLimitException(426,'WORKSPACE_UPGRADE_REQUIRED');
    }
    if (!is_array($input) || array_diff(array_keys($input),['personal-projects','habits'])) throw new InvalidArgumentException('INVALID_RESOURCE_CENSUS');
    foreach(['personal-projects','habits'] as $resource) {
        $ids=$input[$resource]??null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids)>100000
            || count(array_unique($ids,SORT_REGULAR))!==count($ids)
            || array_filter($ids,static fn($id)=>!is_string($id)||$id===''||strlen($id)>500||preg_match('/[\x00-\x1f]/',$id))) throw new InvalidArgumentException('INVALID_RESOURCE_CENSUS');
    }
    $q=$db->prepare('SELECT * FROM workspace_resource_census WHERE user_id=?');$q->execute([$userId]);$old=$q->fetch();
    foreach(['personal-projects'=>'projects_json','habits'=>'habits_json'] as $resource=>$column) {
        $before=$old ? count(json_decode($old[$column],true,16,JSON_THROW_ON_ERROR)) : 0;
        $after=count($input[$resource]);$limit=genesisFeatureLimit($userId,$resource);
        // The first census of a pre-existing encrypted account preserves all existing data.
        if (!(!$old && $existingEnvelope) && $after>$before && $limit!==null && $after>$limit)
            throw new GenesisResourceLimitException(403,'SUBSCRIPTION_QUOTA_'.$resource);
    }
    $db->prepare('INSERT INTO workspace_resource_census VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET projects_json=excluded.projects_json,habits_json=excluded.habits_json,workspace_version=excluded.workspace_version')
        ->execute([$userId,json_encode($input['personal-projects'],JSON_THROW_ON_ERROR),json_encode($input['habits'],JSON_THROW_ON_ERROR),$version]);
}
