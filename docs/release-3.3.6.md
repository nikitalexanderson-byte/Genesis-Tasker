# Подготовка GENESIS 3.3.6

Начата 18 ноября 2026 по прямому поручению владельца. Главный приоритет — весь
промпт E2EE от 17 ноября, а не только окно обновления или AES workspace.
Отдельное уточнение владельца в этом же чате: безопасность внедряется во
**всю систему — сайт, API/сервер и Android**. Разделение публикаций сохраняется;
оно не сокращает общий security coverage.

Полный исходный промпт сохранён побайтно в
`docs/security-336-implementation-prompt.md` (SHA-256
`5540a407041626a2ed9263f7c97dcdf6b90985375cc0e78063f7bdd2a384b338`).
Это исторический текст 17 ноября; выполненные этапы bridge и
новые уточнения применяются по текущему AGENTS.md и этому журналу.
Исходное вложение:
`C:/Users/mrdeu/.codex/attachments/0f81edd1-6a20-40cd-a8f0-7ead7e1897a3/Вставленный текст.txt`.
Исходный аудит и 48 сценариев:
`output/security-review-2026-11-17/security-e2ee-report-2026-11-17.md`.
Состояние bridge: `docs/release-3.3.5.md`, `docs/security-bridge-335-adr.md`.

База main: `e131ac2035264cacc797fc112bde861c3fa0f9f8`, совпадение с GitHub
подтверждено fetch 18 ноября. Последние Source checks 44213408729 и Deploy
44218971065 — success. Рабочая ветка `codex/security-336`. Существующий
нетрекаемый `demo-output/` сохранён. Android сейчас 3.3.5/149; номер следующего
релизного артефакта проверяется перед сборкой и будет >149.

## Восстановленный полный объём

1. Реестр всех private data paths, threat model, ADR и совместимые библиотеки.
2. Hardening зависимостей/Actions/main/secrets и зашифрованные системные backups.
   Основной bridge уже выпущен в 3.3.5; повторный аудит перед выпуском обязателен.
3. Новый случайный client-only root; отдельные DEK; encrypted local vault,
   outbox/drafts; независимый recovery secret и clean-device recovery.
4. Подписанное enrollment доверенным устройством/recovery, single-use challenge,
   checkpoints, отзыв/ротация будущих ключей; Google identity не открывает vault.
5. Общий AEAD/signature contract JS/Kotlin/PHP, обязательные CAS/idempotency,
   эпохи/ACL и единая policy для всех изменяющих маршрутов, включая файлы.
6. Snapshot до первой сети; legacy → preparing → uploading → verified → active
   → retirement; shadow generation, повторное скачивание/проверка manifest,
   atomic commit/fence и crash/concurrency/offline/tombstone проверки.
7. Сначала web/API за выключенными флагами и web-only pilot; старые вкладки/SW
   и старый Android не должны обходить запрет записи мигрированного scope.
8. Android с тем же контрактом; прямое обновление 3.3.4 и более старых версий
   без обязательной промежуточной 3.3.5. Сохранение подписи/package/данных.
9. Общие проекты, документы, previews и вложения; сообщения/история и отдельный
   ADR forward secrecy; Google/AI/spelling — явные внешние границы.
10. Полная приёмка 48 сценариев, 14 языков по смыслу, обе схемы/все палитры,
    браузерные размеры 360/390/768/1440, Android API26+; независимый review,
    runbooks, privacy/support/release notes/Play Data safety.

Личные зашифрованные копии Google Drive одобрены для 3.3.6 в прошлом чате;
они требуют рабочего adapter и проверки восстановления. Paddle остаётся
отдельной интеграцией с проверкой готовности, не частью криптографического cutover.

После фактического обновления до 3.3.6 владелец поручил подготовить красивый,
продающий пост для Telegram с картинкой: реальные изменения, улучшения удобства
и объяснение надёжности GENESIS Tasker. Не публиковать автоматически; заявления
о защите привязать к пройденной приёмке, не обещать абсолютную безопасность.

## Текущий инкремент

Сначала общий строгий envelope, привязка полного контекста, новые одноразовые
DEK и подпись устройства. Решение и ограничения:
`docs/e2ee-336-contract-adr.md`. Результаты фактических проверок добавляются
после выполнения; старые результаты 3.3.5 не считаются тестами нового формата.

