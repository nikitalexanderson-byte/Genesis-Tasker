<?php
declare(strict_types=1);

function genesisSharedSpaceParticipants(string $userId, string $spaceId, ?bool $active = null, string $clientId = 'legacy'): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $db = genesisDb();
    if ($active !== null) {
        if ($clientId !== 'legacy' && !preg_match('/\A[a-f0-9-]{36}\z/',$clientId)) throw new InvalidArgumentException('INVALID_PRESENCE');
        $db->prepare('DELETE FROM shared_space_presence WHERE space_id=? AND user_id=? AND last_seen_at<?')->execute([$spaceId,$userId,time()-90]);
        if ($active) $db->prepare('INSERT INTO shared_space_presence(space_id,user_id,client_id,last_seen_at) VALUES(?,?,?,?)
            ON CONFLICT(space_id,user_id,client_id) DO UPDATE SET last_seen_at=excluded.last_seen_at')->execute([$spaceId,$userId,$clientId,time()]);
        else $db->prepare('DELETE FROM shared_space_presence WHERE space_id=? AND user_id=? AND client_id=?')->execute([$spaceId,$userId,$clientId]);
    }
    $q = $db->prepare('SELECT m.user_id AS userId, m.role, COALESCE(NULLIF(u.display_name,\'\'),\'GENESIS\') AS displayName,
        CASE WHEN p.last_seen_at >= CAST(:cutoff AS INTEGER) THEN 1 ELSE 0 END AS viewing,
        k.key_id AS keyId, k.public_key_json AS publicKeyJson
        FROM shared_space_members m JOIN users u ON u.id=m.user_id
        LEFT JOIN (SELECT space_id,user_id,MAX(last_seen_at) AS last_seen_at FROM shared_space_presence
            WHERE space_id=:space AND last_seen_at>=CAST(:cutoff AS INTEGER) GROUP BY space_id,user_id) p ON p.space_id=m.space_id AND p.user_id=m.user_id
        LEFT JOIN shared_messaging_keys k ON k.user_id=m.user_id
        WHERE m.space_id=:space ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END, u.display_name, m.user_id');
    $q->execute(['space'=>$spaceId,'cutoff'=>time()-90]);
    $members = array_map(static function(array $row): array {
        $row['viewing'] = (bool)$row['viewing'];
        $row['publicKey'] = $row['publicKeyJson'] ? json_decode($row['publicKeyJson'],true) : null;
        unset($row['publicKeyJson']); return $row;
    },$q->fetchAll());
    return ['members'=>$members];
}
