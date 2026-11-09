<?php
declare(strict_types=1);

function genesisStoicheionWorkspace(string $userId): ?array
{
    $q = genesisDb()->prepare('SELECT revision,iv,ciphertext,updated_at FROM stoicheion_workspaces WHERE user_id=?');
    $q->execute([$userId]); $row = $q->fetch();
    return $row ? ['revision'=>(int)$row['revision'],'iv'=>$row['iv'],'ciphertext'=>$row['ciphertext'],'updatedAt'=>$row['updated_at']] : null;
}

/** One owner-scoped CAS document; the server never receives reflections or practices in plaintext. */
function genesisSaveStoicheionWorkspace(string $userId, array $input): array
{
    $revision = $input['expectedRevision'] ?? null; $iv = $input['iv'] ?? null; $ciphertext = $input['ciphertext'] ?? null;
    if (array_diff(array_keys($input), ['expectedRevision','iv','ciphertext']) || !is_int($revision) || $revision < 0
        || !is_string($iv) || strlen($iv)!==16 || strlen((string)base64_decode($iv,true))!==12
        || !is_string($ciphertext) || strlen($ciphertext)<24 || strlen($ciphertext)>4_000_000 || base64_decode($ciphertext,true)===false)
        throw new InvalidArgumentException('Invalid restoration envelope.');
    $hash = hash('sha256', $revision.':'.$iv.':'.$ciphertext);
    $db = genesisDb(); $owns = !$db->inTransaction(); if ($owns) genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT revision,payload_hash,updated_at FROM stoicheion_workspaces WHERE user_id=?'); $q->execute([$userId]); $old=$q->fetch();
        // An identical retry after a lost acknowledgement does not create another revision.
        if ($old && hash_equals($old['payload_hash'],$hash)) { if ($owns) $db->commit(); return ['revision'=>(int)$old['revision'],'updatedAt'=>$old['updated_at']]; }
        if ((int)($old['revision'] ?? 0)!==$revision) throw new GenesisResourceLimitException(409,'RESTORATION_REVISION_CONFLICT');
        $now=genesisNow(); $next=$revision+1;
        $db->prepare('INSERT INTO stoicheion_workspaces VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,iv=excluded.iv,ciphertext=excluded.ciphertext,payload_hash=excluded.payload_hash,updated_at=excluded.updated_at')
            ->execute([$userId,$next,$iv,$ciphertext,$hash,$now]);
        if ($owns) $db->commit(); return ['revision'=>$next,'updatedAt'=>$now];
    } catch (Throwable $error) { if ($owns && $db->inTransaction()) $db->rollBack(); throw $error; }
}