Реализованы три согласованных модуля `app/e2ee/envelope.ts`,
`server/src/e2ee-envelope.php`, native `security/E2eeEnvelope.kt`:
канонический полный AAD, новая случайная DEK на каждую запись, AES-KW/GCM,
подпись устройства, строгое ограничение типов/размеров/base64/эпох и
обязательный ожидаемый context при чтении. Два независимых синтетических
vectors созданы Node/OpenSSL и Kotlin/JCA; RFC3394 vector сверен отдельно.
Генератор test keys не импортируется runtime и не читает пользовательские ключи.

Внутренний read-only review агентом обнаружил accessor TOCTOU в новом web
parser. Исправлено одноразовым snapshot data descriptors; accessors, symbols,
скрытые поля и revoked Proxy отвергаются. После review также согласованы
JSON number semantics JS/PHP/Kotlin (включая JVM BigDecimal). Повторный review
новых P1/P2 не выявил. Это **не внешний криптографический аудит** всего протокола.

| Проверка первого инкремента | Фактический результат |
| --- | --- |
| Полный JS/domain набор | 1267/1267 PASS, `js-full-final.log` |
| Новый JS envelope suite | 26/26 PASS, включая JCA → Web Crypto |
| PHP parser/signature | 101 synthetic assertions PASS, `backend-jca/`; JCA подпись принимается |
| Legacy workspace compatibility | workspace-writer и workspace-writer-migration PASS, `backend-contract-01/` |
| Реальный браузер | Chromium157: 11/11 PASS; Node → Chrome и JCA → Chrome; log в `output/playwright/e2ee336/` |
| Android JVM | E2eeEnvelopeTest 7/7 PASS на итоговой числовой policy |
| Android platform | API35 и свежий API26: по 2/2 E2eeEnvelopeDeviceTest PASS на изолированном QA package |
| TypeScript / ESLint | PASS; 0 ошибок, 4 прежних предупреждения img; чужой demo-output исключён |
| Статическая web-сборка | PASS: public pages/gallery, 13 locale chunks и offline precache проверены |
| 14 каталогов переводов | i18n audit PASS; новые тексты security UI в этом инкременте не добавлялись |
| Dependency audit | 1 high picomatch без опубликованного patch, 0 critical; детали в `docs/security-336-dependency-review.md` |

Сохранены неудачные диагностические прогоны: Kotlin compile с 2GiB упёрся в
heap; первый compile нового модуля выявил несовместимые API JSONObject/ByteArray,
исправленные до успешной сборки. Первый расширенный PHP/JCA assertion сравнивал
порядок ключей JSON-массивов, хотя подпись уже была проверена; сравнение
нормализованных packets исправлено, повтор 101 PASS. Первый тест revoked Proxy
показал несанифицированную ошибку Array.isArray вне try; проверка перенесена
в защищённый parser, целевой повтор PASS. Эти исходные сбои не скрываются.

Выполнены все 11 прямых уточнений дизайна: Личные/Общие на Сегодня,
декоративные иконки Сегодня/Календаря, состояния общих icon actions/тулбаров,
дата сна, кнопка Стойхейона и header божества. Пройдены четыре палитры × обе
схемы × 360/390/768/1440dp, 14 языков, scale1.3, состояния press/release/cancel/
focus/selected/disabled и отдельный tablet. Сохранены 210 native phone PNG,
16 tablet PNG, 24 before и 48 after embedded-browser PNG. Отдельные доказательства,
первые ошибки только тестовых fixtures и фактически непроверенные состояния в
`docs/release-3.3.6-design.md` и `output/release-3.3.6/design/`.

API26 проверен на **новом** task-owned AVD GenesisSecurity336_API26, serial5574,
созданном из установленного системного image без копирования userdata прежнего
emulator5560. Попытка read-only второго экземпляра существующего AVD была
отклонена emulator lock и не использовалась. Старый5560 и личный Samsung не
изменялись. Установлены только QA package и тестовый APK; native cipher cases
прошли 2/2 за 0.115s. Это не проверка современного web bundle в старом WebView69
или полноценного app journey на Android8. Логи в `output/release-3.3.6/api26/`.

