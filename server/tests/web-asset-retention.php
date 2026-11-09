<?php
declare(strict_types=1);
require dirname(__DIR__, 2) . '/ops/retain-web-assets.php';
$root = sys_get_temp_dir() . '/genesis-assets-' . bin2hex(random_bytes(6));
mkdir($root . '/public_html/assets', 0700, true);
mkdir($root . '/server/var', 0700, true);
function assetExpect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function assetRelease(string $root, array $files): void {
    foreach ($files as $file) file_put_contents($root . '/public_html/assets/' . $file, 'export default true;');
    file_put_contents($root . '/public_html/precache-manifest.js', 'self.__GENESIS_PRECACHE=' . json_encode(array_map(static fn($file) => '/assets/' . $file, $files)) . ';');
}
try {
    $day = 86400;
    $now = 1791936000;
    assetRelease($root, ['old.js', 'shared.js']);
    genesisRetainWebAssets($root, false, $now);
    assetRelease($root, ['new.js', 'shared.js']);
    genesisRetainWebAssets($root, true, $now + $day);
    assetExpect(is_file($root . '/public_html/assets/old.js'), 'An open tab lost its old module.');
    genesisRetainWebAssets($root, true, $now + 29 * $day);
    assetExpect(is_file($root . '/public_html/assets/old.js'), 'Retention ended too early.');
    $result = genesisRetainWebAssets($root, true, $now + 31 * $day);
    assetExpect($result['removedAssets'] === 1 && !is_file($root . '/public_html/assets/old.js'), 'Expired assets were not pruned.');
    assetExpect(is_file($root . '/public_html/assets/shared.js'), 'A shared dependency of the current build was removed.');
    file_put_contents($root . '/public_html/assets/orphan.js', 'orphan');
    file_put_contents($root . '/public_html/precache-manifest.js', 'self.__GENESIS_PRECACHE=["/assets/missing.js"];');
    try { genesisRetainWebAssets($root, true, $now + 90 * $day); throw new LogicException('Missing required module accepted.'); }
    catch (RuntimeException $error) { assetExpect(!$error instanceof LogicException, $error->getMessage()); }
    assetExpect(is_file($root . '/public_html/assets/orphan.js'), 'An invalid manifest triggered cleanup.');
    assetExpect(!genesisWebAssetPath('assets/../../server/config.php'), 'Traversal accepted.');
    assetExpect(!genesisWebAssetPath('assets//file.js'), 'Ambiguous path accepted.');
    echo "Web asset retention: old tabs, expiry, shared dependencies and fail-closed cleanup passed.\n";
} finally {
    // All paths originate in this unique test directory; never follow symlinks.
    $resolved = realpath($root);
    if ($resolved !== false && str_starts_with($resolved, realpath(sys_get_temp_dir()) . DIRECTORY_SEPARATOR . 'genesis-assets-')) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($resolved, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $file) $file->isDir() && !$file->isLink() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        rmdir($resolved);
    }
}
