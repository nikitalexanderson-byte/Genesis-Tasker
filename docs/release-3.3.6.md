# Подготовка GENESIS 3.3.6

Актуальный срез20 ноября: реализованы9/20 реальных source categories; это не
процент готовности релиза. Напоминания получили web/native capture/reconciliation,
сохранение истории/форм/uncertain actions и проверенное чтение с новым root.
Подготовлен server reader/byte fragments архивов; это ещё не десятая категория.
Остальные11 источников, полный product lifecycle,
shared/files/automation, archives/Drive/local-only recovery, direct upgrades,
48 системных сценариев и14-language semantic review остаются обязательными.
Проверяемый остаток по каждому исходному сценарию —
`docs/security-336-acceptance-matrix.md`; подготовлен черновой brief для внешнего
аудитора: `docs/security-336-external-review-brief.md`. Независимый crypto review
человеком/организацией ещё не проведён. Production3.3.5/149, floors0, cutover off,
GENESIS_DEPLOY_ANDROID=false; полного выпуска/деплоя3.3.6 пока нет.

Исторический инкремент18 ноября: отдельные append-only encrypted journals Авроры и
независимого архива практик, сохранение всех writer snapshots в личных backups,
защита закрытия нативного редактора и исправление его измеряемой высоты.
Финальная JS-регрессия1431/1431 PASS, реальные две вкладки14/14 и editor-fence
регрессия28/28 PASS; JVM1123 PASS/8 opt-in skips, native bridge6/6 PASS.
Полные границы и evidence: `docs/e2ee-336-operation-fences.md`.
Полный offline UI прошёл на изолированном API34/Chromium113:3/3 light и9/9
dark UI+bridge, font1.3; исправлен также устаревший parent document при возврате
из архива и немедленном закрытии. Source adapters/product routing всех20 путей
и E2EE cutover этим инкрементом не завершены. Владелец теперь прямо поручил полный
деплой3.3.6 после готовности; условия приёмки и независимого review сохраняются.

В этой же подготовке выполнена согласованная публичная локализация `/ru/` +
переключатель остальных языков. На стартовом Android-экране до входа русский
доступен только при текущем RU-результате по IP; после входа языки аккаунта
сохраняются. Подробности, ограничения и снимки:
`docs/public-localization-336.md`. QA APK/test APK собраны отдельно от release;
1121 JVM PASS / 8 opt-in skipped, API26 — 8/8 PASS. Действующая публичная версия
остаётся 3.3.5/149, публикаций и изменений личных устройств не выполнялось.

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
Background scans теперь явно исключают migrated/live-migrating scopes до LIMIT;
отдельная проверка перед исполнением и после сетевого ответа сохраняет queued
payload и исходные записи. Полный охват реальных feature adapters остаётся впереди.

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

## Возобновляемый native migration и очереди редакторов

Следующий локальный инкремент добавляет durable editor queue на обеих платформах,
реестр20 data paths, native migration coordinator и реальные authenticated
migration transports. Каждый подтверждённый offline edit получает защищённый
неизменяемый снимок; незавершённая загрузка не мешает сохранять новые правки.
Подтверждённое сведение с remote не уменьшает revision при позднем ACK.
Scope/device binding предотвращает случайную запись личного редактора в общий scope.

При review исправлены четыре интеграционные ошибки: смешение path IDs с crypto
domains; недопустимые remote domains shared local-work; отсутствие aggregate byte
budget; несовместимый file format комментария после миграции. Registry проверяется
вместе с coordinator и обычным reader. Неполный/неподключённый источник блокирует
активацию. Raw legacy keys, очередь, identity/billing/ACL не становятся shared
content из local-work.

Native перенос проверен на14 точках process death,6 expiries lease,2 обрывах
renewal, restart с сохранением прошлых snapshots, неполных данных, отсутствующих
ключах, заполненном диске, повреждённом readback/recovery/checkpoint. Signed
readback проходит короткие страницы до пустой, проверяет продвижение курсора и
checkpoint; account switch/lock прерывают продолжение запроса.

| Последняя проверка инкремента | Результат и evidence в `output/release-3.3.6/runtime/` |
| --- | --- |
| JS E2EE suites |110/110 PASS, `js-migration-05.log` |
| Native JVM |45/45 PASS по7 XML suites, `native-migration-03.log`; migration7 содержит перечисленные fault scenarios |
| PHP actual SQLite |2/2 suites PASS, `backend-paths-02/`; все ownership tables и registry↔server domain policy |
| TypeScript / targeted ESLint |PASS, `typecheck-migration-01.log`, `lint-migration-01.log` |
| Внутренний read-only review |Все4 registry P2 закрыты; новых P1/P2 в native coordinator/transport нет; focused Node41/41 PASS |

`native-migration-01.log` сохраняет исправленную ошибку имени recovery API в новом
fixture; `js-migration-03.log` — исправленную синтаксическую ошибку regression.
Android instrumented/process kill/low-memory acceptance этого инкремента,
реальные feature adapters и полный48-сценарный прогон ещё не выполнены.
Эти результаты не означают publication или готовность полного E2EE coverage.

## Изоляция legacy workers и проверка реальных transport packets

Следующий локальный инкремент исключает защищённые personal/project scopes и
дочерние проекты защищённых spaces из scans серий, automation и уведомлений.
Claim фильтрует scope до LIMIT под SQLite writer:120 защищённых заданий не мешают
получить готовое legacy-задание за один вызов. Повторная проверка владельца lease
предшествует deferral; attempts возвращается только если исполнение не началось.
Сетевой ответ после начала migration не меняет source/delivery и не подтверждает
задание. Payload, receipts и незавершённая работа сохраняются для reconciliation.

Review выявил и помог закрыть starvation, расход попыток до исполнения,
повреждённый payload, блокировавший каждый claim, и TOCTOU планирования advice.
Повреждённые private bindings изолируются как `E2EE_JOB_REVIEW_REQUIRED`, сохраняя
payload и source; legacy failure callbacks не вызываются. DB/config failures не
маскируются как повреждение отдельного задания. Day snapshot, delivery и job
планируются атомарно с новой проверкой scope под writer. Независимое повторение
гонки через второй PDO создало0 snapshots/deliveries/jobs после lease.

Моки скрывали опечатку pagination action `list`; обе платформы теперь подписывают
реальный `read`. Сохранённые синтетические web/native packets проверены настоящими
`genesisE2eeRead` и SQLite, а не только ответом мока. Fixture не содержит live secrets.

| Проверка инкремента | Фактический результат |
| --- | --- |
| PHP scoped workers, смежные подсистемы и реальные transports |9 suites PASS в `runtime/backend-jobs-07/`, отдельный исправленный e2ee-background263 cumulative assertions PASS в `runtime/backend-jobs-09/` |
| JS E2EE |111/111 PASS, `runtime/js-transport-01.log` |
| Native JVM |46/46,7 XML suites,0 failures/errors; `runtime/native-transport-01.log` |
| TypeScript / targeted ESLint |PASS, `runtime/typecheck-jobs-01.log`, `runtime/lint-jobs-01.log` |
| Внутренний scoped read-only review |Все4 подтверждённых дефекта закрыты, новых P1/P2 в объёме нет;2/2 independent PHP suites PASS (`envelope-background-review-02`), malformed matrix9/9 и проверка stale lease PASS |

Сохранены диагностические07/08 e2ee-background failures: новый race fixture сначала
пытался bootstrap personal scope от другого synthetic owner, затем не заменил
owner binding в synthetic recovery kit. Product code не ослаблялся; fixture
исправлен,09 PASS. Проверки не включают production migration, Android instrumented
или полный48-сценарный прогон. Внешний crypto review по-прежнему не проведён.

Сверка всей SQLite-схемы обнаружила дополнительные private copies в backup staging,
safety snapshots, shared operation/receipt rows. Прежний тест inventory проверял
только уже объявленные guards; он не доказывал, что все таблицы классифицированы.
Результат отдельного полного schema disposition audit и проверки новых
необъявленных tables/columns приведён ниже. Это не доказательство полной
продуктовой интеграции.

## Полная классификация схемы и дополнительные private copies

Сверка завершена для218 tables и всех их columns через migration127; контракт
`contracts/e2ee/server-schema-v1.json`, actual SQLite regression `e2ee-schema`.
106 legacy-private tables имеют persistent INSERT/UPDATE/DELETE fences. Добавлены
backup staging/safety/receipts, advice state, private preferences, определения
bulk и копии результатов/квитанций shared операций. Set-valued predicates
учитывают несколько проектов и явные historical refs, включая spaceId бывшего
участника; один произвольный проект не выбирается. Консервативная привязка к
current author memberships служит только запрету/SourceHash, **не праву экспорта**.
Существующие старые поколения не объявляются перешифрованными.

В users отдельно защищены6 private preference/reference fields; no-op разрешён,
identity/language/billing продолжают работать независимо. Категории участников
разделены как private title + ACL authority. Conversation titles и жизненный цикл
старых message keys явно остаются интеграцией, а не скрываются за словом metadata.
Проверен `future_modeling_orders`: provider requests содержат checkout metadata и
ID результата; solution хранится в private `future_modeling_results`.

Review нашёл два дополнительных P2: global expiry sweep прекращал общий cron
при protected row, а view receipt бывшего участника терял space ownership.
Оба исправлены. Preview/backups/receipts/metrics используют scope-aware DELETE
с той же predicate, что trigger. Shared maintenance сохраняет protected branch
и counts через savepoint, продолжая независимую очистку; malformed historical
receipt сохраняется для разбора. Server Google-copy worker исключает защищённые
scopes при выборе и повторно проверяет scope перед обработкой; explicit external
copy consent/product integration по-прежнему требует отдельной приёмки.

Проверено:20/20 смежных PHP suites PASS (`runtime/backend-copies-05`), затем
обновлённые7/7 PASS (`backend-copies-06`),4/4 shared maintenance/lifecycle PASS
(`backend-maintenance-01`), actual paid preview/mixed-scope cleanup PASS
(`backend-maintenance-02/03`),111/111 JS E2EE PASS (`js-copies-01.log`). Independent
scoped review:2/2 schema/private-copy suites,1/1 maintenance, оба исходных repro,
6 mixed users fields,6 personal copy families и cross-scope cascade rollback PASS.
Новых P1/P2 в проверенном diff нет. Это внутренний review, не внешний crypto audit.

Итоговый повтор после всех fixes/форматирования:26/26 PHP suites PASS,
`runtime/backend-copies-final/`. Сайт, Play и личные устройства не изменялись.

Сохранены failures `backend-copies-01` (тест ожидал запрет no-op private UPDATE),
`backend-copies-03` (fixture использовал короткий hash вместо64 символов).
Исправлены fixtures; production checks не ослаблялись. Полный продуктовый coverage,
Android instrumented/low-memory и48 сценариев этим инкрементом не подтверждаются.

## Первый реальный workspace adapter и чтение legacy-источника

Добавлен `PersonalWorkspaceSource` для реальных localStorage workspace, sync
base/metadata, device key и всех отдельных workspace journals. Factory в
cloud-sync получает текущие memory key/base/metadata и callback открытого
редактора. Сначала сохраняются исходные локальные bytes; mutating `readPending`
не вызывается. В сетевой E2EE-контент не попадают raw legacy keys или HTTP queue
authority. Исторические relational projects/categories защищаются отдельным
зашифрованным объектом и не воскрешают удалённые записи актуального workspace.

JS/Kotlin coordinators передают источникам актуальный context после snapshot и
lease; transports подписывают `legacy-workspace`. Сервер проверяет owner/device,
directory epoch/checkpoint, lease/fence/source в одном SQLite writer transaction.
После active этот read закрыт. Он не вызывает Google/bootstrap, не создаёт ключи
и возвращает только уже известный серверу **старый** key. Client-only legacy key
нужен из локального snapshot. Selected fields,10000 combined rows и16MiB response
ограничены; повреждённый/отсутствующий key и changed source блокируют read.

При проверке закрыты: потеря document-only tombstones при отсутствии memory
metadata, трактовка stale persisted cache как удаления из открытого редактора,
приём произвольного truthy conflict choice и stack overflow большого base64
parser. Future/invalid immutable events не пропускаются через lossy projection.
Changed prior attempts, unscoped attribution и старые tracker formats требуют
отдельного review UI и пока останавливают перенос с сохранением bytes.

Проверки:125/125 JS PASS (`runtime/js-workspace-04.log`),46/46 native JVM,
7 XML suites,0 failures/errors (`runtime/native-workspace-01.log`), typecheck и
targeted ESLint PASS (`typecheck-workspace-03.log`, `lint-workspace-02.log`).
9 смежных PHP suites PASS (`backend-workspace-final-01`), затем boundary checks
10000 rows/16MiB/corrupt old key PASS (`backend-workspace-limits-02`). Реальные
подписанные web/native pagination packets принимаются PHP; новые static legacy
packets с намеренно stale source token отвергаются как `E2EE_SOURCE_CHANGED`
(`backend-workspace-limits-01` transport PASS). Успешный bound legacy read отдельно
проверен с реальным SQLite/HMAC/PHP signing fixture, не выдаётся за cross-platform
успешную миграцию реального продукта.

Сохранены diagnostic failures: первые4 backend-workspace-read прогона содержат
исправленные ошибки нового fixture (название signature error, уникальность email,
migration ID, missing shared helper). `backend-workspace-limits-01` первоначально
упёрся в действующую1000-category quota; isolated oversized historical fixture
временно повышает только свою technical quota и восстанавливает её до read.
JS-workspace-01 проверял prototype вместо значений canonical payload;03 показал,
что отсутствие base требует явного delete/edit review. Проверки не ослаблялись.

Это первый feature adapter за выключенным контуром, ещё не active product
bootstrap/editor routing. Полный набор adapters, native Room integration,
multitab writer fences, clean-device recovery/UI и внешний crypto review остаются
обязательными; этот инкремент не меняет production или номер Android149.

Финальная сверка этого дерева:9/9 PHP suites PASS
(`backend-workspace-final-02`, legacy-workspace264 cumulative assertions),
typecheck/ESLint PASS (`typecheck-workspace-final.log`, `lint-workspace-final.log`).

Поручение владельца: после фактического обновления до3.3.6 подготовить красивый,
продающий Telegram-пост с картинкой и проверенными улучшениями надёжности.
Автоматическая отправка не поручена; полный E2EE до готовности не рекламировать.

## Реальный native workspace source и защита поколений restore

Следующий инкремент добавил `E2eeNativeWorkspaceSource` и factory AuthController:
4 документа Room и workspace outbox читаются в одной transaction, без ACK/очистки.
LocalCipher открывает существующие записи без генерации replacement key; snapshot
содержит исходный ciphertext и portable JSON для нового защищённого поколения.
Мёртвый Keystore, потерянная очередь, несовпавшая revision, held work и старые
изменившиеся attempts останавливают перенос. Точный fingerprint связывает
conflict review с его источниками. Native achievement ID/clocks приводятся к web
identity, без потери самих записей; строгие event roundtrips блокируют lossy
projection. JSON/UTF-8/date errors возвращают фиксированные коды без private values
и cause. Это не подтверждение реального Room/Keystore instrumented-прогона.

Новый разбор выявил общий restore-риск: старый локальный workspace мог попасть в
перенос после смены data_generation. Web/native теперь сверяют accepted/pending
generation и remote base revision; web snapshot format2 явно хранит происхождение
поколения, старые snapshots без него требуют review. Backend выбирает shadow
generation выше актуального legacy generation, в том числе при restore между
bootstrap и lease. Старые shadow objects сохраняются; новый attempt после reset
получает отдельное поколение. Stale target lease не допускается к reads/puts и
verification. Максимум safe integer проверяется до записи.

Проверено126/126 JS PASS (`runtime/js-workspace-generation-02.log`), native JVM
(`native-workspace-source-final.log`, включая реальные codec roundtrips и
8 исходных adapter-сценариев с последующими дополнениями),5 PHP suites PASS
(`backend-generation-01`); финальный расширенный результат указан ниже после
сверки дерева. Typecheck/ESLint повторены после изменения web capture format.
Product routing, persistent writer fences, остальные paths, новая security UI,
48 сценариев и внешний crypto review по-прежнему не завершены. Выпуска3.3.6 нет.

Финальное дерево инкремента:56/56 JVM tests по8 XML suites,0 failures/errors,
в том числе10 native source tests (`native-workspace-source-final.log`);
126/126 JS (`js-workspace-generation-02.log`),9/9 PHP suites
(`backend-generation-final`,275 cumulative legacy-workspace assertions),
typecheck/ESLint PASS (`typecheck-workspace-generation-final.log`,
`lint-workspace-generation-01.log`). Native tests используют injected read-only
Room rows и настоящий JCA/JSON/domain codecs; фактические Room/Keystore,
авторизованный upgrade, UI, process kill и low-memory не проверены этим JVM run.

## Постоянный native storage fence и настоящие API26 проверки

