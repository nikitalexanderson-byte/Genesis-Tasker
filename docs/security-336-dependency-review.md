# Зависимости: повторный аудит для 3.3.6

## Срез23 ноября2026, кандидат19e81519

Повторный `pnpm audit --json`: exit0, critical/high/moderate/low/info —0.
Evidence: `output/release-3.3.6/runtime/dependency-audit-1123-candidate20.json`.
Результат относится к текущему advisory feed; это не замена крипторевью.

Для системного отпечатка закреплён `androidx.biometric:biometric-compose:1.4.0-rc01`
из официального Google Maven. Public Compose launcher поддерживает существующий
ComponentActivity; смена Activity/UI-стека не потребовалась. Запрос Class3/STRONG,
отдельный переход к системному PIN, фактический auth-required Keystore unlock
и owner/lifecycle checks сохранены. AndroidX Core1.18 FingerprintManagerCompat
по проверенному bytecode является no-op и из этого пути удалён; прежнее
утверждение о рабочем legacy bridge отозвано. Источники/bytecode evidence —
`output/release-3.3.6/runtime/biometric-1.4.0-rc01-sources.jar` и
`core118-fingerprint-bytecode.txt`. Это RC-зависимость; окончательная приёмка
должна включать реальные API26/API34 и minified startup финального кандидата.
Native19 debug/test APK собраны, но сам факт сборки не засчитывается biometric PASS.

## Повторный срез19 ноября2026

Новый `pnpm audit --json` завершился exit0: critical/high/moderate/low/info —0.
Evidence: `output/release-3.3.6/runtime/physis-dependency-audit-01.json`.
Это результат текущего registry feed, не самостоятельный криптографический
аудит и не доказательство отсутствия любых уязвимостей.

Отдельно повторно проверена исходная GHSA-fc5q-39xc-vjpf через GitHub API:
`withdrawn_at=2026-11-18T15:38:56Z`, `updated_at=2026-11-18T15:38:58Z`.
Ответ с отфильтрованной metadata сохранён в
`output/release-3.3.6/runtime/physis-picomatch-withdrawal-01.json`.
Таким образом, прежняя high-запись была отозвана upstream; нулевой результат
не получен suppression, подменой версии или объявлением picomatch4.0.7
исправленной версией. Исторические исходники/advisory и lockfile сохранены.
Полезные ограничения на недоверенные glob и loopback dev runtimes сохраняются.
Перед финальным выпуском повторяется актуальный аудит.

## Исторический срез18 ноября

18 ноября 2026, база `e131ac2035264cacc797fc112bde861c3fa0f9f8`.
`pnpm audit --json` выполнен повторно, а не взят из отчёта 3.3.5.
Полный результат: `output/release-3.3.6/dependency-audit.json`.

На этом историческом срезе — **одна high advisory**, 0 critical/moderate/low.
Его нельзя заменять последующим нулевым результатом задним числом.

## GHSA-fc5q-39xc-vjpf

[GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
проверена через GitHub API 18 ноября. Обновлена 17 ноября 15:56:44 UTC;
опубликована 19 октября. Уязвим picomatch <=4.0.7: single-branch repeated
extglobs могут приводить к ReDoS. Примеры из advisory — `+(*)` и `+(*a)`.

`first_patched_version=null`; `pnpm view picomatch version` вернул **4.0.7**.
Поэтому не выполнены слепой update, audit fix --force, подмена semver или
непроверенный самописный regex patch. Наличие версии 4.0.7 в lockfile не является
исправлением именно этой обновлённой advisory. Затронуты также транзитивные
picomatch 2.3.2.

## Фактические пути и достижимость

Audit показывает только dev-пути: Vite/tinyglobby/fdir, vitefu/plugin-rsc,
vinext, fast-glob/micromatch и typescript-eslint. Полный `pnpm why picomatch
--json` сохранён в `output/release-3.3.6/picomatch-paths.json`.

В просмотренных исходниках `app`, `scripts`, конфигурациях Vite и workflow
нет прямого API picomatch/micromatch, принимающего пользовательские задачи,
поисковые запросы или импорты как glob. Production-схема остаётся static Vite
client + PHP, а Node/Vite/vinext — отдельные dev/build entrypoints. Это
оценка просмотренных путей, **не доказательство отсутствия любой достижимости**
внутри всех транзитивных инструментов и не основание скрыть high finding.
Dev-зависимости участвуют в цепочке выпуска и не объявляются безвредными.

Для текущей разработки шаблоны задаются исходниками/конфигурацией; dev/QA
сервисы сохраняют loopback bind. Не включается новый публичный Node runtime
или endpoint с недоверенными glob-паттернами. Подтверждённый production exploit
этой advisory не установлен. Проверка выполнялась без запуска ReDoS на
production и без использования пользовательского содержимого.

## Перед выпуском

Повторно проверить upstream advisory/релиз, обновить согласованную версию с
lockfile и функциональными build-тестами, если исправление опубликовано.
Если исправления ещё нет и advisory не отозвана, в релизной оценке должны остаться high finding,
описание достижимости и пределы проверки; нельзя выдавать suppression или
одну проверку prod-dependencies за устранение уязвимости. Текущий первый
инкремент не объявляется завершённым полным обновлением безопасности.
