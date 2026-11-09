<?php
declare(strict_types=1);

function genesisSharedCoverInput(array $input, ?array $existing = null): array
{
    $image = $existing['cover_image'] ?? '';
    if (array_key_exists('coverImage', $input)) {
        $image = $input['coverImage'];
        if (!is_string($image) || strlen($image) > 4194327) throw new InvalidArgumentException('COVER_IMAGE_TOO_LARGE');
        if ($image !== '') {
            if (!preg_match('/\Adata:image\/(jpeg|png);base64,([a-zA-Z0-9+\/=]+)\z/', $image, $match)) throw new InvalidArgumentException('INVALID_COVER_IMAGE');
            $bytes = base64_decode($match[2], true);
            if ($bytes === false || strlen($bytes) > 3 * 1024 * 1024) throw new InvalidArgumentException('COVER_IMAGE_TOO_LARGE');
            $info = @getimagesizefromstring($bytes);
            if (!$info || ($info['mime'] ?? '') !== 'image/' . $match[1] || $info[0] * $info[1] > 40000000) throw new InvalidArgumentException('INVALID_COVER_IMAGE');
        }
    }
    $position = $input['coverPosition'] ?? ['x' => $existing['cover_x'] ?? 50, 'y' => $existing['cover_y'] ?? 50];
    if (!is_array($position)) throw new InvalidArgumentException('INVALID_COVER_POSITION');
    foreach (['x', 'y'] as $axis) if (!isset($position[$axis]) || !is_numeric($position[$axis]) || !is_finite((float)$position[$axis]) || $position[$axis] < 0 || $position[$axis] > 100) throw new InvalidArgumentException('INVALID_COVER_POSITION');
    return ['image' => $image, 'x' => (float)$position['x'], 'y' => (float)$position['y']];
}

function genesisSharedCoverInfo(array $space): array
{
    $hasCover = isset($space['hasCover']) ? (bool)$space['hasCover'] : ($space['cover_image'] ?? '') !== '';
    return ['coverUrl' => $hasCover ? '/api/shared/spaces/' . rawurlencode($space['id']) . '/cover?revision=' . (int)$space['revision'] : null,
        'coverPosition' => ['x' => (float)$space['cover_x'], 'y' => (float)$space['cover_y']]];
}

/** Authenticated image response; no public upload directory or user filenames. */
function genesisSharedReadCover(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if ($space['cover_image'] === '') throw new GenesisSharedAccessException();
    [$prefix, $encoded] = explode(',', $space['cover_image'], 2);
    return ['type' => str_contains($prefix, 'image/png') ? 'image/png' : 'image/jpeg', 'bytes' => base64_decode($encoded, true)];
}