Room schema2 добавляет только technical `e2ee_legacy_fences`. Additive1→2 не
изменяет исходные4 таблицы, ciphertext, revisions, deleted flags или outbox IDs.
Никаких destructive fallback нет. SQLite блокирует INSERT/UPDATE/DELETE tasks,
documents, outbox и reminders для явно связанного scope; scope move и REPLACE
также закрыты. Active marker нельзя удалить/понизить/заменить. Content archives
эту таблицу не импортируют. При простом обновлении нет markers, поэтому legacy
аккаунты работают по-прежнему; migration UI пока не подключён.

Preparing marker коммитится до snapshot/network, переживает exceptions и process
death. Между2 Room controllers одного DB/scope общий lock; cancellation перечитывает
свежий защищённый Status, не принимает ранее сохранённый cancelled объект.
После провала подготовки fence остаётся до явного retry/recovery/подтверждённой
отмены, не открывает записи автоматически. AuthController связывает factory с
owner/session/unlocked device и UpdateGate. Root fence не заменяет network guards,
shared child bindings или новый product routing.

На task-owned `GenesisSecurity336_API26` (serial5574) прошли:

- 4/4 instrumented (`runtime/native-fence-instrumented-final.log`): прямой1→2 с
  точной сверкой всех4 исходных rows, I/U/D families, scope move/REPLACE,
  необратимость active, late cancellation между2 Room instances и действительный
  Room + AndroidKeyStore workspace adapter;
- После `e2eeFenceReady=true` host принудительно завершил только
  `ru.genesis.calendar.qa1103.debug`. Новый процесс сохранил точные rows/outbox
  и preparing barrier, затем проверил active/IUD:1/1 PASS
  (`native-fence-process-retry-stage1/2.log`);
- Удалён только отдельный свежий QA alias `genesis.e2ee.qa.<UUID>`: исходные rows
  и очередь остались, plaintext capture остановился без создания replacement key.
  Default alias `genesis.local.v1` сохраняется;
- 56/56 JVM,8 XML suites,0 failures/errors; debug APK/test APK build PASS
  (`native-fence-build-final.log`). Сборка остаётся QA3.3.5/149 по metadata:
  это не финальный versionCode/релиз3.3.6.

Сохранены failures: instrumented-01 использовал getJSONArray для необязательного
поля indices старого exported Room schema; fixture исправлен, product migration
не ослаблялась. Первая final process-stage1 встретила Android DeadSystemException
в NotificationManager ещё до теста; ошибочный host переход к phase2 дал ожидаемо
missing fixture. Orchestration исправлена: phase2 разрешена только после READY и
host kill. Повтор при работающем system service прошёл. В корректном stage1
`Process crashed` после READY ожидаем, он не выдаётся за самостоятельный PASS.

Личный Samsung, emulator5560, сайт и Play не изменялись. Test DB names/alias
уникальные, изолированные; основное приложение не удалялось/не очищалось.
Не проверены этим этапом: полноценный app boot/unlock/enrollment/recovery,
device-credential/biometric invalidation нового vault, low memory, все shared
bindings, web multitab и полный48-сценарный переход.

## Личные legacy transport guards сайта, API и Android

Добавлены общий route/payload contract, серверная защита чтения saved advice и
paid modeling results, транзакционная защита private/unknown preference patches
и исключение legacy private preferences из ответов активного профиля. Новый
owner header запрещает отправку очереди под cookie другого аккаунта. Подробности,
границы и воспроизводимые проверки: `docs/e2ee-336-legacy-transport.md`.

Android HTTP client делит scope mutex с persistent Room fence: уже начатый ответ
завершается до подготовки snapshot, следующие private requests не создают даже
соединение. Cookie/owner публикуются атомарно, mutable JSON копируется до
классификации. Web API client использует реальные Web Locks и отдельные durable
IndexedDB deny markers. Необратимый active/cancelled status CAS сохранён. Оба
клиента также запрещают legacy IO по защищённому профилю на чистом устройстве без
локального маркера. Identity, technical preferences и signed E2EE routes доступны.

133/133 JS, 478/478 JVM auth/security (77 suites), 8/8 API26 instrumentation,
22/22 real Chromium checks, 11/11 backend regression +3/3 focused suites
(transport overlap), typecheck/ESLint/web build — PASS. Только synthetic QA
package/данные, отдельный emulator5574 и loopback server; личные устройства и
production не менялись. Native APK по metadata остаётся QA3.3.5/149.

Это ещё не полный local/editor/SW barrier: shared scopes и отдельная внешняя
проверка орфографии имеют самостоятельные границы. Эти результаты не заменяют
полную миграцию20 private paths или независимую проверку криптографии.

## Service worker и контролируемые старые страницы

Новый worker проверяет personal private API, включая изменяющие методы. Старые
запросы без owner header делят global permit с подготовкой миграции; после deny
marker они не достигают backend. Текущие клиенты сохраняют parallel owner permits;
worker не берёт повторный owner lock и не создаёт deadlock. Старый ответ читается
полностью с64MiB bound, обрыв/переполнение не выдаются за успешную часть данных.

Product factory проверяет protocol текущего controller до marker/snapshot.
Автоматические skipWaiting/reload/очистка не добавлены. Classic bundle создаётся
из общего TypeScript/policy, проверяется build:web и входит в fingerprint/precache.
139/139 JS, 13/13 real service-worker checks +22/22 browser regression checks,
typecheck/ESLint/build:web — PASS. Только isolated loopback; full production cache
lifecycle, все local writers/editors и uncontrolled/restored pages ещё требуют
приёмки. Подробности: `docs/e2ee-336-service-worker.md`.

## Расширение защиты операций редакторов

После diary тот же owner barrier подключён к реальным web-репозиториям карт,
Авроры и независимого архива практик Стойхейона. Сохранены немедленный защищённый
черновик карты, неизменяемые повторы запросов, история и ссылки преобразований.
Очереди не удерживают permit при ожидании другой очереди. Неверный receipt не
удаляет исходную копию, а поздний ответ не очищает другой новый pending envelope.
Общие карты связывают HTTP с текущим владельцем и защищают его локальную работу;
это ещё не собственный shared scope fence/ACL/rotation.

Нативный мост Авроры теперь удерживает opaque capability через RPC, Room и
borrowed HTTP до завершения операции. Закрытие/отмена сначала запрещают новые
действия и дожидаются уже начатых; потерянный begin можно завершить по заранее
известному ID, включая end-before-begin и смену аккаунта. Прочие native пути и
полные source adapters всё ещё обязательны.

Проверки:1420/1420 JS,28/28 real Chromium/две вкладки,1131 JVM cases
(1123 PASS,8 opt-in skips,0 failures),12/12 API26 instrumentation. Последний
сценарий включает84 варианта нового WebView fallback:3 экрана ×14 языков ×2 схемы,
font1.3, без редакторского IO и с сохранением точной исходной Room row. Проверены
web build, typecheck/lint и каталоги локализаций. Все артефакты — только QA3.3.5/149.

Выявлен старый Chromium69 на API26: встроенные модули не могли разобрать JS.
Общий контракт задаёт поддерживаемый target Chromium111; Аврора, личные backups
и каталог божеств показывают понятное сообщение об обновлении WebView/Chrome
на14 языках до создания WebView. Это runtime compatibility, не crypto authority.

Приёмка реального UI на современном provider **ещё не завершена**: сохранённый
пустой архив не проходит прежнюю проверку высоты; сценарий offline reopen дважды
прерван Windows access violation самого QEMU. Ошибки не выданы за PASS, assertions
не ослаблены. До релиза нужны исправление/проверка высоты и полный стабильный
проход сохранения/открытия. Подробности и точные логи:
`e2ee-336-operation-fences.md`, `native-web-runtime-336.md`.

## Что ещё обязательно до полного security/E2EE-выпуска

Уточнение владельца в текущем продолжении18 ноября: Paddle проверяется в3.3.6
по согласованной схеме с `/ru/` и достоверными юридическими ролями. Если нормальное
подключение не получится, следующим отдельным решением сравнить CloudPayments,
Робокассу и подходящие альтернативы. Действующая ЮKassa сохраняется; новый
провайдер не включается до одобрения и технической/платёжной приёмки. Это не
изменяет обязательные этапы security/E2EE.

Согласованный контракт ещё не подключён к активным хранилищам/синхронизации.
Сервер всё ещё знает **legacy** account keys; этот инкремент не меняет данную
границу доверия и не даёт права обещать пользователям уже включённое E2EE.
Готовые runtime-модули ещё нужно подключить к каждому реальному хранилищу,
редактору и очереди; реализовать полное сведение всех реальных источников,
shared writer fences, atomic shared ACL + rotation, файлы/previews,
recoverable personal archives/Drive и системный backup schedule/restore drills.
Затем требуются web pilot, прямые Android upgrades, 48 сценариев, новые security
экраны и смысловая приёмка всех 14 языков, внешние обработки/документы и
независимый crypto review. Существующие сообщения
сохраняют нынешнюю схему и историю; forward secrecy требует отдельного ADR.
Тесты этого инкремента не заменяют 48 сценариев полного перехода.

## Включение

В текущем продолжении18 ноября владелец прямо поручил завершить все обновления
и полный деплой3.3.6. Штатные отдельные web/API и подписанный APK на сайте
разрешены **после полной приёмки**. Package/сертификат/данные и workflows сохранять;
новый versionCode выше всех реально использованных, включая149. Установка на личное
устройство и изменение Google Play-треков не следуют из этого поручения автоматически.
Независимый crypto review, coverage и восстановление остаются условиями активации.

Подготовка/локальные проверки не означают публикацию. GENESIS_DEPLOY_ANDROID
остаётся false, update floors=0, E2EE cutover выключен. Не запускать production
миграцию, retirement, установку на личный телефон или Play upload как побочный
эффект разработки. До обсуждения публикации должны быть конкретные готовые
изменения и доказательства. После cutover нельзя возвращать account key mode,
автоматически откатывать БД или очищать local storage.

## Реальный web источник Авроры и подписанный legacy read

Личные sessions/results, все pending writers и их старые snapshots теперь
сводятся фактическим web adapter под новым root. Непосланные inline results
также переносятся; старые keys не попадают в новое portable content. Source IO
выполняется после durable protected capture. Backend ограничивает чтение
подписанным personal owner/current lease/source token; payment authority не
выбирается. Native signed transport поддерживает этот read, но его собственный
Aurora source adapter и product routing ещё обязательны.

Проверено1442/1442 JS,8/8 native JVM migration tests,4/4 PHP suites с8 реально
подписанными web/native transport packets, typecheck/lint/web build. Реальная
интеграция Aurora adapter → coordinator → normal scope client открывает новое
содержимое и прежние ветки новым root и сохраняет legacy originals. Остальные
registry paths в этом тесте synthetic, это не полная приёмка20 paths.
Подробности: `docs/e2ee-336-aurora-source.md`. Активация и production не менялись.

## Восстановление конфликтующих portable journals

Общий web/Android UI теперь даёт явный выбор сохранённого черновика и прежнего
snapshot Авроры/Практик. Решение связано с точным набором исходных copies/base/cache
и выбранным документом; подделанный default в файле не разрешает выбор. Новая
ветка снимает прежний preview/confirmation. Исходный encrypted archive и legacy
очереди не меняются. Это дополнение к сохранению всех writers, а не полный E2EE
archive/recovery или автоматическое решение всех конфликтов.

1449/1449 JS, typecheck/lint/i18n/web build PASS. Chromium:28/28 flows,
112 viewport checks на14 языках/2 схемах, font1.3 дополнительно EN/RU/DE;
0 console errors. API34:2/2 actual SAF export/import + production native WebView,
EN light/dark, font1.3; encrypted previews сверены JCA, все3 исходные encrypted
Room rows совпали до/после. QA APK/test APK собраны, version metadata149 сохранена.
Документация, лог ошибок fixture и ограничения: `docs/backup-journal-choices-336.md`.
Полный security coverage, recovery/direct upgrades и независимый crypto review
ещё требуются до разрешённого полного деплоя3.3.6.

## Native источник Авроры: Room → общий engine → новый root

19 ноября2026. Реальный native source теперь захватывает encrypted originals,
legacy account key/cache, все immutable writer journals и mounted state. Общий
web/native validator/merger работает в отдельном headless WebView без сети,
storage/file доступа или vault/mutation bridge. Все key bytes остаются native;
engine получает только keyless capture и authenticated old plaintext. Job/owner/
scope binding, bounded chunking, cancellation/drain и current-account checks
не позволяют закончить сведение после закрытия/смены аккаунта.

5/5 native source JVM +8/8 migration JVM,3/3 API34 Room/Keystore/packaged runtime,
15/15 JS native-entry tests,1454/1454 full JS,2/2 API34 UI regressions,
typecheck/lint/web build PASS. Source fixtures включают40 sessions, retained
writer history, blocking conflict и account deactivation; originals проверены
до/после. QA package/debug signing/metadata149 сохранены. Логи и точные границы:
`e2ee-336-aurora-source.md`. В instrumentation legacy server response synthetic,
реальный signed server transport проверен отдельно раньше. Full product
bootstrap/unlock/fence/editor routing ещё не подключён; direct upgrade/recovery
этими тестами не подтверждены.

Реальные source adapters покрывают2/20 категорий: workspace и Aurora. Остальные18,
shared ACL/rotation/files/automation, product lifecycle/recovery, полная приёмка
48 сценариев/14 языков и независимый crypto review ещё обязательны. Никаких
production публикаций/миграций/повышения floors не выполнялось;3.3.5/149 остаётся
действующей версией до полного готового и проверенного3.3.6.

## Реальный источник Стойхейона на web/API/Android

19 ноября2026. Полный immutable журнал практик, previous/base/mounted copies,
расклады, замены карт и reveal/timeline history теперь читаются реальными source
adapters и сводятся общим validator/merger. Подписанный legacy read ограничен
personal owner/current device/lease/source token; не вызывает старые GET helpers
с побочными записями. Сервер и portable objects не переносят live quota/payment
authority. Ключи остаются native; общий headless runtime отдельно ограничивает
выбранный domain/object IDs. Exact originals сохраняются, конфликт/rollback/
неизвестный формат/смена аккаунта блокируют completion.

1466/1466 full JS,53 focused source/coordinator/native-entry checks,18/18 native
JVM,6/6 API34 source instrumentation (3 Stoicheion +3 Aurora),2/2 actual UI
regressions,5/5 PHP suites с10 signed web/native transport packets,
typecheck/lint/web build PASS. Actual Room/Keystore/new-root vault проверены
с40 native day records и private reflection, сохранением всех исходных ciphertexts.
Synthetic server responses в instrumentation и остальные synthetic registry
paths не выданы за whole-product acceptance. QA metadata149/debug package
сохраняются. Подробности и логи: `e2ee-336-stoicheion-source.md`.

Реальные adapters реализованы для3/20 категорий;17 остаются. Для всех также
нужны product lifecycle/editor routing, shared ACL/rotation, полное recovery/
direct upgrades/48 сценариев/14 языков и независимый crypto review. Следующий
инвентарь — личные советы, включая actual Room snapshots и legacy hashed native
SharedPreferences cache. Production3.3.5/149, floors0, cutover off и выключенный
Android deploy не менялись;3.3.6 ещё не опубликована.

## Советы: подписанный historical source read

19 ноября2026. Серверный `legacy-advice` теперь читает private preference/
selection/entry/view/dismiss history и metrics только для signed current personal
owner/device/lease/source token. Live quota, identity, sessions, tokens и keys не
выбираются; обычные helpers с publication side effects не используются.
3/3 PHP/SQLite suites PASS, включая unchanged originals, foreign/shared/revoked/
cancel/signature, empty source и oversized preference. Реальный клиентский
capture/reconciliation adapter, Advice transport vectors и new-root acceptance
ещё не готовы. Coverage остаётся3/20. Логи/границы:
`e2ee-336-advice-source.md`. Production/floors/cutover не менялись.

## Android: зашифрованный рабочий кеш советов и writer fence

19 ноября2026. Новые profile descriptors, current responses и seen markers
хранятся внутри owner-scoped Keystore/Room container с постоянным техническим
AAD. Приватные hashes/выборы не используются как новые открытые Row IDs. Exact
known v1 bytes защищаются до fetch; вся операция держит owner permit до HTTP/
commit/cleanup. Прежние ciphertexts сохраняются атомарно. Lost key, corruption,
missing primary при наличии history и malformed container не становятся пустым
кешем или новым network fallback. Старые SharedPreferences остаются read-only
для будущего полного источника и не объявляются уже мигрированными.

9/9 actual API34 cases PASS, main/test QA APK builds PASS; metadata149/package/
signing не менялись. Включены original cache functional assertions и реальные
Room/Keystore/owner/fence/key-loss cases. Нового UI/переводов нет. Логи, ограничения
API26/upgrade/глобального LocalCipher lifecycle и fixture package failure:
`e2ee-336-advice-cache.md`. Полный Advice content adapter/recovery, остальные17
paths, product routing и независимый crypto review ещё нужны. Production и
floors/cutover/Android deploy не менялись.