## Runtime vault, directory, migration and ordinary sync

Продолжение реализации добавило независимые recovery/device keys, RFC9180 HPKE,
защищённые web/native vaults, подписанные каталоги устройств/роли, серверные
CAS/receipts/lease/fence и сохраняемую web migration state machine. Обычная
синхронизация opaque объектов и файлов реализована одинаковым протоколом в
`app/e2ee/scope-client.ts` и native `security/E2eeScopeClient.kt`. Состав и
ограничения описаны в `docs/e2ee-336-runtime-adr.md`.

При review исправлены сценарии потери ответа, истечения migration lease,
повторной попытки после изменившегося legacy source, повторного keyId, подделки
истории старым ключом и понижения current-epoch revision на чистом клиенте.
Подписанные heads проверяются как нижняя граница; сохранённый ciphertext
отменяется/подтверждается до rebase. Файл сохраняет имя и тип. Отдельная offline
hydration открывает локальные черновики и принимает новые правки без сети;
после неё серверная синхронизация требует свежую проверку каталога.

Серверная additive migration 127 не опубликована. Persistent guards охватывают
multi-owner tables, raw legacy keys, поколения данных и изменения shared ACL.
ACL-изменения сейчас fail closed до реализации атомарной signed rotation.
Background scans ещё требуют явного исключения migrated scopes, чтобы один
защищённый scope не прерывал всю legacy job.

| Последняя целевая проверка runtime | Фактический результат |
| --- | --- |
| Все JS E2EE suites | 90/90 PASS, `runtime/js-full-03.log`; независимый повтор review также 90/90 |
| PHP actual SQLite | e2ee-store + e2ee-shared-store PASS, `runtime/backend-store-15/`; ownership expressions компилируются на полной схеме |
| Android JVM | 22/22 PASS: keys6, storage3, envelope7, scope-client6; `runtime/native-scope-01.log` |
| Реальный Chromium157 | 16/16 PASS, `runtime/browser-03.log`: Web/JCA HPKE, recovery, files, actual IndexedDB CAS/queued transaction abort |
| TypeScript / targeted ESLint | PASS, `runtime/typecheck-scope-03.log`, `runtime/lint-scope-03.log` |

Доказательства хранятся в `output/release-3.3.6/runtime/`. Неудачные прогоны
сохранены: backend-store-13 содержит ошибку SQL placeholders в новом synthetic
fixture (исправлена); первая проверка нового signed-floor test не передавала
file metadata (исправлена). Это не результаты полного 48-сценарного приёмочного
прогона. Последний native scope-client проверен JVM, не Android instrumented.

Внутренний read-only review текущего runtime завершён без открытых подтверждённых
P1/P2. Он не является внешним независимым криптографическим аудитом протокола.

## Что ещё обязательно до полного security/E2EE-выпуска

Согласованный контракт ещё не подключён к активным хранилищам/синхронизации.
Сервер всё ещё знает **legacy** account keys; этот инкремент не меняет данную
границу доверия и не даёт права обещать пользователям уже включённое E2EE.
Готовые runtime-модули ещё нужно подключить к каждому реальному хранилищу,
редактору и очереди; реализовать native migration, повторное офлайн-редактирование,
полное сведение всех источников, atomic shared ACL + rotation, файлы/previews,
recoverable personal archives/Drive и системный backup schedule/restore drills.
Затем требуются web pilot, прямые Android upgrades, 48 сценариев, новые security
экраны и смысловая приёмка всех 14 языков, внешние обработки/документы и
независимый crypto review. Существующие сообщения
сохраняют нынешнюю схему и историю; forward secrecy требует отдельного ADR.
Тесты этого инкремента не заменяют 48 сценариев полного перехода.

## Включение

Подготовка/локальные проверки не означают публикацию. GENESIS_DEPLOY_ANDROID
остаётся false, update floors=0, E2EE cutover выключен. Не запускать production
миграцию, retirement, установку на личный телефон или Play upload как побочный
эффект разработки. До обсуждения публикации должны быть конкретные готовые
изменения и доказательства. После cutover нельзя возвращать account key mode,
автоматически откатывать БД или очищать local storage.
