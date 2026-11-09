<?php
declare(strict_types=1);

/** Add public notices around the unchanged legacy application document. */
function genesisLegacyHomepage(string $html): string
{
    $top = '<aside id="genesis-relocation-top" class="genesis-relocation-notice" aria-label="Новый адрес GENESIS"><div><strong data-relocation-copy="title">GENESIS переезжает на genesiscalendar.com</strong><p data-relocation-copy="intro">Новый дизайн и дальнейшие обновления — на новом сайте. Этот сайт пока продолжает работать.</p></div><a href="https://genesiscalendar.com" data-relocation-copy="link">Открыть новый сайт</a></aside>';
    $bottom = '<footer id="genesis-relocation-bottom" class="genesis-relocation-notice genesis-relocation-footer" aria-label="Объявление о переезде"><div><strong data-relocation-copy="footerTitle">Объявление о переезде</strong><p data-relocation-copy="footerText">Основной адрес GENESIS — genesiscalendar.com. Сохраните его в закладках. Календарь на старом адресе остаётся доступным.</p></div><a href="https://genesiscalendar.com" data-relocation-copy="link">Открыть новый сайт</a></footer>';
    $assets = '<link rel="stylesheet" href="/legacy-relocation-notice.css"><script src="/legacy-relocation-notice.js" defer></script>';
    $html = preg_replace('/<\/head\s*>/i', $assets . '</head>', $html, 1) ?? $html;
    $html = preg_replace('/(<body\b[^>]*>)/i', '$1' . $top, $html, 1) ?? $html;
    return preg_replace('/<\/body\s*>/i', $bottom . '</body>', $html, 1) ?? $html;
}

if (!defined('GENESIS_LEGACY_HOME_TEST')) {
    $host = strtolower(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''), 2)[0]);
    if (!in_array($host, ['genesiscalendar.ru', 'www.genesiscalendar.ru'], true)) {
        http_response_code(404);
        exit;
    }
    // The only file read is the incumbent app shell in this same public root.
    $html = file_get_contents(__DIR__ . '/index.html');
    if ($html === false || stripos($html, '</body>') === false) {
        http_response_code(503);
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    echo genesisLegacyHomepage($html);
}