## Native transactions, полный Advice preferences source и public editions

19 ноября2026. Весь app-owned suspend Room code использует поддерживаемый
transaction boundary, сохраняющий запрет legacy IO при dispatcher hops,
nesting, rollback и cancellation. Restricted Room API удалён без suppression.
Consolidated main/test APK +lintDebug +21/21 JVM PASS; lint0 errors/206 warnings.
Actual API34:23/23 PASS, включая9 повторных Advice-cache cases,7 transport gates,
workspace и настоящие Aurora/Stoicheion sources. Документы и точные границы:
`e2ee-336-native-transactions.md`, `e2ee-336-advice-cache.md`.

Signed Advice read сохраняет все пять raw preferences columns. Число афоризмов
теперь также связано с source hash и persistent legacy fence;6/6 PHP suites
PASS, включая actual schema drift. Обычные entitlement-filtered helpers не
вызываются. Серверный инкремент:0596daba.

Публичные historical translations доступны отдельными content-addressed JSON
assets:9 editions ×14 languages,126 exact source files. Release pins запрещают
перезапись прежнего version directory. Загрузчик проверяет SHA-256/размер/формат,
не передаёт Cookie/Referer/selected ID и не делает fallback на новую редакцию.
Chromium157:132/132 actual HTTP/WebCrypto checks,0 console errors. Инкремент:
72647092; подробности `e2ee-336-advice-public-editions.md`.

1474/1474 full JS PASS, typecheck/web build PASS. Scoped repository lint0 errors,
4 прежних img warnings; обычный запуск также видит3 errors в чужом untracked
`demo-output`, который не менялся. После расширения web Advice transport
дополнительно38/38 migration tests PASS. Native Advice port ещё подключается.
Полный private Advice reconciliation/new-root recovery ещё не завершён;
coverage3/20,17 других categories, product lifecycle/all editor routing,
recovery/direct upgrades/48 сценариев/14-language security UI и независимый
crypto review остаются обязательными. Production3.3.5/149, floors0, cutover off
и GENESIS_DEPLOY_ANDROID=false сохранены;3.3.6 ещё не опубликована.


## Advice: web source, непрозрачный encrypted index и оба signed ports

19 ноября2026. Web adapter переносит raw preferences, historical selections,
все14 текстов точной public edition, прежние rendered copies и private metrics.
Mounted preference changes сводятся относительно base; конфликт/неизвестный
provenance/теряемый формат блокируют completion. Даты и selected IDs находятся
внутри ciphertext; новые remote IDs — UUID, поиск идёт через encrypted index.

Actual source прошёл coordinator/persist-before-IO/shadow/new-root ordinary read.
Другие registry paths в этом fixture остаются synthetic. Full JS1482/1482,
web build/typecheck/focused lint PASS. Native Advice signed port:8/8 migration
JVM PASS; PHP6/6 suites с12 actual web/native signed transport packets PASS.
Продукт не активирован, actual native Advice content capture/reconciliation
ещё подключается. Coverage3/20, full recovery/upgrades/48 scenarios/14-language
security UI и независимый crypto review всё ещё обязательны. Production3.3.5/149,
floors0, cutover off, Android deploy false сохранены. Подробности:
`e2ee-336-advice-web-source.md`.

## Native Advice: полный source и фоновые operation fences

19 ноября2026. Реальные Room current/history cache, snapshot/index/target/delivered,
known v1 bytes и mounted work переносятся общим validator в новый root. Оригиналы
сохраняются; unknown provenance/нечитаемый key/конфликт не становятся пустым
источником. Все Advice gateway/preferences/store/notification операции удерживают
owner permit, включая offline fallback; process-local owner epoch закрывает
A→B→A. Public bytes ограничены APK pins и не получают account credentials.

QA main/test APK,17/17 JVM, full JS1492/1492, typecheck/scoped lint/web build,
native lint0 errors/206 прежних warnings PASS. API34:7 новых source +23 regression
+4 UI cases PASS. API26:22 storage/fence +public timezone +old-provider fallback
PASS,84 UI состояния на14 языках/2 схемах при font1.3. API35 final31/31 PASS.
Его первый прогон выявил8 ошибок boot общего JS из-за Intl default +00:00 при
Java GMT. Исправлено канонизацией zero offset в UTC; настройки устройства не
менялись. Failed log сохранён, полный прогон повторён успешно. Подробности:
`e2ee-336-advice-native-work.md`.

Теперь4/20 реальных source категорий, остальные16 и product lifecycle/editor
routing ещё обязательны. Default global v1 provenance review, большие истории,
совместимый provider на API26, прямые signed upgrades, clean recovery, shared
rotation/files/automation, backup/Drive,48 scenarios и независимый crypto review
не заменяются этими проверками. Production3.3.5/149, floors0, cutover off,
GENESIS_DEPLOY_ANDROID=false сохранены; полного выпуска3.3.6 ещё нет.

## Личные задачи: read-only server source следующей категории

19 ноября2026. Signed `legacy-tasks` сохраняет все7 owner-scoped task/history
таблиц: content/recurrence/reminders, links/deletions, recovered ciphertext/
tombstones, exact creation state/provider operation history. Read проверяет
current device/owner/lease/source token под одним writer lock и не выполняет
внешние Google/Yandex операции или acknowledgement. Старый key возвращается
только при наличии recovered ciphertext; missing/corrupt key и большой source
дают отказ без пустого результата или удаления originals.

9/9 isolated PHP suites PASS; расширенный task-only run также PASS, включая
actual-schema completeness, expiry, foreign content, все7 write fences,
10000+ rows/oversized Unicode и key minimization. Документ/логи:
`e2ee-336-tasks-source.md`. Real web/native task adapters, offline reconciliation
и consent ещё не реализованы этим шагом; общий real-adapter coverage4/20.
Production, floors/cutover и GENESIS_DEPLOY_ANDROID=false не менялись.

Дополнительно оба signed client ports получили legacyTasks:39/39 JS migration
tests и8/8 native JVM PASS; typecheck/scoped lint/web build PASS. Actual Web Crypto/
JCA fixtures проверены PHP:14 signed web/native packets,6/6 suites PASS в
`runtime/backend-tasks-transport-03/`. Source capture/reconciliation task adapter
ещё не готов. Автоматический i18n/catalogue audit14 языков PASS; смысловая
приёмка всего будущего security/recovery UI по-прежнему обязательна.
Итоговый полный JS regression после task ports/fixtures:1492/1492 PASS,
`runtime/frontend-tasks-transport-final-full-02.log`.

## CI: изоляция billing settlement после background fences

19 ноября2026. Source checks44438783090: Android PASS, web/API остановлен
одним backend fatal в billing-settlement fixture. Старые заглушки
genesisSharedContentEncrypt/Decrypt конфликтовали с реальным wrapper,
который теперь подключает e2ee-background. Заглушки перенесены на нижний
fixture-only cipher seam; настоящий shared wrapper выполняется и проверяется
при enqueue/decrypt settlement job. Production code/queue/key logic не менялись.
Isolated `runtime/ci-settlement-wrapper-01/`: billing-settlement,
billing-deletion и e2ee-background3/3 PASS. Полный CI повторяется отдельно.
Production3.3.5/149, floors0, cutover off, Android deploy false сохранены.

## Личные задачи: реальные web/native sources и защита фоновой очереди

19 ноября2026. Перенос сохраняет exact offline task changes/deletions, recurrence/
detached identity, reminders, recovered ciphertexts/revisions и operation history.
Неизвестное происхождение, corruption, потеря key, смена account/generation,
orphan queue и delete/edit conflict не становятся пустым source. New remote
object IDs случайны; index и provider history зашифрованы. Внешняя копия требует
нового согласия, raw HTTP/keys не экспортируются из protected local snapshot.

CloudTaskSync держит owner permit через decrypt/HTTP/commit/ack; account sync
получает его перед controller mutex. Native engine не получает keys и может
открыть только exact captured recovered record с прежним owner/purpose AAD.
Дополнительная проверка нашла duplicate-key projection JSON.parse; task source
теперь отказывает decoded duplicate fields, сохраняя все original bytes.

Full JS1509/1509, actual source/coordinator/new-root56/56, actual Chromium157
IndexedDB14/14, typecheck/scoped lint/web build PASS. Native main/test APK и6/6
JVM PASS, lint0 errors/206 прежних warnings/8 hints. Финальные API34/API35:
по43/43 PASS, включая task sources, queues и regression4 прежних categories.
Логи, failed-before-fixed evidence и пределы: `e2ee-336-tasks-client-source.md`.
Fresh dependency audit0 advisories. Real source coverage5/20; оставшиеся15,
product routing/recovery/upgrades/shared/backup/48 scenarios/14-language security
UI и независимый crypto review обязательны до activation. Production3.3.5/149,
floors0, cutover off и GENESIS_DEPLOY_ANDROID=false не менялись.

Actual-producer follow-up: creation state — target hash, не JSON. Opaque states
сохраняются без интерпретации/исполнения;57/57 source/migration JS и1510/1510 full
JS PASS. Final state fixture прошёл5/5 на API34 и5/5 на API35, main/test APK +lint
PASS. API26 storage/fence/task queue25/25 PASS. Дополнительно найден файловый
Google cache вне SQL inventory/source token. Его нельзя исключить из полного
перехода; owner/file lock и read-only capture — следующий release blocker в
`e2ee-336-provider-cache.md`. Число5/20 означает adapters, не всё содержимое
каждого аккаунта. Все production flags/floors остаются выключенными.

## Серверный owner/file operation gate

19 ноября2026. Личные legacy requests удерживают owner permit до конца ответа;
signed migration/read и source hash берут исключающий permit перед SQLite writer.
Nonblocking locks исключают SQL/file lock inversion. Google cache проверяет
authoritative primary/linked owner до callback и повторно под file lock.
GET sync/tasks добавлен в общий PHP/web/worker/native private transport contract.

402/402 real HTTP PASS, policy9/9 JS +1/1 JVM, web build и focused PHP suites
PASS. Полный backend146 PASS/1 FAIL выявил отдельную проблему EC-координат
Web Push; исправление/повтор выполняются отдельно. Документ и точные ограничения:
`e2ee-336-personal-server-io.md`. Файловый source hash/read/reconciliation ещё
подключаются. Полный lifecycle, остальные15 categories, recovery/upgrades,
shared/backup/48 scenarios/14-language security UI и независимый crypto review
обязательны. Production3.3.5/149, floors0/cutover off/Android deploy false сохранены.

## Provider cache: файловый source token и оба task adapters

19 ноября2026. Exact primary/linked/current/retained ciphertext и отсутствие
файлов теперь входят в opaque source token и final commit check. Signed read
сохраняет tasks/list names/history без fingerprints/provider cursors/credentials.
Corrupt working cache больше не становится пустым. Перед grant reset сохраняется
exact original ciphertext. Direct Google APIs/token refresh тоже удерживают
owner permit; jobs/CLI не обходят scope fence.

1515/1515 full JS,62/62 source/coordinator, actual Chromium15716/16 +console0,
web build/typecheck/focused lint, PHP7/7 и402/402 HTTP PASS. Main/test QA APK
packaged, JVM7/7; API34/API35 по45/45 PASS. Финальные lint/full PHP результаты
записываются после завершения процессов. Предыдущий Web Push дефект исправлен:
fixed-width SEC1 X/Y, scalar43/31-byte Y и exact RFC8291 vector;4/4 PHP PASS.
Документы: `e2ee-336-provider-cache-implementation.md`,
`e2ee-336-personal-server-io.md`. Historical review UI/cutover deletion lifecycle,
large histories/API26 compatible provider и остальные15 categories ещё нужны.
Whole-product recovery/upgrades/shared/backup/48 scenarios/14-language security
UI и независимый crypto review обязательны до activation. Production3.3.5/149,
floors0/cutover off/Android deploy false сохранены; полного выпуска3.3.6 ещё нет.

Provider follow-up: полный backend `provider-cache-full-backend-04/`148/148 PASS,
включая ранее падавшие reminders/Web Push. Source checks44470155370 предыдущего
bde13c2b завершились success целиком, включая долгие browser scenarios; для новых
gate/provider commits запускается отдельный CI. Native lint ожидает завершения
своего процесса; packaged APK/JVM/API34/API35 не подменяют его exit status.

Native provider acceptance завершена: main/test APK +JVM7/7 +lintDebug PASS,
12m2s; lint0 errors/206 прежних warnings/8 hints. Оба эмулятора остановлены после
45/45 API34 и45/45 API35; личные устройства не использовались.

## Дневники и сны: historical server source и signed client ports

19 ноября2026. Читаются все6 private tables с проверкой device/owner/lease/token
и без обычного sync-disabled purge. Source сохраняет notes/tombstones/settings/
dream preferences/references и exact encrypted originals; old keys выдаются лишь
для existing notes. Тариф не превращается в право пропустить historical content.
7/7 PHP suites,16 actual web/native signed packets,40/40 JS migration и8/8 JVM
PASS; focused lint PASS. Документ: `e2ee-336-diary-source.md`.

Реальный diary reconciliation ещё не завершён: local_only privacy marker не
означает удаление. Записи «только на устройстве» должны остаться локальными при
переходе и не попасть в cloud plan без нового согласия. Для этого проектируется
отдельный protected local output plan; его реализация/acceptance ещё обязательны.
Coverage5/20, остальные15 categories/full lifecycle/recovery/upgrades/shared/
backup/48 scenarios/14 languages/independent review остаются до activation.
Production/floors/cutover/Android deploy не менялись; полного выпуска3.3.6 ещё нет.

## 19 ноября: device-only migration output

Отдельный localContent plan реализован и проверен в обоих coordinators и native
bridge: данные «только на устройстве» не превращаются в remote envelopes.
Journal protocol2 сохраняет local manifest/256KiB parts атомарно в device vault,
проверяет их перед verify/commit/retry и допускает корректный signed zero-upload
plan. Protocol1 resume сохранён. Нормальное чтение требует active/unlocked.
Recovery требует сохранённого device ciphertext; cloud recovery не является
backup local-only bytes. Документ: `e2ee-336-local-output.md`.

Evidence: full JS1528/1528, focused69/69, PHP6/6, Chromium20 checks/console0;
QA APK/JVM/lint build16m10s PASS. JVM1154 passed из1162,8 opt-in HTTP skipped,
failures/errors0. API34/API35 по48/48 instrumentation PASS; это не исходные48
сценариев всего продукта. Линтер0 errors/206 existing warnings/8 hints.
Сохранены failed-before-fixed logs и ограничения recovery/product lifecycle.

Source checks44477260699 на ecd2c379 завершён success: web/API и Android.
Coverage всё ещё5/20: diary source transport готов, client adapter ещё в работе.
Production3.3.5/149, floors0, cutover off, Android deploy false; выпуск не объявлен.

## 19 ноября: real diary web/native source и private local placement

Завершён следующий source increment: actual web/native diary capture, shared strict
reconciliation и current-generation readback. Все6 SQL tables, web owner caches/
closed-tab/upload drafts, native current/dangling Room chunks, old pending envelopes,
сны, advice snapshots и metadata сохраняются. Local-only privacy не означает delete:
данные/черновики/editor state остаются в device-only output, без cloud upload или
replay старых requests/acknowledgements. Conflicts требуют exact review.
Native repository держит owner permit до repo mutex через decrypt/HTTP/journal;
gateway дополнительно привязан к session generation/workspace epoch.

Evidence: full JS1543/1543, focused96/96; typecheck/scoped lint/web build PASS.
Native QA build main/test/JVM/lint12m6s SUCCESS. JVM1167 tests:1159 passed,
8 opt-in PHP HTTP skipped, failures/errors0. Actual API34 и API35 по54/54 PASS,
включая6 diary cases; это не исходные48 whole-system acceptance scenarios.
Chromium157 report05:26 checks PASS, console0, actual IndexedDB/WebCrypto,
coordinator/saved recovery/ambiguous commit retry/cold normal scope read без oldkeys.
Доказательства и failures-before-fixes: `e2ee-336-diary-implementation.md`.

Source coverage6/20; product lifecycle/normal writes/review UI, остальных14
categories, archives/local-only backup/Drive, shared rotations/files/automation,
global LocalCipher lost-key protection, direct upgrades/clean recovery/original48,
14-language security UI/independent crypto review остаются обязательными.
Production3.3.5/149, floors0, cutover off, GENESIS_DEPLOY_ANDROID=false.
Релиз3.3.6 ещё не выпущен.

## 19 ноября: полный signed historical source личных mindmaps

Серверный legacy-mindmaps read отдаёт все4 owner tables: current maps, versions,
receipts и tombstones. UI LIMIT20 здесь не применяется; old key только при
ciphertext. Header/lease/source/device/signature/owner gates сохраняются. Действия
создания Google tasks, receipt replay и cleanup не вызываются.

