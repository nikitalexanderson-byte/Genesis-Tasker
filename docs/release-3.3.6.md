# Подготовка GENESIS 3.3.6

Последний инкремент18 ноября: отдельные append-only encrypted journals Авроры и
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
