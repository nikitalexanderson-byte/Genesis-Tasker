<?php
declare(strict_types=1);

/** Immutable bundles are release artifacts, not runtime/database backups. */
function genesisWebAssetNames(string $publicRoot): array
{
    $assetRoot = realpath($publicRoot . '/assets');
    if ($assetRoot === false || is_link($publicRoot . '/assets')) throw new RuntimeException('Invalid assets directory.');
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($assetRoot, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink()) throw new RuntimeException('Symlinks are not allowed in web assets.');
        if (!$file->isFile()) continue;
        $files[] = 'assets/' . str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($assetRoot) + 1));
    }
    sort($files, SORT_STRING);
    return $files;
}

function genesisWebAssetPath(string $path): bool
{
    return preg_match('~^assets/[a-zA-Z0-9_./-]+$~D', $path) === 1
        && !str_contains($path, '..') && !str_contains($path, '//');
}

function genesisWebReleaseAssets(string $publicRoot): array
{
    if (is_link($publicRoot . '/precache-manifest.js')) throw new RuntimeException('Symlinked precache manifest is not supported.');
    $source = file_get_contents($publicRoot . '/precache-manifest.js');
    if ($source === false || !preg_match('/self\.__GENESIS_PRECACHE=(\[[^;]*\]);/', $source, $match)) {
        throw new RuntimeException('Cannot read the current precache manifest; assets were not removed.');
    }
    $urls = json_decode($match[1], true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($urls)) throw new RuntimeException('Invalid precache manifest.');
    $files = [];
    foreach ($urls as $url) {
        if (!is_string($url)) throw new RuntimeException('Invalid precache URL.');
        // Production is hosted at /. Static artwork/fonts are outside this policy.
        $path = ltrim($url, '/');
        if (!str_starts_with($path, 'assets/')) continue;
        if (!genesisWebAssetPath($path) || !is_file($publicRoot . '/' . $path)) {
            throw new RuntimeException('Current release is missing a required asset; cleanup refused.');
        }
        $files[] = $path;
    }
    if (!$files) throw new RuntimeException('Empty release manifest; cleanup refused.');
    sort($files, SORT_STRING);
    return array_values(array_unique($files));
}

/** Called before AND after public publication. Only files below assets/ are removed. */
function genesisRetainWebAssets(string $root, bool $prune, int $now): array
{
    $resolved = realpath($root);
    if ($resolved === false || is_link($root)) throw new RuntimeException('Invalid release root.');
    $public = $resolved . '/public_html';
    $runtime = $resolved . '/server/var';
    foreach (['public_html', 'server', 'server/var'] as $relative) {
        if (is_link($resolved . '/' . $relative)) throw new RuntimeException('Symlinked release roots are not supported.');
    }
    if (!is_dir($runtime) && !mkdir($runtime, 0700, true)) throw new RuntimeException('Cannot prepare asset metadata directory.');
    $statePath = $runtime . '/web-asset-releases.json';
    $lockPath = $runtime . '/web-asset-releases.lock';
    if (is_link($statePath) || is_link($lockPath)) throw new RuntimeException('Symlinked metadata is not supported.');
    $lock = fopen($lockPath, 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock asset retention metadata.');
    try {
        $all = genesisWebAssetNames($public);
        $current = genesisWebReleaseAssets($public);
        $state = is_file($statePath) ? json_decode((string)file_get_contents($statePath), true, 512, JSON_THROW_ON_ERROR) : null;
        if ($state === null) {
            // Adopt the incumbent deployment once, preserving pre-policy old tabs too.
            $state = ['version' => 1, 'releases' => [['key' => 'legacy', 'seenAt' => $now, 'files' => $all]]];
        }
        if (($state['version'] ?? null) !== 1 || !is_array($state['releases'] ?? null)) throw new RuntimeException('Invalid asset retention metadata.');
        $key = hash('sha256', implode("\n", $current));
        $releases = [];
        $keep = [];
        foreach ($state['releases'] as $release) {
            if (!is_string($release['key'] ?? null) || !is_int($release['seenAt'] ?? null) || !is_array($release['files'] ?? null)) throw new RuntimeException('Invalid release record.');
            foreach ($release['files'] as $file) {
                if (!is_string($file) || !genesisWebAssetPath($file)) throw new RuntimeException('Invalid stored asset path.');
            }
            if ($release['key'] === $key || $release['seenAt'] < $now - 30 * 86400) continue;
            $releases[] = $release;
            foreach ($release['files'] as $file) $keep[$file] = true;
        }
        $releases[] = ['key' => $key, 'seenAt' => $now, 'files' => $current];
        foreach ($current as $file) $keep[$file] = true;
        $temporary = $statePath . '.tmp';
        if (is_link($temporary)) throw new RuntimeException('Symlinked temporary metadata is not supported.');
        if (file_put_contents($temporary, json_encode(['version' => 1, 'releases' => $releases], JSON_THROW_ON_ERROR), LOCK_EX) === false
            || !rename($temporary, $statePath)) throw new RuntimeException('Cannot save asset retention metadata.');
        $removed = 0;
        if ($prune) foreach ($all as $file) {
            if (isset($keep[$file])) continue;
            $candidate = realpath($public . '/' . $file);
            $assetRoot = realpath($public . '/assets');
            if ($candidate === false || $assetRoot === false || !str_starts_with($candidate, $assetRoot . DIRECTORY_SEPARATOR)
                || is_link($public . '/' . $file) || !is_file($candidate)) throw new RuntimeException('Unsafe cleanup path.');
            if (!unlink($candidate)) throw new RuntimeException('Cannot remove an expired web asset.');
            $removed++;
        }
        return ['retainedReleases' => count($releases), 'removedAssets' => $removed];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
    $options = getopt('', ['root:', 'prune']);
    $root = $options['root'] ?? '';
    if ($root !== '/home/u531952483/domains/genesiscalendar.com') {
        fwrite(STDERR, "Only the GENESIS Hostinger root is permitted.\n");
        exit(1);
    }
    try {
        echo json_encode(genesisRetainWebAssets($root, array_key_exists('prune', $options), time()), JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable $error) {
        fwrite(STDERR, $error->getMessage() . "\n");
        exit(1);
    }
}