4/4 первоначальных PHP suites PASS; final source/transport5/5 PASS с actual18
WebCrypto/JCA packets, actual-schema/25 retained versions, Unicode/count limits,
foreign owner/revocation/tamper/fences/key corruption и no-source-change checks.
Web migration52/52, native migration JVM13/13 без skips, full JS1543/1543,
types/scoped lint PASS. Объединяющая lifecycle-сборка ещё проверяется отдельно;
partial build не объявляется финальным native acceptance.

`e2ee-336-mindmaps-source.md` фиксирует предел: actual client adapter/capture всех
local/view/conversion/request/drafts/editor/history и normal routing ещё в работе.
Coverage6/20; production3.3.5/149, floors0/cutover off/Android deploy false сохранены.

## 19 ноября: исправление full-project lint и повторный CI

CI44493179690/bd706ca3: Android success; web/API остановился на lint из-за unused
body в новом synthetic diary test. Переменная убрана. Diary15/15 PASS;
full project lint0 errors/4 existing image warnings PASS, локально исключён только
чужой untracked demo-output без изменения/добавления его в Git. Этот CI не прошёл
web/API/browser этапы, его нельзя считать общим success. Повтор запускается на
исправленном head с новым signed mindmaps source.

## 19 ноября: большие historical sources без обрезания

Серверный `legacy-physis` читает все4 owner tables без bootstrap/entitlement/
prune. Старые tombstones, used IDs и raw vault/envelope/receipt JSON сохраняются.
32MiB ФЮЗИС и40,000,000-byte history личных mindmaps больше single-message cap:
добавлены signed table/offset pages с exact totals и explicit continuation, под
неизменным owner/device/directory/session/lease/source/file/SQLite gate. Старый
small-source mindmaps contract сохранён. Независимый v1 vault не считается пустым
или автоматически разблокированным; account-v2 получает только pre-existing key.

`paged-personal-source-server-04/`:4/4 PHP PASS, включая actual schema/all raw
columns, >16MiB Physis,253 retained IDs/128-row boundary,50 map versions >16MiB
и ниже реального40MB cap, signed offset tamper/foreign/revoked/fence/no mutation,
ordinary Physis security и существующий actual18 WebCrypto/JCA packet contract.
Клиентские collectors и новые cross-platform page packets проверяются отдельно.
Документ: `e2ee-336-paged-personal-sources.md`. Coverage остаётся6/20; всех
product/recovery/upgrades/shared/backup/original48/14 languages/independent review
gates это не заменяет. Production3.3.5/149, floors0/cutover off/Android deploy false.

Source checks44498325136 на0d596974 завершились **success**: web/API и Android,
включая lint/types/build/backend/browser. Это проверка предыдущего committed head;
новые LocalCipher/page changes требуют своей отдельной приёмки и CI.

## 19 ноября: общий LocalCipher guard от автоматической замены потерянного ключа

Все потребители LocalCipher теперь разделяют durable alias witness в noBackup и
nonblocking cross-process creation lock. Старый valid key принимается без замены;
потерянный witnessed alias не генерируется заново. Для старых установок inventory
проверяет Room/prefs/backup XML/file drafts/import staging без private columns и
без deleting SQLite corruption handler. Обнаруженные данные или ошибка inventory
оставляют durable denial даже после чужой последующей очистки. Decrypt read-only.
Startup готовит ключ вне exclusive Room writer; ошибка сохраняется как redacted
problem, данные/БД не сбрасываются. Это не backup потерянного Keystore key.

`native-key-lifecycle-build-04.log`: BUILD SUCCESSFUL25m2s, main/test QA APK/JVM/
lintDebug; lint0 errors/206 existing warnings/8 hints. JVM1167 total/1159 passed,
8 opt-in real-PHP HTTP skipped, failures/errors0. Actual API26:14/14 lifecycle;
API34 и API35:68/68 каждый, включая14 lifecycle +54 source/storage regressions.
Личные устройства не затрагивались; все эмуляторы остановлены. Документ и exact
logs: `e2ee-336-local-key-lifecycle.md`. Global lost-key UX/emergency export,
общий lifecycle/recovery/upgrades/остальные14 adapters/shared/backups/original48/
14 languages/independent crypto review ещё обязательны до активации и выпуска.
Production3.3.5/149, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены.

## 19 ноября: signed page ports и оба client collectors

Web/Kotlin подписывают table/offset вместе с owner/device/lease/checkpoint.
Оба collectors проверяют exact response/header/generation, неизменные totals и
old-key identity, consecutive offsets и explicit EOF. Short/empty/tampered page
не считается полным источником; aggregate/page/row limits явные и безопасные.
Private row schemas/locked vaults по-прежнему проверяет соответствующий adapter.

79/79 focused web PASS, native collector3/3 +migration13/13 JVM PASS; общий
native build01 main/test/JVM/lint19m8s SUCCESS. Actual22 WebCrypto/JCA packets
собраны без синтеза signatures; PHP26 assertions включают4 tampered offsets.
`mindmaps-source-server-05/`:7/7 PHP PASS. Документ:
`e2ee-336-paged-personal-sources.md`. Сам map adapter отдельно проходит приёмку:
в первом instrumentation73 cases один новый fixture использовал разные outer
field keys; исправление и повтор обязательны. Coverage пока6/20, product/
large-source/recovery/upgrades/shared/backups/original48/14 languages/independent
review gates сохраняются. Production3.3.5/149 и все release/cutover flags прежние.

## 19 ноября: personal mindmaps web/native source increment

Завершён source capture/reconciliation/readback личных maps: все4 signed tables,
каждая retained version, cache/closed-tab draft/request, view/conversion journals,
mounted forms и undo state. Graph validation не нормализует/не теряет optional
empty fields. Images вынесены в отдельные attachment objects с существующим
file-key/chunk/manifest protocol. Новые logical IDs случайные; имена/refs/alt text
остаются внутри ciphertext. Dirty/uncertain/editor work — только device-local,
старые provider/conversion commands не исполняются. Tombstone/выбор отсутствия
не загружает stale cached plaintext повторно. Conflicts требуют exact review.
Native owner permit действует до repo mutex через decrypt/HTTP/journal/ack;
сессия связана с generation +workspace epoch. Old keys остаются native.

Full JS1583/1583, Chromium15786 checks/console0, actual IndexedDB/WebCrypto/
saved recovery/ambiguous commit retry/cold scope reading25 versions и exact image
без old key; PHP7/7 с actual22 signed packets +4 offset tamper, types/full lint/
web build/automated14-language audit PASS. JVM1174 tests/1166 passed/8 opt-in
HTTP skipped/0 failures. Native main/test/JVM/lint build01 SUCCESS19m8s; после
исправления отдельного test key mismatch build02 SUCCESS2m2s. API34 и API35:
73/73 каждый PASS. API26:17/17 JCA/key-loss/old-WebView fallback; это не source
migration на Chromium69. 84 fallback PNGs сохранены; supported-WebView API26
migration ещё не проверена. Все эмуляторы/браузеры/loopback servers остановлены.

`e2ee-336-mindmaps-implementation.md` фиксирует точные limits: native16MiB capture,
bridge/cursor large-data integration, product bootstrap/unlock/freeze/normal writes,
source-review UI/OS savers и alias-loss recovery ещё нужны. Coverage adapters7/20,
не процент готовности релиза. Остальные13 adapters/shared/files/automation/
archives/Drive/local-only backup/direct upgrades/original48/14-language semantics/
independent crypto review остаются до activation/release. Production3.3.5/149,
floors0/cutover off/GENESIS_DEPLOY_ANDROID=false; полного деплоя3.3.6 ещё нет.

## 19 ноября: native result streaming для больших историй mindmaps

Снят single-message output cap16MiB для packaged source. JS передаёт256KiB parts
с backpressure; native проверяет exact fields, placement/domain/object ID,
sequence/size/EOF и локальную checksum до публикации. В HTTP plaintext hash не
добавлен; existing new-root/file-key/chunk/manifest crypto сохранён. Failed или
отменённый transfer не публикуется; повторный finish/late part не стирает уже
переданные coordinator bytes. Native old-WebView gate проверяется до bulk input.

Full JS1587/1587, typecheck/scoped lint PASS. Native build02 SUCCESS18m8s после
исправления Int/Long comparison; JVM1180 tests/1172 passed/8 opt-in HTTP skipped,
0 failures; lint0 errors/206 existing warnings/8 hints. Actual API34/API35:
74/74 каждый, API26:18/18 appropriate key/JCA/old-provider cases, failures/skips0.
25-version result17,644,546 bytes прошёл на API34/35 с normal192MiB Java heap:
old source intact, exact final note/history/images read with new root after old
key/alias removal. API26Chromium69 — только fallback/refusal, не successful
migration. Сохранены84 PNGs; visually inspected RU dark/EN light at font1.3,
all14-language fallback assertions passed. Все3 emulators остановлены.

Evidence/точные limits: `e2ee-336-native-source-stream.md` и runtime summaries02.
Native16MiB local capture, single Room row/CursorWindow, bulk remote/input
aggregation и alias loss between prepare/reconcile ещё требуют acceptance.
Coverage7/20 не изменился; full product/recovery/upgrades/shared/backups/original48/
14-language semantics/independent crypto review обязательны. Production3.3.5/149,
floors0/cutover off/GENESIS_DEPLOY_ANDROID=false; release/version bump не выполнен.

## 19 ноября: native late-alias-loss recovery для diary/mindmaps captures

Новые native captures сохраняют старый account key рядом с exact old wrapper
внутри snapshot, который coordinator защищает new root до первого source IO.
Новый root/private device/Keystore keys этим не экспортируются. Перед packaged
JS engine current и ancestor captures клонируются без old plaintext key; native
opening capability по-прежнему ограничен exact retained envelope+purpose.
Старые snapshots без added key требуют original LocalCipher; malformed key и
противоречивая key history не превращаются в пустую миграцию и блокируют IO.

Build01 SUCCESS17m21s, main/test APK/JVM/lint; JVM1184 tests/1176 passed/8 opt-in
HTTP skipped/0 failures, lint0 errors/206 existing warnings/8 hints. Actual
API34/API35:76/76 каждый, API26:18/18 appropriate key/JCA/old-provider cases.
Оба новых actual cases сохраняют snapshot в Room under new root, удаляют только
собственный fixture alias и old raw bytes до source read, создают fresh adapter
и завершают reconciliation без server-provided old key. New content читается
new root, old rows exact, replacement alias отсутствует, old key не попадает
в JS/current/history outputs. Previous large-history case также PASS.

Документ/точные bounds/evidence: `e2ee-336-retained-native-old-keys.md`, runtime
summaries01. API26 Chromium69 — только fallback/refusal, не packaged migration;
сохранены84 PNGs и hashes. Все3 emulators остановлены. Source coverage7/20;
product unlock/freeze/normal writes/review/OS saves, large local captures, clean
recovery/direct upgrades, остальные13 sources/shared/backups/original48/
14-language semantics/independent crypto review ещё обязательны до release.
Production3.3.5/149, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены.

## 19 ноября: исправление cold mindmap bootstrap и обычная web-приёмка

CI44515254641 выявил regression second-client/direct map URL: layout registration
нового migration editor проверяла workspace key до bootstrap и выбрасывала ошибку
в view boundary. Регистрация теперь только сохраняет callback и отвергает disposed
repo; настоящий capture по-прежнему проверяет current unlocked owner **до** callback.
Browser console и before screenshot подтвердили причину. Новый тест падает на
прежнем коде, проверяет zero callbacks locked/foreign и закрытый repo.

33/33 focused source/operation checks,1588/1588 full JS, types/scoped lint/web build
PASS. Native assembly24s SUCCESS: оба QA APK byte-identical прежней принятой
revision; actual native76/76 API34/35 и18/18 API26 не заменяются новым непроверенным
артефактом. Документ: `e2ee-336-mindmaps-cold-start.md`.

Первый local browser run неверно использовал bundle с disabled mindmaps; второй
с correct flag воспроизвёл настоящий cold regression. Run03:120/121, единственный
отдельный habit-import readiness сбой. QA отправлял файл программно, минуя
disabled picker до открытия encrypted journal. Добавлено ожидание enabled control,
все preview/apply/write assertions сохранены. Actual original/changed backup parse
PASS. Final run04:121/121 Business/global trial/header checks плюс startup4/4 и
observer control PASS, compiled bundle hash unchanged, fixture cleanup PASS.
Картографические UI states360/390/768/1440 light/dark проверены; две after-images
осмотрены. Это не full five-plan local acceptance; свежий remote CI обязателен.

Отдельный Android job старого CI остановился до compilation на KSP resolution;
та же pinned version есть в previous successful CI/current local builds. Не меняем
зависимости/workflow по этому сбою. Coverage7/20, оставшиеся source/product/
recovery/upgrades/shared/backups/original48/14-language semantics/independent
crypto review gates сохраняются. Production3.3.5/149, floors0/cutover off/Android
deploy false;3.3.6 не объявлена выпущенной.

Source checks44535117678 на2af7cc42 завершились **success** целиком: Android и
web/API, включая browser scenarios. Metadata сохранена в runtime
`source-checks-44535117678-final-01.json`. Это acceptance cold-start исправления;
следующим Physis-инкрементам соответствуют свои локальные проверки и новый CI.

## 19 ноября: строгие старые Physis readers web/native и карта остатка

Добавлены read-only primitives обоих реальных форматов Physis: независимые
password/PHY1 recovery v1 и account-v2. Exact fields/целые числа/canonical base64,
fixed PBKDF2-SHA256600000/salt16/IV12/size limits проверяются до открытия ключа;
неверный/отсутствующий/отменённый independent secret не заменяется account key
или пустыми данными. Web key nonextractable/decrypt-only. Native owner/epoch-bound
Reader хранит DEK только внутри native API, работает с оригинальным AAD и отдаёт
исходный UTF-8 текст для общего strict duplicate-name parser. Typed JSONObject
boundary сам по себе не доказывает отсутствие дублей в raw legacy JSON.

Native PBKDF2 использует уже закреплённый BC1.87 off main thread; UTF-16 password
encoder явно совпадает с WebCrypto TextEncoder, включая unpaired surrogates.
Owned mutable buffers очищаются, закрытый/account-invalidated Reader не выдаёт
данные; ограничения immutable strings/internal crypto copies описаны честно.
Нет bootstrap/rotation/write/new-key export или произвольного native JS port.
Неизвестные ошибки credential provider не отражают секрет в сообщении.

Actual WebCrypto legacy fixture и11/11 focused cases PASS;1599/1599 full JS,
typecheck/scoped lint PASS. Native build01 SUCCESS15m57s:1196 JVM cases,
1188 passed/8 opt-in HTTP skipped/0 failures; новые12/12 PASS. Lint0 errors,
206 existing warnings/8 hints, new reader findings0. После последней web-only
redaction assembly02 SUCCESS39s; оба APK byte-identical accepted build01,
новая source identity записана. QA native hash дополнен фактическими fixture
assets из tests/fixtures, чтобы изменение vectors не обходило input identity.

Actual API26/API34/API35: по4/4 новых Physis +2/2 existing envelope provider
cases PASS (6/6 каждый),0 failures/skips. Проверены old password/recovery/account
wrappers, Unicode, owner changes, substitution, canonical recovery, полный
256KiB record и сохранение duplicate JSON text для shared parser. Это не
packaged-source migration на API26; Chromium69 всё ещё ниже accepted minimum.
Все3 task-owned emulators остановлены; personal devices/Play/production не менялись.
Подробности и точные evidence paths — `e2ee-336-physis-legacy-reader.md`.

Static web build PASS:98 public HTML variants/14 languages, exact locale
dictionaries,280 gallery images и offline precache; этот reader пока не включён
в обычный product routing. Финальный native source hash после всех проверок
совпал с записанной identity02, APK inputs не изменены.

Source adapters остаются7/20: это primitive, а не готовый Physis capture/merge.
Ещё нужны memory keys/pending/uncertain rotation/mounted forms под owner fence,
все4 signed server tables, tombstone/conflict reconciliation и new-root readback.
Остальные13 categories и весь product/recovery/upgrades/shared/files/backups
охват по-прежнему обязательны. Новая матрица
`security-336-acceptance-matrix.md` сверена по всем48 исходным ID; отдельные
unit/source проверки не превращены в полную системную приёмку. Подготовлен
`security-336-external-review-brief.md`; независимый human/organization review
не проведён, материалы никому не отправлялись.

Fresh pnpm audit exit0/all severities0. Повторная проверка GitHub установила,
что исходная high GHSA-fc5q-39xc-vjpf была withdrawn18 ноября15:38:56Z;
это не suppression и не объявление той же версии picomatch исправленной.
Evidence и первоначальный finding сохранены в dependency review. Production
3.3.5/149, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены;
версия3.3.6 и полный Deploy ещё не выпущены.

## 19 ноября: Physis normal operations под полным owner permit

Actual PhysisMemoryStore теперь удерживает один owner Web Lock от staging
optimistic records/pending до encryption, paged read/decrypt, borrowed HTTP,
acknowledgement и cleanup. Internal flush/reload/rotation не получают новый
shared lock за ожидающим exclusive migration. Уже допущенные saves дренируются
вместе; более поздние операции ждут до любых изменений памяти. Preparing/active
marker запрещает их без queue/HTTP side effects. Factory привязана к validated
transport owner/session generation, не требует workspace key для independent
Physis key. Submitted records/vault text копируются до ожидания lock.

Late account/logout response больше не публикует stale error state и не очищает
pending/rotation. Existing exact uncertain retry/ciphertext/rotation semantics
сохранены. Explicitly injected peers по-прежнему используют свои IO/session ports;
единственный product constructor использует actual factory. Новый plaintext
storage или durable Physis queue не добавлены.

Existing Physis33/33, новые real cloud/store/WebCrypto/gate VM12/12 и focused
набор35/35 PASS. Initial32/34 run сохранил две ошибки fixture: second save был
допущен до фактической постановки exclusive lock после async preflight, и
cross-realm array сравнивался без нормализации обеих сторон. Final run02 явно
проверяет pending exclusive request и дополнительно покрывает opposite ordering:
оба ранее допущенных saves завершаются до capture, без deadlock/lost queue.

Full JS1611/1611, typecheck/scoped lint и static web build PASS. Native reassembly
SUCCESS34s; main/test APK byte-identical принятому Physis reader build01, source
identity обновлена. Новые native tests не требовались для тех же APK: existing
API26/34/35 по6/6 остаются привязанными к exact hashes. Подробности и evidence:
`e2ee-336-physis-operations.md`; native identity/comparison — runtime
`physis-operation-native-*-01.json`.

Это normal legacy writer exclusion, не готовая Physis source migration. Новые
Chromium/IDB и полный authenticated Physis UI journey этим VM-набором не
подтверждаются. Capture всех forms/keys/pending/rotation, reconciliation4 tables,
new-root readback, bootstrap/unlock/close/recovery и весь оставшийся13-source/
shared/files/backup/original48/14-language/independent-review охват обязательны.
Production3.3.5/149, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены;
выпуска3.3.6 и публикации в этом инкременте нет.

## ФЮЗИС: полный source capture/reconciliation и чтение с новым root,19 ноября

Добавлен восьмой реальный source adapter: `personal.physis`, web и native.
Owner-only signed pages всех4 retained tables сводятся с реальными memory stores,
очередями, удалениями, точными uncertain request/ciphertext IDs, обоими ключами
незавершённой ротации и44 читателями mounted/detached форм в12 исходных файлах.
Snapshot сохраняет old keys только в локальном protected source journal до IO;
новые remote/local output placements их не содержат. Необранные варианты,
исходные receipts, requests и формы остаются device-local history-only; старые
мутации не replayed. Locked/unknown/corrupt/неполный источник не становится empty.

Navigation сохраняет модель/детаченные формы в памяти активной сессии, logout
закрывает её. Open/bootstrap/unlock/account wrapping и первая reload получили
один owner permit с borrowed HTTP/crypto; queued exclusive migration не создаёт
nested-lock deadlock. Асинхронные form/file/import tasks запрещают capture до
своего завершения; глобальная product freeze/review/new-format editor UI ещё нужна.
Used ID без row и без ненулевого pruned checkpoint теперь останавливает перенос:
сначала regression воспроизвёл неправильное принятие, затем прошёл с исправлением.

Native фиксирует отсутствие собственного Physis repository явно, но читает
серверный vault. Room/LocalCipher authority сохраняется под новым root и не
попадает в isolated JS; capability ограничена точным captured vault/records и
закрывается после job/account change. Shared strict parser видит raw originals.
Независимый v1 recovery остаётся native. Вывод передаётся частями с backpressure.

Focused Physis69/69, full JS1628/1628, types/scoped lint/web build PASS. Настоящие
Chromium/React формы, WebCrypto, IndexedDB и signed coordinator —29 assertions
PASS: detached профиль/некорректная числовая строка, protected capture до IO,
уничтожение старой модели, uncertain commit/restart, cold unlock/new-root readback,
оба варианта и инертная исходная queue. Старые plaintext/keys/recovery secret
не появились в signed transport/IndexedDB.

Native build01 SUCCESS17m38s, build02 SUCCESS2m32s, final build03 SUCCESS1m52s.
JVM1202 total /1194 passed /8 прежних opt-in HTTP skipped /0 failed,217 suites,
включая6 новых. Lint0 errors/206 прежних warnings/8 hints; new source findings0.
API34 и35: по7/7 PASS (6 Physis +1 existing Mindmaps source), failures/skips0.
Проверены native account-v2/recovery-v1, actual Room/Keystore/new-root storage,
alias-loss resume, duplicates, account switch и local recovery history>16MiB.

Initial device runs4/6 каждый выявили synthetic fixture mismatch: Android
JSONObject.quote экранирует `/` внутри base64 DEK, а исходный WebCrypto format
имеет ровно46 plaintext/62 cipher bytes. Исправлен fixture с явным46-byte assert;
строгий reader сохранён. Main APK после этого byte-identical build02, test APK
обновлён; весь набор повторён. Final main SHA256
`C77B032005E52320B2B81F7D3CE3078E4C6BA452230E0CD025554E7335465398`, test
`E853769C3269A11B699898AD417AC335E9BE85D71F06E6F02164B9A60494E935`.
Эмуляторы остановлены. Source checks44546379203 на предыдущем2361d28f полностью
SUCCESS, включая Android и web/API/browser; это не CI нового незакоммиченного кода.

Точные evidence/ограничения — `e2ee-336-physis-source.md`. Coverage8/20 является
счётчиком source categories. Остальные12, полные product lifecycle/security UI/
normal writes/restore forms, API26 compatible runtime, большие совокупные captures,
shared/files/automation/archives/Drive, recovery/direct upgrades, исходные48,
14-language semantic acceptance и independent human crypto review остаются.
Production3.3.5/149, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены.
Выпуска, Deploy, Play upload или установки на личное устройство не было.

## Напоминания: девятый source и начало архивов,19 ноября

`personal.reminders` теперь захватывает реальные owner web keys,3 worker caches,
display/data payload уже показанных notices, mounted/detached формы, raw numeric
input/notes/operation IDs; native — все Room states,5 SharedPreferences registries
и2 raw moon DataStore values. Все6 retained server tables читаются owner-only
signed lease pager без ordinary scheduling/prune. Original server-at-rest plan/
target JSON сохраняет duplicate names для strict parser. Push grants и старые
jobs/actions не становятся executable output: их полная история и исходные
requests остаются device-local под новым root, scheduling требует fresh consent.

Normal web/native reminder writers удерживают owner permit до OS effects и
финальных receipts. Offline local settings сохраняются без разрешения socket;
known remote privatePreferencesMode отказывает даже без local deny marker.
Verified native bootstrap импортирует target owner до activateAccount с прежним
session/generation proof, не принимает текущий UI scope за incoming identity.
Rechecks после scheduler/DataStore waits не позволяют выполнить stale callback
в новом workspace. Worker capability2 подтверждает только guarded main sw.js;
cache ordering не создаёт nested queue/lock deadlock.

Real device QA выявила и закрыла две integration ошибки: account switch при
startup restore падал как unhandled background exception, а supported WebView
не разбирал `genesis://` hostname как desktop URL. Expected scope/fence refusal
теперь отменяет только coroutine; exact Android URI attribution не зависит от
custom-scheme URL normalization. Исходные failed runs и red/green сохранены.

Final JS1668/1668, types10, scoped eslint06 и changed-module eslint07 PASS;
у scoped lint4 прежних img warnings. Actual Chromium/React/WebCrypto/IDB/Web Locks
source29 assertions PASS, final bundle byte-identical accepted browser02. Web
build04:98 public HTML variants/14 languages, exact dictionaries,280 gallery images
и offline precache PASS. Native build03 SUCCESS23m52s,04 SUCCESS27m35s, final
JS-only repack05 SUCCESS44s. JVM1209 total/1201 passed/8 прежних opt-in HTTP skipped/
0 failures; native lint04:0 errors/206 warnings/8 hints. После04 Kotlin/resources
не менялись, test APK byte-identical; повтор native lint для JS-only fix не заявлен.

API34/35 final: по22/22 PASS (8 source/guard/bootstrap +1 Physis regression +
11 importer +2 reminder flows); API26 GuardOnly17/17 PASS. Это61 фактический
instrumentation scenario,0 failures/skips, не full authenticated product QA.
Проверены >16MiB history/stream/backpressure/new-root readback, сохранение точных
форм/requests, account changes и вход в incoming owner. Main APK SHA256
`55BB544071660F1739F8169301D3A0AE1839F53CCF2757ACA1A98BBED75CD0FF`, test APK
`B94B83C1F9B8488024441704E806CC2CE90536619C8DADD296CAA9730DBBD05A`.
Все3 task-owned эмулятора остановлены, CDP forwards закрыты. Точные evidence,
предыдущие failures и ограничения: `e2ee-336-reminders-source.md`.

Начат следующий `personal.archives`: backend owner-only signed reader всех3
retained backup tables, original+decoded JSON, expired copies/uncertain restore
receipts без restore/prune. Для large row добавлен opt-in signed byte transport:
1MiB fragments, точные offsets/totals/length/hash, до64MiB row, source/lease
recheck каждого fragment. Existing generic8MiB cap не ослаблен, проверен полный
join5MiB original payload с его encrypted wrapper. Backend03:3/3 PASS, включая
reminders/shared-owner boundaries. Web/native collector/local capture/strict
reconciliation/new-root recovery ещё не реализованы; это не десятый adapter.
См. `e2ee-336-archives-source.md`.

Coverage теперь9/20; остальные11 sources, full product routing/freeze/review/
normal new-format writes/form restore, shared ACL+rotation/files/automation,
archives/Drive/clean recovery/direct signed upgrades, aggregate limits, исходные48,
14-language semantic/full visual acceptance и независимый human crypto review
остаются обязательными. Production3.3.5/149, floors0/pilot/cutover off и
GENESIS_DEPLOY_ANDROID=false сохранены. Полного3.3.6 Deploy/Play/personal-device
выпуска этим инкрементом не было. Предыдущий CI44560437459 на2f3d77bc SUCCESS;
новый CI44585970905 на1cff2407 остановился: lint обнаружил unused helper только
в новом тесте, Android job не смог разрешить KSP2.3.12 до компиляции. Helper
удалён; локальный lint расширен на tests/scripts. Official plugin marker и Maven
artifact повторно доступны HTTP200; зависимости/workflow не меняются. Failed logs
сохранены, полный новый CI ещё должен пройти.

## Архивы: полный fragment transport и реальные межплатформенные подписи,19 ноября

Web collector собирает64MiB rows из bounded1MiB fragments, проверяет стабильные
owner/lease/source/header/totals/key provenance, offsets/EOF, полный SHA256,
fatal UTF-8 и duplicate-name parser. Original nested JSON и uncertain IDs остаются
точными; receipt/empty rows не принимают старый ключ, native opaque mode явный.
На ошибках/account change owned byte buffers очищаются. Total128MiB/wire192MiB/
10000 requests остаются явными пределами; больших sources не усекать.

Web/native signed archive API добавлены в actual WebCrypto/JCA emitters и PHP
verifier. Regenerated fixture содержит24 реальных signed packets; PHP дополнительно
проверяет6 подмен offsets. Backend04:3/3 PASS; JVM E2eeMigrationTest13/13 PASS;
focused JS после fixture87/87 PASS. Full JS1703/1703 пройден до regeneration
fixture, а не заявлен повторённым после неё. Types03/scoped lint04 PASS.
Web build01 PASS:98 HTML/14 языков, exact dictionaries,280 gallery/offline assets.
Native reassembly SUCCESS1m23s: main SHA256
`671DACC2C8F9E0F1B0B6AFCE296F42D1F12474A63B72484D0CAF442610E2C7A6`, test
`A2974FDBE31981ADB45C7F11155A2C90AEEC7EA6655002D003BFB993E7248FC4`.

Это transport increment. Actual archive local/native capture, nested reconciliation,
normal operations, new-root recovery/readback ещё не завершены: coverage9/20.
Точные evidence/ограничения — `e2ee-336-archives-source.md`. Production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены. Ни Deploy,
ни Play, ни личные устройства не затрагивались. CI44588254949 на163d05e3:
Android SUCCESS, web/API до browser stage PASS; browser job ещё выполняется.

## Архивы: protected web input и native operation exclusion,19 ноября

Actual web BackupPanel сохраняет выбранный File целиком, key input, preview,
choices и точные uncertain operation IDs при навигации. В source inventory входят
raw owner storage originals, включая malformed/duplicate JSON, и memory-only
safety после quota failure. До завершения операции/React commit capture отказывает;
account/session/state/File/storage rechecks не допускают смешанный snapshot.
Это protected input primitive; old keys ещё не должны попадать в будущий output.

Web regression24/24, full JS1719/1719 после regenerated signed fixture, types и
scoped lint0 errors/4 прежних img warnings PASS. Build:web PASS:98 HTML/14 languages,
exact dictionaries,280 gallery/offline assets. Actual Chromium157/React/File/
WebCrypto/IDB14 assertions PASS, console0; после detach/encrypted capture и удаления
оригиналов fixture cold unlock вернул точные file/form/history/memory safety.
Оба снимка просмотрены. Это не приёмка полного product restore/design.

BackupNativeStore/BackupSafetyStore теперь удерживают owner permit до завершения
crypto/HTTP/generation/safety writes и reset acceptance. Same-UID relogin не
реанимирует старый gateway; nested calls не deadlock за ожидающей migration.
Build01 full JVM1209 total/1201 passed/8 opt-in HTTP skipped/0 failed;
final build02 SUCCESS20m41s, focused backup JVM21/21, lint0 errors/206 warnings/
8 hints. Final API34 actual Room/DataStore/Keystore/SAF/journal flows10/10 PASS.
Два initial failures были test fixtures (JUnit Boolean result/old package guard),
они исправлены без ослабления production boundary. Полный multi-call native
Backup WebView job и native selected-file/forms capture ещё нужны.

Evidence/identity/limits: `e2ee-336-archives-local-capture.md`. Отдельный task-owned
AOSP Android8 AVD получил проверенный official compatible WebView113 с PUBLIC
development QA подписью и code-free provider resource overlay. Product guard111
не менялся; весь выбранный reminders source набор22/22 PASS, failures/skips0.
Включает actual source/history>16MiB/new-root readback, Physis old-key-loss,
11 importer и2 reminder regression cases. Это не все9 sources/не полная OEM
матрица и не authenticated product acceptance. Происхождение,
initial QA failures и ограничения: `e2ee-336-api26-supported-runtime.md`.

Coverage остаётся9/20; native archives/reconciliation/recovery, остальные11
sources, full lifecycle/normal writers/forms, shared ACL+rotation, Drive/direct
upgrades, исходные48/14-language semantics и independent human crypto review
остаются обязательными. Production3.3.5/149, floors0/pilot/cutover off и
GENESIS_DEPLOY_ANDROID=false сохранены. CI44588254949 на163d05e3 завершился
SUCCESS; новый CI44600100480 наbf8749d8 ещё выполняется. Ни Deploy, ни Play,
ни установки на личное устройство этим инкрементом не было.

## Архивы: native raw fragments и общий строгий parser,19 ноября

Native collector проверяет signed-source context/header/totals/old-key provenance,
полную length/hash/UTF-8, последовательность fragments и явный EOF. Raw row JSON
до общего parser остаётся точным текстом; JSONObject не может скрыть duplicate
private fields. Shared normalization принимает только opaque old-key capability,
не создаёт complete/restore authority. Limits64MiB row/128MiB source/192MiB wire/
10000 requests остаются явными; превышение не приводит к truncation/empty.

JVM collector/pages/migration29/29 PASS, включая13 новых collector cases;
main compilation01 SUCCESS8m22s, emitter02 SUCCESS45s. Actual JCA collector output
с Unicode byte splits прочитан common TypeScript parser:6 assertions PASS,
4 exact rows, duplicate/raw-key refusal. Focused JS41/41, types01/scoped lint02
и build:web01 PASS. Полный новый JS/native assembly/device/lint collector этим
инкрементом не заявляются. Source docs содержат точные identity/evidence.

Это transport increment: coverage всё ещё9/20. Полный native inventory/forms,
strict nested archive reconciliation, old-key-loss/new-root recovery и остальные
системные release gates остаются обязательными. Source production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false не менялись. Ни Deploy,
ни Play, ни личные устройства не затрагивались.

## Архивы: полный native backup job,19 ноября

Caller-selected native permit теперь охватывает всё действие BackupPanel: picker,
local capture/crypto, nested RPC/HTTP, safety/generation/history writes и receipts.
Миграция не вклинивается между отдельными вызовами. Lost begin/early end закрывают
правильный capability, фактические native children drain до освобождения mutex.
View close/same-UID relogin запрещают поздние записи. Без permit разрешён только
guarded startup status; verified reset может retire свой gateway, затем завершить
acceptance и один restart после cleanup. Новый JS helper не скрывает исходную
ошибку или failed cleanup. History side effect убран из deferred React updater.

Full JS1732/1732, focused72/72, types02/scoped lint02 и static build02 PASS.
Browser capture regression14/14 PASS, console0; exact file/form/uncertain IDs
сохранились после new-root cold unlock. Native build02 SUCCESS20m3s, focused
backup/collector JVM34/34, lint0 errors/206 warnings/8 hints. Actual API34:
16/16 PASS. API26/provider113:14 bridge/guard/reset cases PASS, затем2 real SAF/
journal cases PASS в отдельном retry с теми же source/APK hashes. Initial UI
failures вызваны наблюдаемым stock AOSP statementservice error window до действий
приложения. Его сообщение закрыто в exact owned AVD; service/permissions/AppOps
не отключались. Failure logs и explicit setup action сохранены. API35 для нового
job не повторялся. См. `e2ee-336-archives-native-jobs.md`.

Новый collector output повторно прошёл общий strict parser6 checks с тем же SHA256.
Строгий server/web/native transport и backup job ещё не дают готовый source:
native selected-file/forms inventory, nested archive content, key loss/recovery,
полный web job и product lifecycle остаются. Coverage9/20; остальные11 sources,
48 сценариев,14-language semantic acceptance и independent human crypto review
по-прежнему обязательны. Production3.3.5/149, floors0/pilot/cutover off и
GENESIS_DEPLOY_ANDROID=false сохранены; Deploy/Play/личных устройств не было.
Предыдущий Source checks44600100480 наbf8749d8 полностью SUCCESS, включая
Android и web/API/browser. Это ещё не CI новых локальных инкрементов.

## Архивы: поздний native reply при смене аккаунта,20 ноября

Owner/session повторно проверяются непосредственно перед Main publication и
перед JS promise adoption в renderer. IO admission не закрывал обе очереди.
Private reply прежнего аккаунта заменяется bounded error; поздний begin receipt
закрывает свою capability. Captured RPC method/token не заменяются новым token.
Только exact empty cleanup/navigation receipts допустимы после intentional reset.
Native document access и account guard больше не no-op.

Full JS1738/1738, focused78/78, types/scoped lint04 PASS. Native build04
SUCCESS20m34s, focused JVM34/34, lint0 errors/206 прежних warnings/8 hints.
Actual API34 и API26/WebView113 по19/19 PASS на одинаковых APK,0 fail/skip:
9 whole-job,6 fence,2 reset,2 real SAF/journal UI. Обе новые Main-queue races и
renderer-session case включены. API26 statementservice dialog закрыт только
после наблюдения; системные проверки не отключались. API35 не повторялся.
Точные source/APK hashes, reports и ограничения в
`e2ee-336-archives-native-jobs.md`. Это не полный archives source или recovery.
Coverage9/20, остальные11 sources и все системные release gates сохраняются.
Production3.3.5/149, floors0/pilot/cutover off, GENESIS_DEPLOY_ANDROID=false;
Deploy/Play/личных устройств не было.

## Архивы: точный native файл и полный web job,20 ноября

Native import передаёт original bytes через bounded base64url fragments с точными
byte offsets, явным EOF и проверкой полного SHA256 перед созданием File. Больше
нет промежуточного replacement UTF8 decoder и выдуманного имени вместо provider
metadata. Отсутствующие поля остаются null; browser MIME normalization/display
fallback не заменяет original provenance в protected source input. При cancelled
replacement прежний transfer не удаляется заранее; chunk/clear привязаны к exact
operation/file ID. При end сначала удаляется capability, затем очищается buffer;
late installation повторно проверяет operation под import lock.

Actual web BackupPanel теперь передаёт callback полный bound runtime. Один owner
permit охватывает capture/safety/crypto/nested HTTP/preview/file/history. Children
включая pure crypto и file work tracked/drained; unawaited child не освобождает
lock до завершения и не может записать поздний результат. Restart отложен до
успешного cleanup и original-session check. Нет global borrowed permit.

Focused32/32 и полный JS1755/1755 PASS, failures/skips0. Types/scoped ESLint и
build:web PASS:98 HTML/14 languages, exact dictionaries,280 gallery/offline assets.
Actual Chromium157/React/File/WebCrypto/IDB/Web Locks22/22 PASS, console0.
Проверены original14 capture/new-root cold-unlock checks, whole-job exclusion,
durable deny и invalid UTF8 binary File/provenance. Own browser/listener закрыты;
оба PNG просмотрены. Это desktop/light fixture, не полная visual/provider matrix.
См. `e2ee-336-archives-web-jobs.md`, `e2ee-336-archives-native-file.md`.

Native build01 имел исправленную syntax error; build02 SUCCESS8m46s и selected
JVM23/23 PASS. Final build03 с composed web/native callback и end/publication guard
SUCCESS26m44s: selected JVM23/23 и actual API26/API34 по22/22,0 fail/skip.
Lint0 errors/208 warnings/8 hints: net2 warning обусловлены изменившимся lookup
доступных версий Compose/Lifecycle, новых product-source предупреждений нет.
Точные hashes/reports и ограничения в native-file документе. Source checks44613760022 на
d31bd642 полностью SUCCESS; следующие локальные инкременты этим CI не проверены.
Coverage9/20: native detached forms, nested archive reconciliation/recovery и
остальные11 sources/48 сценариев/14-language semantics/human crypto review нужны.
Production3.3.5/149, floors0/pilot/cutover off и GENESIS_DEPLOY_ANDROID=false;
Deploy/Play/личных устройств не было.
## Архивы: сохранение native формы до перерисовки,20 ноября

BackupPanel сохраняет принятое значение до React update; исходные key input,
preview/stage/operation IDs и выбранные native bytes/provenance переживают
закрытие окна. Native inventory удерживает все mounted/detached branches и
непринятые файловые candidates в памяти исходной account epoch. Смена аккаунта
сбрасывает ссылки и очищает owned binary arrays. Полный protected local capture
сохраняет Room safety/chunks, raw state, историю и этот inventory до будущего IO;
это ещё не полный `personal.archives` adapter.

Первый API26 прогон выявил реальную гонку: обычный background owner permit
мешал немедленной публикации формы. Исправлено отдельным memory monitor,
замораживаемым migration fence до durable deny/capture; нормальный IO не
замораживает ввод. Долгое ожидание scope mutex на WebView bridge thread исключено.
Проверен также final form собственного verified reset после retirement HTTP.

Full JS1778/1778, types/scoped lint(0 errors/4 прежних img warnings), web build
98 HTML/14 languages/gallery/offline PASS. Actual Chromium157:27/27, console0;
encrypted IDB/cold unlock сохраняет native-style form/file input. Native build02
SUCCESS27m16s, selected JVM15/15, lint0 errors/208 прежних warnings/8 hints,
новых warning/file combinations0. Actual API26/API34:26/26 каждый, включая real
SAF/view disposal и journal choices; по5 host common-parser/WebCrypto checks.
См. `e2ee-336-archives-native-forms.md` для exact inputs/APK hashes/evidence.

Это выбранная small-data приёмка. Native32MiB form/48MiB memory/capture budgets
ещё требуют composed24MiB-file/decoded-payload/preview-plan validation и bounded
storage/streaming с сохранением прежнего file-size support до release. Также
обязательны opening всех nested old ciphers, остальные11 categories, full product
lifecycle/recovery/Drive/direct upgrades, исходные48/14-language semantics и
independent human crypto review. Coverage9/20 и production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false сохранены; публикаций нет.

## Архивы: большие формы, Base64 и Android Keystore,20 ноября

Обычное принятие native формы больше не собирает её целиком в StringBuilder и
JSONObject: точные UTF16 части сохраняются зашифрованными в private no-backup
storage, с owner/epoch/view/blob/index AAD, length/count/SHA256/footer/EOF.
Малый зашифрованный locator сохраняет исходную привязку при потере процесса;
он не разрешает повторять операции. Предыдущая принятая форма сохраняется при
ошибке нового кандидата. Каталог форм включён в действующий key-loss inventory,
чтобы сохранённые данные не разрешали незаметно создать заменяющий локальный ключ.

Actual large-file проверка нашла два реальных дефекта. Общий web/Android Base64
regexp переполнял стек на допустимом файле; теперь проверка линейная, строгие
padding/unused bits сохранены, лишний многомиллионный iterable array устранён.
В API26 крупный doFinal не проходил проверку MAC; контролируемая матрица показала,
что bounded updates нужны на шифровании И расшифровке. Общий LocalCipher использует
части8192 bytes, прежние format/key/AAD/IV сохранены. Частичный plaintext не
возвращается до doFinal; owned buffers очищаются при отказе. Ошибки02/03 и
остановленные01/02/04 сборки не скрыты; детали в `e2ee-336-archives-form-spool.md`.

Full JS1790/1790,0 fail/skip; owned types/scoped lint и web build98 HTML/14 языков/
280 gallery/offline PASS. Actual Chromium157:29/29, console0, включая16MiB+tag
Base64 и native-style source/new-root cold readback. Native05 SUCCESS21m11s,
selected JVM16/16; lint0 errors/208 warnings/8 hints, новых warning/file pairs0.
Actual API26/API34:по49 уникальных cases PASS. Исходный opt-in skip20MiB import
сохранён в базовом отчёте и закрыт отдельным запуском с явным аргументом; derived
summary сохраняет оба результата. По5 host common-parser/WebCrypto checks PASS.
Input `A718C4795F2F0A27F485F77023E7DBD2F05B73E2DF3E559131BDC8F8C4E5D3F7`;
APKs и полные evidence/limits указаны в source-документе.

Реальный файл15,461,065 plaintext /20,615,080 encrypted bytes с8 валидными картами
прошёл decrypt и preview,8 документов сверены, retained form36,077,145 characters
пережила закрытие окна. Restore не выполнялся. Full fixture185s(API34/heap192MiB)
и257s(API26/heap512MiB): повторные записи неизменившихся больших полей остаются
обязательным UX/performance исправлением перед выпуском. Оба dark PNG просмотрены;
это не полная visual/OEM/provider matrix.

Aggregate capture48MiB/shared form32MiB ещё явно отказывает до materialization
большой формы; нужны streaming всего snapshot, lifetime выбранных binary files,
crash-remnant/old-key materialization и полный archives adapter. Coverage9/20,
остальные11 categories, normal writers/lifecycle, shared ACL/rotation, Drive,
direct upgrades, исходные48/14-language semantic acceptance и independent human
crypto review по-прежнему обязательны. Source checks44646564201 на642d7a99
полностью SUCCESS; новые локальные инкременты этим старым CI не проверены.
Production3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false
сохранены. Deploy/Play/личных устройств в этом продолжении не было.

## Порядок подтверждения сохранения карт,20 ноября

Source checks44658090511 наd6f99745 обнаружил пустое новое описание в отдельном
premium-клиенте. Контролируемая задержка подтвердила реальную гонку: ответ на
старую запись показывал synced, пока новая правка ещё не подтверждена. Статус
теперь привязан к последней staged sequence; разрешение старого uncertain
request тоже не подтверждает новую правку. CAS/receipts/ciphertext сохранены.
Исходный browser scenario усилен двумя управляемыми задержками, проверкой всех
состояний и точного operationId/revision перед открытием отдельного клиента.

До исправления deterministic regression0/1; после42/42 focused и1806/1806 full
JS,0 fail/skip, owned types/scoped lint PASS. Web сGENESIS_MINDMAPS=true PASS.
Actual Chromium145:4 startup checks и3 controlled two-write/cold-client cycles
PASS, console0; финальный desktop/light PNG просмотрен. Первые browser01/02
не дошли до сценария из-за выключенного mindmap build flag и сохранены как
неуспешные. См. `e2ee-336-mindmap-save-status.md` для evidence/ограничений.
Новый CI ещё не подтверждён; старый failure не переименован вPASS. Этот инкремент
не закрывает native архивацию/9 из20 источников/общие условия выпуска. Production,
floors0, pilot/cutover off иGENESIS_DEPLOY_ANDROID=false сохраняются.

## Архивы: отдельные поля и переносимость v1,20 ноября

Новый local-кандидат передаёт и шифрует только изменившиеся serialized значения
BackupPanel; полное точное JSON-сравнение сохраняет изменения внутри прежнего
object reference. Native хранит оригинальные значения/невыбранные candidates и
все подтверждённые manifest с исходной owner/epoch/view/field привязкой. Малый
manifest принимает только существующие значения правильного поля и проверенные
оригинальные file references. Mixed v1/v2 collector сохраняет history, а новый
UTF8 codec не заменяет lone-surrogate provider metadata вопросительными знаками.

Проверка API26 выявила самостоятельную несовместимость v1 portable backup:
Android JSONArray экранирует solidus в Base64, JS использует другие AAD bytes.
Новые записи используют единый формат, readers допускают только два точных
полностью аутентифицированных исторических представления того же v1 header.
Suite, key, context, nonce/tag, digest и ограничения не ослаблены; plaintext/
entitlement/restore fallback не добавлен. См. `backup-336-portable-aad.md`.

Full JS1814/1814,0 fail/skip; types07/scoped lint06 и web build PASS. Actual
Chromium15736/36, console0: реальные React/File/WebCrypto/IDB, предыдущие key
inputs, все manifest, original binary и new-root cold unlock; оба PNG просмотрены.
Исходный CI44658090511 failure сохранён; fix7d67c53a прошёл полный Source
checks44664513690 web/API+Android. Дополнительный existing premium run92/92 и
4 startup checks PASS. Это не полная security UX-приёмка.

Native04 SUCCESS21m18s, JVM25/25; lint0 errors/208 warnings/8 hints, новых issue/
file pairs0. InputADECE99F52C96CAD98452E21EFB20339B142E9F351DC0A273AF6DFE04A862EDD.
Actual API26/API34:57 уникальных cases PASS каждый. Исходный base56 PASS+1 opt-in
skip сохранён; точный20MiB source case прошёл отдельно с явным аргументом, derived
summary сохраняет оба отчёта. В каждом окружении ещё15 независимых host checks:
6 source/new-root,4 native-export portable/canonical и5 реального SAF.

Файл20,615,080 bytes с8 картами прошёл decrypt/preview без restore:42,946ms(API34)
и49,919ms(API26), против185,287/257,242ms прежнего v1 fixture. Малое подтверждение
заняло329/198ms, один value chunk4 code units плюс малый manifest; неизменённые
payload/plan повторно не переданы. Это synthetic emulator measurement. Обе dark
PNG просмотрены. API26 heap512MiB, API34 heap192MiB; API26/192MiB, API35/OEM и
полная visual/provider matrix не приняты. Полные hashes/evidence/failed01–03:
`e2ee-336-archives-values-transport.md`.

Coverage остаётся9/20: binary retention в памяти, redundant manifest strings,
aggregate48MiB capture, process remnants/все nested old keys и полный archives
adapter ещё нужны. Не повышать supported protocol или cutover по этим57 cases.
Остальные11 categories, normal writers/lifecycle/shared ACL/files/Drive/direct
upgrades, исходные48 сценариев,14-language semantics и human crypto review
сохраняются условиями выпуска. Production3.3.5/149, floors0/pilot/cutover off и
GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личных устройств в этом продолжении нет.

## Архивы: binary spill и завершение файловых операций,20 ноября

Оригинальные бинарные candidates и provider descriptor теперь сохраняются в
существующих authenticated UTF16 frames с отдельной ролью file-v1. После
успешного сохранения native освобождает свои retained массив/descriptor; старые
невыбранные файлы сохраняются как инертные исходники. Проверяются исходная
сессия/owner/epoch/view/blob, длина, SHA256, canonical Base64/padding и полный
footer/EOF. История manifest больше не держит redundant plaintext String list.
Pending reservations учитывают memory/count budgets; общий disk quota768MiB
проверяется атомарно для всех native spools. При отказе удаляется только новый
неподтверждённый candidate. Прежний принятый ввод не заменяется нулевыми bytes.

Файловая запись вынесена из inventory/window monitors; отдельный coroutine mutex
сериализует выбор файлов. Закрытие окна и operationEnd инвалидируют работу сразу,
но whole-job permit освобождается после реального drain. Смена исходной сессии
останавливает также полный metadata readback до публикации locator. Остальные
синхронные form/value ports и aggregate snapshot ещё требуют продолжения.

Selected binary04: input5AE5744ED2647F4283F8401C5650C582E754A5901B46B5B8E9402214E1F5A07E,
build SUCCESS19m, JVM40/40,0 fail/skip; lint0 errors/208 warnings/8 hints, новых
issue/file pairs0. Actual API26/API34 — по58 selected cases,0 fail/skip, включая
две новые paused-IO lifetime проверки. По21 независимой host-проверке в каждом
окружении: original values/provider units/new-root, real SAF, portable canonical
AAD и binary integrity. Уровневые детали, hashes, failed drafts01/02 и baseline03:
`e2ee-336-archives-binary-spill.md`.

Файл24MiB прочитан с полным SHA/footer/EOF; история51MiB в трёх файлах сохранилась
без retained native File arrays. Actual20,615,080-byte backup с8 картами прошёл
preview без restore:60,236ms(API26)/53,725ms(API34), small confirmation247/335ms,
один value chunk4 code units плюс manifest. Файловый spill добавляет ограниченную
работу и примерно4.74x physical amplification; обещаний ускорения этого шага нет.
API26 Java heap512MiB, API34 heap192MiB. API26 preview PNG просмотрен; API34 PNG
показывает верх формы после запроса scroll, поэтому видимость самого preview
этим снимком не принята. Semantic/full visual/provider/API35/OEM coverage открыт.

Related JS77/77, owned types01 и scoped lint02 PASS. Предыдущий сохранённый
98db50e4 полностью прошёл Source checks44672125329 web/API+Android; новый
инкремент ещё не имеет собственного подтверждённого CI. Coverage остаётся9/20:
нужны snapshot streaming, process remnants/все nested old keys, полный archives
adapter, другие11 источников, normal writers/lifecycle/shared ACL/files/Drive/
direct upgrades,48 сценариев,14-language semantics и human crypto review.
Production3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false;
Deploy/Play/личных устройств/версии в этом продолжении не меняли.

## Архивы: границы жизни text/form ports,20 ноября

Проверенный binary spill сохранён в63b90e17. Следующий инкремент передаёт
original actor guard через все три form/value/manifest ports, включая полный
metadata readback. Источники сериализуются owner memory gate/inventory, поэтому
закрытие окна больше не держится за общий Java monitor публикации. Процессный
scopeEpoch инвалидируется до ожидания inventory cleanup; он не заменяет
dataGeneration/cryptoEpoch/securityEpoch. Неподтверждённый новый value/manifest
при отказе не стирает предыдущий принятый ввод.

Build01 SUCCESS19m38s, selected JVM46/46. API26 прошёл60/60; API34 —59/60,
с ошибкой QA-выражения document.body.innerText до создания body. Файл ещё не
выбирался. Console TypeError и исходный failure/screenshot сохранены. Null от
evaluateJavascript ошибочно считался отсутствием callback. Три related UI helpers
теперь учитывают готовность body и отдельно отмечают завершение callback;
таймауты не увеличены, actions не повторяются автоматически. Это androidTest-only
repair; application/JVM sources и Main APK не изменены между01 и02.

Input02 B39709ADA38C5018A155D45CCB07D5929FE8434293B974808A860A0D513ADBB2,
build SUCCESS2m26s. Lint0 errors/208 warnings/8 hints, новых issue/file pairs0.
Actual API26/API34 — по60/60,0 fail/skip, включая22 whole-job cases с тремя
ports и same-UID retirement. По21 host-проверке каждого результата PASS.
JVM46/46 относится к исходному build01; нового запуска JVM для02 не заявляем.

Actual20,615,080-byte file/eight-map preview прошёл без restore:54,123/50,608ms
(API26/API34); small confirmation217/269ms, один4-code-unit value плюс manifest.
Перед screenshot проверены viewport, два browser frames и native visual-state
callback. Оба dark preview PNG просмотрены, counts8 и confirmation видны.
API26 heap512MiB, API34 heap192MiB; полные visual/provider/API35/OEM/14-language/
product/direct-upgrade состояния не приняты. Evidence, hashes и failure01:
`e2ee-336-archives-port-lifetimes.md`.

Следующий gate — полный streaming source/coordinator snapshot, ранняя привязка
process remnants и открытие всех nested old ciphers до принятия переносимого
снимка. Требования: `e2ee-336-archive-stream-requirements.md`. Простое увеличение
32/48/64MiB лимитов не принимается. Coverage остаётся9/20; остальные11 categories,
normal lifecycle/shared/files/Drive/48 scenarios/human review обязательны.
Production3.3.5/149 и floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false;
никаких Deploy/Play/личных устройств/повышения версии здесь не было.

## Архивы: потоковое кодирование исходников,20 ноября

Следующий source-only модуль BackupSourceJson сохраняет исходные UTF16 units
и binary bytes в JSON wire без полной промежуточной строки/Base64. Он проверяет
original actor по bounded IO и требует фактического EOF, включая финальную
проверку tag/footer источника. Частичный вывод остаётся quarantine; модуль не
даёт snapshot/restore/network authority и пока не подключён к coordinator.

Input01 3B613B4C03FCB5E2694A26C59EAA6B4C8C4972CAEAADF72F02AD36627A8B24F2.
Selected JVM7/7; actual API26/API34 — по1/1 native codec case,0 fail/skip.
Независимые host checks сохранили все исходные units/bytes, отказ общего strict
parser на duplicate private names и подтвердили SHA256 полного quoted40MiB
generated stream. Java max heap512/192MiB, elapsed1603/1852ms(API26/API34).
Это проверка codec, не всей миграции и не peak-heap measurement. APK hashes,
точный объём и evidence: `e2ee-336-archive-source-wire.md`.

Coverage9/20;32/48/64MiB aggregate gates ещё действуют. Полные source/coordinator
streaming, process remnants, nested old ciphers, остальные категории и общая
приёмка обязательны. Production3.3.5/149 и floors0/pilot/cutover off сохраняются.

## Архивы: ранние локаторы и потоковый retained source,20 ноября

Source-wire codec сохранён вbf6c504b; полный Source checks44688120762 прошёл
web/API и Android. Новая часть добавляет authenticated origin до подтверждения
первого frame, fsync frames/каталога и bounded restart catalog. Завершённый
final-v1 ref сохраняет совместимость; известные partials остаются инертными,
unknown remnants явно блокируют вместо sweep/rebind/пустой истории.

Immutable reference catalog теперь отдаёт исходные формы, каждое принятое
value/manifest и все selected/unselected files через bounded readers вне
inventory/File monitors. Новый local wire3 сохраняет rawDescriptor строкой;
общий strict reader проверяет её до проекции и сохраняет оригинал. Это номер
локального source-формата, не cryptoProtocol/writerProtocol/update floor.

Draft01 остановился на отсутствующем в SDK O_DIRECTORY; draft02 прошёл47 JVM
и64 native/platform cases, но lint нашёл O_CLOEXEC API27 при min26. Input03
использует только public SDK с явной SDK-проверкой. Build03 SUCCESS20m36s,
JVM51/51, lint0 errors/208 warnings/8 hints, новых issue/file pairs0.
JS75/75, scoped lint и owned types PASS. Native03: API34 —67/67; API26 —66/67.
Один новый QA pause predicate ожидал array write>1024, тогда как API26 platform
Base64 пишет одиночными bytes (max array277, против8124 наAPI34). Сам большой
source case прошёл на обеих платформах. Failure и diagnostic03 сохранены.

Только androidTest helper изменён на pause по суммарной позиции потока, без
увеличения timeout/retry. Input04
8D019006D15FD53A698B7D076749C0D3AD6AB295D546AF1CE767539B7310C528,
build SUCCESS2m19s; Main APK байт-в-байт совпадает с03, lint XML также идентичен.
JVM51 относится к03; нового JVM run для04 не заявляем. Actual04 API26/API34 —
по18/18 focused cases,0 fail/skip, включая3 source и3 origin cases; по31 host
checks PASS, все15 extracted artifact hashes/platform проверены. Неизменённые
64 functional cases остаются явно03 evidence, а не повторным04 запуском.

Actual24/17/10MiB file history —51MiB оригиналов и71,304,915 source bytes.
Независимый bounded host construction подтвердил весь wire digest и три binary
digest. Полный synthetic fixture с retention/streaming занял75,108/61,300ms
(API26/API34), max Java heap512/192MiB. Clear во время остановленного binary
output занял7/2ms; writer отказал E2EE_ACCOUNT_CHANGED. Peak heap, unlimited
capacity и SLA не заявляются. Оба03 dark preview PNG просмотрены: counts8 и
confirmation видны; light journal — отдельный02 evidence. Полная visual/
provider/API35/OEM/14-language/direct-upgrade matrix открыта.

Форматы, hashes, failed drafts и точный объём: `e2ee-336-archive-origins.md`,
`e2ee-336-archive-inventory-stream.md`. Следующая интеграция:
`e2ee-336-snapshot-stream-plan.md` (план, не реализованный stage protocol).
Producer пока не является полным personal.archives adapter: нужны encrypted
new-root stages/coordinator/common-reader streaming, все process directories и
nested old ciphers. Legacy32/48/64MiB gates сохранены; coverage9/20 и остальные
11 categories/normal lifecycle/shared ACL/files/Drive/48 scenarios/human review
остаются обязательными. Production3.3.5/149, floors0/pilot/cutover off и
GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные устройства/версию здесь не меняли.

## Защищённые потоковые снимки: локальный журнал,20 ноября

Добавлены TS/Kotlin source stages в существующем signed-AEAD vault. До producer
атомарно сохраняются каталог и исходный journal; каждый256KiB chunk и его
продвижение — одной CAS-транзакцией. Target owner/scope/kind отличаются от
original device actor и связаны в metadata/technical IDs. Новый строгий decoder
читает существующий tagged binary, не JSON. Незавершённые/неизвестные остатки,
отсутствующие/лишние parts, смена actor и частичный EOF явно отказывают; очистки,
перепривязки и превращения prefix в завершённый снимок нет. Complete stage ещё
инертен: coordinator pointer/общий reader/reconciliation к нему не подключены.

JS final02 —87/87; scoped ESLint/owned types PASS. Реальный Chromium157/IndexedDB
final02 —15/15, включая повторное открытие9MiB+13 и65,543-byte paths, сохранение
неполной попытки, no-space/retirement/EOF/wipe и чтение actual JCA stage.
Input01 811034B9C6C296E3038B3A7212E20747E93DC250706CA433BCCBAC6897B0E500:
build SUCCESS18m20s, JVM147/147. Native API26/API34 — по3/3. Только тесты/fixtures
усилены для final input02
465616425600287ABDEBE573E05CF47E1BCE42B2739631A843F727691F05807C:
build SUCCESS2m17s; Main APK и lint XML байт-в-байт совпадают с01. Lint0 errors/
208 warnings/8 hints, новых issue/file pairs0. JVM147 — evidence01, не новый02 run.

Actual final02 API26/API34 — по4/4,0 fail/skip. Совместный retained input:
24/17/10MiB files,4 original/replaced/unselected values,2 manifest histories и
исходные provider/UTF16 units.51MiB оригиналов ->71,305,891 source bytes проходят
через реальный SQLite stage; после удаления только synthetic old spill alias
и cold reopening весь поток совпадает с независимым bounded host construction.
Elapsed95,529/82,304ms(API26/API34), max Java heap512/192MiB; peak heap/SLA не
заявляются. По2 extracted artifacts каждого результата сверены по хешам.

Публичный JS vector с distinct target owner и неполной/полной попытками открыт
обоими native providers. Обе платформы создали новый signed stage; Node WebCrypto
прочитал оба, Chromium — actual API34:2 opaque paths/63bytes, без JSON-проекции
duplicate private names или non-UTF8 binary. Native custody в этом fixture —
отдельный no-auth synthetic LocalCipher alias, не приёмка product presence/
recovery/new-device flow. Точные hashes, format и ограничения:
`e2ee-336-source-stage.md`.

Для git diff --check из public canonical JSON fixture удалена только пустая
строка в конце. Input03
181E3710A28804C37179AAE220DE3E89D1CC0A5828F1D9D7D4FE4239D2FB187E:
build SUCCESS1m22s, Main APK тот же. Сверены все668 ZIP entries Test APK: отличается
только canonical JSON asset, весь исполняемый код совпадает с02. Actual03
API26/API34 — по1/1 focused codec case PASS;4/4 полного stage остаются02 evidence,
не повторным03 запуском. Нового JVM run нет.

Последний CI8ff/44696853150 исходно упал: Android не скачал KSP2.3.12, web/API —
на сравнении изменяющегося секундного email cooldown с неизменным объектом.
Android-only повтор этого же commit прошёл без смены зависимостей. Тест email
теперь отдельно сравнивает стабильные поля и countdown в фактическом elapsed
окне; isolated email-verification PASS. Полный CI нового commit ещё нужен.

Coverage остаётся9/20. Stage не является полным personal.archives adapter;
обязательны coordinator/common-reader/content streaming, все process directories
и nested old ciphers, остальные11 categories, lifecycle/shared ACL/files/Drive/
direct upgrades,48 scenarios,14-language semantics и независимый human crypto
review. Production3.3.5/149, floors0/pilot/cutover off и GENESIS_DEPLOY_ANDROID=false;
Deploy, Play, личные устройства и версия в этой части не менялись.

## Файлы: потоковый writer без смены формата,20 ноября

Следующий блок sealE2eeFileStream/native sealStream сохраняет v1 file key,
свежие DEK,256KiB chunks и encrypted signed manifest. Ciphertext передаётся по
одной части в local quarantine; прежние batch API используют этот writer,
сохраняя массивы для совместимости. Per-file64MiB не повышен. Actual EOF обязателен
и после declared byte count: late source tag failure/retirement/IO refusal не
возвращает complete manifest. Это ещё не streaming всего coordinator/content
planner. Native JSON manifest экранирует исходные surrogate units перед UTF8,
сохраняя имена без silent replacement, при прежней схеме.

Input01 96A2A7D95458F510BD211851950CFD6E422019BBBFFFB12D97B68FE4A0E3B12A:
build SUCCESS18m1s; JVM152/152, lint0/208/8, новых issue/file pairs0. Actual
API26/API34 — по3/3,0 fail/skip.40MiB generated input ->160 individual private
ciphertext files -> полный v1 readback; независимый bounded host SHA совпал.
Elapsed8,011/11,670ms(API26/API34), max Java heap512/192MiB; peak heap/SLA не
заявляются. Оба JCA providers читают новый public WebCrypto vector; Node читает
оба native vectors с9 исходными bytes и всеми filename units(BOM/lone/emoji).
Каждый результат дал2 extracted artifacts, оба проверены по хешам.

Actual Chromium157/IndexedDB —8/8:9MiB+7bytes/37 immutable chunks читаются через
новое соединение, native v1 открывается, tag/retirement/borrowed wipe проверены.
JS draft01 —67 cases; после cleanup lint repair draft02 —64 stream/storage/
migration cases;3 device-vault cases в02 не повторялись. Scoped ESLint/types PASS.
Синтетические file-test keys публичные/в памяти, а не product presence/recovery.
Hashes и точная граница: e2ee-336-file-stream.md.

Далее — descriptor/private-manifest preflight до chunk IO и composed source/
content/coordinator streaming. Остальные gates и coverage9/20 сохраняются.
Production3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false;
никаких Deploy/Play/личных устройств/обновления версии в этом блоке нет.

## Файлы: строгая проверка manifest до чтения частей,20 ноября

Web/native reader теперь проверяет весь private JSON и все descriptors до
первого chunk IO, импорта file key и выделения полного output. Строгий UTF8,
decoded duplicate names, platform-lenient syntax, trailing documents и bounded
строки/числа/глубина проверяются до JSON-проекции. Все IDs/types/hashes/indices/
sizes/duplicates проверяются сразу, включая повреждённую последующую строку.
Формат v1, исходные filename units и непрозрачные bytes сохраняются.

Input02 E2837F269C221F759B6A9B2DF6120C54DC95758378E6381372898D1311ABCF77:
build SUCCESS18m50s, JVM154/154, lint0/208/8, новых issue/file pairs0. Actual
API26/API34 — по4/4,0 fail/skip, включая shared4valid/25invalid corpus и шесть
malformed later descriptors с нулём fetches. Оба host cross-check PASS; по два
extracted artifacts сверены по хешам. Весь generated40MiB/160chunks совпадает
с независимым bounded host digest. Elapsed8,922/14,069ms, max heaps512/192MiB;
peak heap/SLA не заявляются. Chromium157/IndexedDB —10/10, включая полный
9MiB+7byte readback через холодное соединение. JS draft03 —67/67; types/scoped
lint PASS. Детали/точные hashes: e2ee-336-file-manifest-preflight.md.

Далее — публикация staged source в coordinator и полная потоковая интеграция.
Coverage9/20 и остальные release gates сохраняются. Production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные
устройства/версия в этой части не менялись.

## Потоковый источник: атомарная ссылка coordinator,20 ноября

Локальное состояние3 явно ссылается на защищённый stage с original target,
device actor, полным registry путей и всеми известными complete attempts.
Старые1/2 и cancelled ancestors сохраняют собственные форматы. Полный registry
проверяется до keys/producers; stream adapters отделены от bounded compatibility.
Incomplete/unknown remnants явно блокируют reconciliation, complete orphan
после проигранного CAS включается в следующую попытку. Новый source format не
кодируется как пустой legacy snapshot и не меняет crypto/writer protocol.

Pointer, прежний ancestor и compare/re-seal исходного stage catalogue сохраняются
одной существующей vault-транзакцией. Это закрывает также гонку при capacity
await: отдельная вставка stage между проверкой и публикацией приводит к CAS
отказу без потери обеих попыток. Native producer может suspend между bounded
writes с прежними actor/single-path/EOF guards. Metadata admission учитывает
catalogue guard и state/ancestor, а owned buffers очищаются.

Accepted input03
20692275A82E6641B8E231BEF1C0D96156DBCFD17895A73B79048C3C69A6A7CB:
build SUCCESS18m52s, JVM163/163, lint0/208/8, новых issue/file pairs0. Actual
API26/API34 — по5/5 new coordinator-source и4/4 retained-source regression,
0 fail/skip. Независимый bounded host подтвердил все73,400,327 bytes primary
source(70MiB+7) и весь прежний71,305,891-byte archive wire с51MiB files/4 values/
2 manifests. New-source elapsed41,231/70,099ms, Java max heaps512/192MiB;
peak heap/SLA не заявляются. По3 extracted artifacts каждого отчёта сверены
по хешам; свежие JCA vectors открыты Node WebCrypto. Browser25/25, JS88/88,
scoped lint/owned types PASS. Input01 compiler failure и02 cancelled до
acceptance сохранены как отдельные черновики. Подробности/точные hashes:
e2ee-336-staged-coordinator.md.

V3 run пока явно отказывает E2EE_STREAMED_PLANNER_REQUIRED до transport:
это приёмка source publication, не завершённая потоковая миграция. Synthetic
registry из6 project producers не является6 real adapters. Coverage9/20 и
полные archives/process/nested cipher/common reader/content planner, остальные
sources/lifecycle/ACL+rotation/Drive/direct upgrades/48 scenarios/14-language
semantics/human crypto review остаются обязательными. Production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные
устройства/версия здесь не менялись.

## Файлы: bounded readback без полного plaintext,20 ноября

Web openE2eeFileStream и native E2eeFiles.openStream используют общий с batch
reader строгий preflight всего private manifest. Каждый chunk проверяется по
hash/context/signature/AEAD/размеру; actor guards окружают crypto/fetch/sink.
Borrowed plaintext очищается после callback, включая ошибку, а итоговые metadata
возвращаются только после всех ordered chunks и финального actor check. Поздняя
ошибка, no-space или retirement не превращают prefix в целый файл. Prefix
допустим только в защищённом local quarantine. Формат v1 и64MiB/file не меняются.

Accepted native input01
F3D6AB03EB13FCFB91ECF5DBDCCCD7336DB635C8F2F67EEEBF95D41D53F9C22D:
build SUCCESS19m13s, JVM167/167, lint0/208/8, новых issue/file pairs0. Actual
API26/API34 — по5/5,0 fail/skip. Весь40MiB source прочитан через160 bounded
chunks, borrowed buffers очищены, digest совпал с независимым host construction.
По два extracted artifacts на платформу сверены по хешам; fresh JCA vectors
открыты обоими WebCrypto readers. Elapsed10,652/16,164ms, Java max heaps512/192MiB;
peak heap/capacity/SLA не заявляются. Runtime использовал свежие assembled APK
параллельно с lint; оба APK hash совпадают с финальным successful build identity.
Chromium157/IndexedDB —17/17, включая полный9MiB+7byte cold readback/37 chunks,
late failures, guard/options capture и empty file. JS93/93, scoped lint/types PASS.
Подробности и APK hashes: e2ee-336-file-read-stream.md.

Предшествующий file-preflight d69787b1 прошёл полный CI44721059631. Source
publication9af1f6b3: Android CI PASS, web/API44727123730 ещё выполнялся на момент
этой записи; новый reader remote CI пока не запускался. Это не release evidence.
Далее нужны original-source read-only recovery и полный streamed planner/common
reader. Coverage9/20, все оставшиеся product/recovery/shared/Drive/upgrade/48/
14-language/human-review gates сохраняются. Production3.3.5/149,
floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные
устройства/версия в этом блоке не менялись.

## Исходный снимок: только чтение со старым public signer,20 ноября

Web openOriginalSourceStage и native E2eeOriginalSource.open читают оригинальный
защищённый stage по отдельно полученным roots и публичному ключу подписи.
Восстановление старого активного vault/права подписи для этого больше не требуется.
Namespace ограничен source-stage; original actor/generation/schema/epochs/key ID
проверяются до открытия. Handle даёт только пути, bounded reader и close; смена
аккаунта/закрытие во время IO не возвращают plaintext или complete receipt.
Authenticated recovery handoff и product custody ещё не реализованы этим API.

Input01 6FC6A3B73E094EFABC398272DA1DDB4D93D4967235A6BDBB2B7EE0777373D8FE:
build SUCCESS24m50s, JVM172/172, lint0/208/8, новых issue/file pairs0. Actual
API26/API34 — по2/2 new-reader,5/5 coordinator и4/4 retained regressions,
0 failure/skip. Все73,400,354 original bytes(2paths по35MiB+17) совпали с bounded
host construction после удаления только synthetic old alias; новая active
device identity сохранена. Fresh JCA vectors2paths/6bytes прочитаны WebCrypto.
Coordinator source73,400,327bytes и весь retained wire71,305,891bytes также
проверены независимо. Chromium157/IndexedDB14/14, JS105/105, scoped lint/types
PASS. Runtime начал проверки после новой assembly параллельно с lint; оба APK
hash совпали с финальным successful build. Подробнее: e2ee-336-original-source-reader.md.

Предыдущий source-publication9af1f6b3 прошёл полный CI44727123730; bounded-reader
61922ffa — Android CI PASS, web/API44733098308 пока выполняется. Это не приёмка
полного релиза. Начат следующий план bounded content quarantine; red-тест его
отсутствующего модуля не является passing evidence и не входит в этот checkpoint.
Coverage9/20 и все product/common-reader/recovery/shared/Drive/direct-upgrade/
48-scenario/14-language/human-review gates сохраняются. Production3.3.5/149,
floors0/pilot/cutover off и GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные
устройства/номер версии не менялись.

## Потоковый план контента в локальном quarantine,20 ноября

Web ProtectedMigrationContentPlan и native E2eeContentPlan.Writer сохраняют по
одному encrypted envelope/local part с журналом попытки, читают каждый результат
обратно и публикуют complete marker/manifest одной локальной CAS-транзакцией.
Файлы сохраняют v1/64MiB; комментарии — отдельный single-envelope формат,
local-only записи не попадают в upload descriptors. В памяти остаются bounded
buffers/metadata. Reader проверяет весь manifest/inventory и оригинальные SHA-256
через bounded readback; web использует exact @noble/hashes2.4.0, native — JCA.
Полный и runtime-only dependency audit:0 известных advisories. Metadata имеет
отдельный strict4MiB/250000-node budget; file manifest остаётся256KiB/10000.

Dedicated red-тест выявил неочищенную временную local copy при отказе metadata
serialization. Guard исправлен на обеих платформах до runtime acceptance.
Input01 с JVM179/179/SUCCESS8m32s поэтому не использовался для приёмки runtime.
Accepted input02
C19E425C692BF040E9081E73CE6B274F5AC68A25BF799E5EB7347339F6FA2BD5:
build SUCCESS10m16s, JVM179/179. Actual API26/API34 — по3/3 new-plan и5/5 file
regressions,0 failure/skip. Все83,886,080 remote bytes(2files по40MiB)/322 envelopes
прочитаны через cold SQLite после удаления только synthetic old alias; SHA
совпадают с независимым bounded host construction. Source/APK hashes сверены
после выполнения; оба extracted artifacts каждой new suite проверены.
Elapsed108,008/156,019ms, max heaps512/192MiB; peak heap/product capacity/SLA
не заявляются. Новый Android lint для этого input не запускался; последняя полная
проверка — original-source, полный lint release candidate ещё обязателен.

JS120/120, scoped lint/types PASS, полный static web build02 PASS. Actual
Chromium157/IndexedDB13/13: два9MiB+7byte файла, все76 envelopes, local-only value,
каждый исходный byte/host SHA, borrowed wipe, late tag/incomplete source/quota/
syntax/actor refusals. Browser CLI был переоткрыт; только финальный13/13 report
после progress-only QA restart считается passing evidence. Public WebCrypto
vector открыт обоими JCA providers, Node читает обе fresh JCA variants,
Chromium — fresh API34; read ports требуют только roots/public signer.
Подробности, точные hashes и границы: e2ee-336-content-plan-stream.md.

Original-source676d06d1 прошёл полный CI44739109349. Новый план пока не проходил
remote CI. Он инертен и не подключён к активной миграции: v3 run сохраняет отказ
до transport. Новый design e2ee-336-streamed-coordinator-integration.md отдельно
фиксирует mixed old ancestors, сохранение remote originals и реальный bounded
native/WebView input как незавершённую интеграцию. Coverage9/20, все11 real sources,
product lifecycle/recovery/ACL+rotation/Drive/direct upgrades/48 scenarios/
14-language semantics/human crypto review остаются обязательными. Production
3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false; Deploy/Play/
личные устройства/релизная версия не менялись.

## Потоковое согласование исходников и истории,20 ноября

Web/native registry теперь синхронно проверяет и сохраняет все reconciliation
callbacks до получения ключей/lease. Текущий и каждый прежний original reader
обязаны дойти до authenticated EOF. Один semantic record/file stream передаётся
в защищённый content-plan sink; aggregate content array не создаётся. Ошибки
источника, дубликаты, параллельная/неожидаемая запись и смена аккаунта блокируют
complete coverage, даже если adapter перехватил исключение. Cleanup закрывает
все readers и сохраняет первичную ошибку; Android завершает отдельную запись
под общей блокировкой и выполняет cleanup при cancellation.

Red lifecycle suite воспроизвёл три дефекта незавершённого web-черновика; они
исправлены до приёмки. Диагностическая native compile01 упала на промежуточных
несогласованных интерфейсах во время редактирования и не считается результатом.
Следующий input01 был зафиксирован перед новой сборкой:
481149A2B51B0AA4FBC8D418F7178EE145F89103B5E83373696F032B542537DE.
Build SUCCESS11m, JVM190/190,0 failure/skip. Actual API26/API34 — по2/2 new cases,
3/3 content-plan и2/2 original-source regressions. Все4,194,408bytes composed
output/6 hashes совпадают с независимым bounded host construction; все33 исходные
encrypted rows сохранены. Elapsed7,212/11,623ms; heap-peak/SLA не заявляются.
Регрессия также независимо сверила все83,886,080bytes двух40MiB файлов и обе
свежие JCA variants через WebCrypto. Source/APK hashes после runtime совпали.
Android lint для нового input не запускался: полный lint кандидата обязателен.

JS66/66, owned types/scoped lint PASS; static web build PASS. Chromium157/IDB
11/11: полный cold readback всех bytes/hashes, неизменность originals, quota,
непрочитанная история и retirement. Browser draft01 выявил старые test handles
после lock; финальный bundle заново открывает originals через cold connection.
Точные reports/hashes и границы: e2ee-336-staged-reconciliation.md.

Предыдущий content-plan3905118d прошёл оба CI44749102743. Новый registry не
подключает v3 run и не заменяет authenticated coordinator history/custody,
сохранение remote originals или реальный native/WebView bounded input. Его шесть
synthetic project paths не являются real adapters: coverage остаётся9/20.
Все11 источников, product lifecycle/recovery/ACL+rotation/Drive/direct upgrades/
48 scenarios/14-language semantics/independent human review обязательны.
Production3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false;
Deploy/Play/личные устройства/релизная версия здесь не менялись.

## Ограниченное чтение после загрузки и ответы web API,20 ноября

Web/native signed transport получил forEachEnvelope с одной записью на ответ,
ожиданием sink и guard до следующего запроса, плюс getEnvelope с точным domain/ID.
Есть защита от loop/чужого scope/лишних записей/смены checkpoint/retirement.
Пустые страницы с pinned headers не доказывают полноту сервера: обязательна
сверка ВСЕГО ожидаемого плана и аутентификация каждого content/file. Старый
readAll и агрегатный путь coordinator ещё сохраняются; новый v3 run не открыт.

На сайте E2EE-ответы теперь ограничены ДО JSON parsing: read16MiB, directory32MiB,
остальные известные маршруты256KiB, ошибки8KiB — по аналогии с существующим
native HTTP channel. Проверяются UTF8/размер/тип ответа, не возвращается parsed
prefix при отмене; wire buffers очищаются, stream отменяется/освобождается.
Существующие cookie/CSRF/timeouts/session guard и коды API-ошибок сохраняются.
Проверен реальный cloud-sync путь в изолированной fixture, включая смену аккаунта
во время body read и сохранение прежних durable данных. Остальной web API parser
этим ограниченным изменением не переделан.

JS110/110, owned types/scoped lint PASS; static web build PASS. Первоначальный
PHP packaging case не выполнился из-за отсутствующего локального php.exe; после
проверенной установки официального SHA-pinned runtime в новую temp-папку весь
выбранный109-case набор PASS. После дополнительного regression case итог110/110.
Chromium157/IDB17/17 включает все4MiB+6bytes,
независимые hashes, реальные loopback HTTP oversize/UTF8/HTML503 и guards. Один
console503 относится к намеренной /http/error fixture, записан отдельно.

Accepted native input03
8026B1BAF9512B21956B66A14A05EDD3A6E678C830434E43FF7D4B520F694D41:
build SUCCESS31s, JVM195/195,0 failure/skip. API26/API34 — по2/2 new-provider
и2/2 staged regressions; полные4MiB+6bytes/hashes совпали с независимым bounded
Node construction. Native порты здесь — synthetic signed callbacks, не actual
HTTP/backend или product enrollment. Source/APK identities после выполнения
совпали. Новый full Android lint не запускался; он обязателен на release candidate.
Input01 имел ошибку return type в test fixture и не использовался для runtime.
Input02 с успешными provider reports заменён после cleanup regression:
non-byte response chunk вызывал TypeError вместо безопасного protocol error.
Red witness сохранён; cleanup теперь очищает только Uint8Array. Итоговые
JS/browser/native03 относятся к исправленному source.
Точные границы, reports/hashes: e2ee-336-readback-stream.md.

Нужны полная source/plan/coordinator публикация, protected remote originals,
mixed legacy history/custody и настоящий bounded native/WebView input; все11
оставшихся real sources, product lifecycle/recovery/ACL+rotation/Drive/upgrades/
48 scenarios/14-language semantics/independent human review сохраняются.
Coverage9/20, production3.3.5/149, floors0/pilot/cutover off,
GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные устройства/версия не менялись.

## Полная проверка плана через потоковый readback,20 ноября

Следующий component increment сопоставляет ВСЮ ожидаемую inventory с signed
envelope context/signature/payload hash, затем через bounded exact get открывает
все manifests/chunks и проверяет полный исходный SHA-256/size/filename/mediaType.
Payload hash не включает signature, поэтому подпись проверяется отдельно у
каждого ответа. Missing/extra/duplicate/count mismatch, пойманная портом ошибка
sink, concurrent/late callback и retirement не дают complete receipt.
Защищённый local reference повторно читается после remote awaits; локальные
черновики не имеют remote fallback. Local writes/activation здесь отсутствуют.

Native suspending reader использует тот же strict v1 parser/chunk loop, что
sync/batch: настоящий await fetch/ack, cancellation guard и cleanup borrowed
plaintext/private manifest/key bytes. Нет runBlocking bridge или сборки полного
ciphertext/file в массив. Новая explicit bounded capability не выводится из
fail-closed default aggregate ports.

Selected JS133/133, owned types/scoped lint/full build:web PASS. Финальный
Chromium157/IDB15/15/console0 с полным9MiB+7byte original digest PASS.
Native input01 845F51489CB525DF4E604EB5164654045273AECC80A23DA9CC6A9F36BE87D3B7:
build SUCCESS4m22s, JVM203/203,0 failures/skips. Actual API26/API34 — по3/3 новых
cases и4/4 regressions. Каждый полный9,437,191-byte file hash проверен независимым
bounded Node construction, вместе с extracted proof. Регрессии дополнительно
сверяют4,194,310 bytes readback и4,194,408 bytes/six logical hashes, все33 original
rows сохранены. Full Android lint SUCCESS14m6s:0 errors/208 warnings/8 hints,
новых issue/file pairs против original-source-native-lint-01.xml нет. Точные scope,
reports/hashes: e2ee-336-content-plan-readback.md. Synthetic lazy peer не означает
actual HTTP/backend/product migration/custody.

Новый компонент не открывает v3 run: полная state/source/plan/coordinator
публикация, mixed old histories/custody, protected remote originals, настоящий
bounded native/WebView source input и все11 real-source/product/recovery/shared/
Drive/direct-upgrade/48-scenario/14-language/human-review gates сохраняются.
Coverage9/20, production3.3.5/149, floors0/pilot/cutover off,
GENESIS_DEPLOY_ANDROID=false; Deploy/Play/личные устройства/версия не менялись.
