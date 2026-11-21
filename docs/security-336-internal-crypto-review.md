# GENESIS 3.3.6: внутреннее повторное крипторевью

21 ноября 2026. Выполнено по поручению владельца самостоятельно перепроверить
криптографию. Это review тем же AI-исполнителем, который участвует в разработке,
а не независимое человеческое заключение или разрешение на активацию E2EE.
Независимый специалист пока не выбран. Материалы никому не отправлялись.

## Срез и вывод

Проверяемая база — `faa7d1ebae5bace1c0a55447dbbe2dad65411bee`, ветка
`codex/security-336`, плюс явно перечисленные исправления этого review.
Идентичность локальных входов/артефактов сохраняется в `output/release-3.3.6/runtime/`
под префиксом `self-review-`. Исходный prompt не изменён. Предыдущий ZIP
`genesis-security-core-faa7d1eb-2026-11-21-02.zip` относится к базе ДО этих
исправлений; его нельзя представлять как новый проверенный кандидат.

Обнаружены и воспроизведены шесть классов дефектов на границах ключевых API и
истории доверия. Исправления сохраняют wire protocol, suite, ключи, старые
данные и подпись приложения. Проверки не выявляют взлома production3.3.5:
новое ядро ещё не включено. Итог для полного продукта — **NO-GO для pilot/cutover**,
пока не завершены перечисленные ниже интеграция и системная приёмка.

На срезе review незавершённый web-инкремент `RemoteOriginalRegistration`/descriptor
присутствует в рабочей копии и некоторых общих прогонах. Он не входит в
исправления review, не принят нативно как новый API и не закрывает state4.
Его наличие в fingerprint APK не меняет этот статус.

Последующая отдельная web/native приёмка registration/descriptor описана в
`e2ee-336-remote-registration.md`. Она не изменяет frozen evidence этого review,
не включает state4/custody и не превращает внутренний review в независимый.

## Проверенный объём и модель угроз

Ручной разбор выполнен для web `envelope`, `keys`, `commands`, `directory`,
`device-vault`, `storage`, `files`, соответствующих native envelope/keys/directory/
device vault и server `e2ee-envelope.php`, `e2ee-commands.php`, `e2ee-store.php`,
`e2ee-api.php`. Сверены ADR, внешний review brief, текущий staged coordinator
и открытая матрица48 сценариев. Это не повторная построчная проверка всех
feature adapters и каждой legacy/native/WebView ветки.

Рассмотрены неверные типы ключей, подмена owner/scope/epoch/key/recipient,
заимствованные mutable bytes/JSON, асинхронная смена данных, повреждение
подписей/обёрток/tag, устаревший directory checkpoint, роли и отзыв устройств,
повторы/CAS, порядок/полнота файлов и границы восстановления. Все исполнения
используют только публичные синтетические vectors либо свежие тестовые ключи.
Production, реальные пользователи, Play и личные устройства не затрагиваются.

Рейтинг ниже описывает последствие нарушения контракта компонента при указанных
предусловиях. Это не оценка доказанной удалённой эксплуатации production.

## Воспроизведённые дефекты и исправления

| ID | Риск и необходимые условия | Исправление и доказательство |
| --- | --- | --- |
| CR-01, высокий | Untyped JS caller передаёт строку длины32 вместо `Uint8Array`. Проверялась только `.length`, а `new Uint8Array(nonNumericString)` создавал ПУСТОЙ HKDF IKM. Ciphertext удавалось открыть по публичным salt/nonce/AAD с пустым IKM | Строгая проверка byte view и размера фактической принадлежащей модулю копии. RED использует отдельные Node `hkdfSync`/OpenSSL AES-GCM, не `openBundle` GENESIS. Native `ByteArray` не имеет такого строкового преобразования |
| CR-02, высокий при небезопасной интеграции | Caller очищает/переиспользует ключевые bytes сразу после вызова async API. Bundle plaintext и HPKE root копировались после await; provisioning/unlock повторно читали caller-owned recovery secret. Получались другие/нулевые данные, непереносимый vault; resizable input мог обойти предварительный лимит | Входные bytes и recovery kit принадлежат операции до первого await. Проверяется размер копии; принадлежащие операции буферы очищаются в finally. RED и cold reopen доказывают сохранение исходного секрета/данных |
| CR-03, высокий в контракте root forwarding | Mutable target проходит проверку same-owner/scope/epoch/key, затем меняется во время HPKE await. Root пересылался уже под изменённой привязкой. Изменяемые capsule/private-key/authority fields также читались после await | Собственные снимки exact data descriptors и технического контекста, snapshot ciphertext до HPKE, отказ от accessors без их выполнения. Прямая смена scope и её async-вариант больше не расходятся |
| CR-04, средний/высокий для antirollback | Сохранённый trusted checkpoint передан изменяемым объектом и снижен caller во время проверки. Подписанный усечённый roster принимался относительно уже другого checkpoint | Web фиксирует checkpoint до первого await. RED реально принимал усечённую цепочку; исправление отвергает её. Native `Checkpoint` уже имеет immutable val-поля |
| CR-05, средний | Проверяется snapshot directory, но persist использует исходные mutable pin/events; observer мог изменить их между проверкой и записью. В native observer-frame дополнительно разделял mutable JSON recovery kit/capsules с проверяемым состоянием. Web durability acknowledgement сравнивал ciphertext/salt/nonce, но не проверял identity headers/extra fields, мешающие cold unlock | Web/native сохраняют именно принадлежащие операции pin/events. Native observer получает глубокую отдельную копию kit/current/history capsules. Web durable-key check сравнивает exact полный bundle с проверенным immutable record. RED web воспроизводит отказ cold savedDirectory после успешного remember и ложный durability acknowledgement; RED JVM — изменение authenticated authority через observer |
| CR-06, средний, lifecycle integration | `bindWebVaultLifecycle` ожидал будущего visibilitychange. Если document уже hidden при привязке, unlocked capability оставалась доступной до следующего события | Начальное visibility state проверяется сразу после установки listeners; hidden/unknown state блокирует capability. RED доказывает отсутствие ожидаемой блокировки; проверка охватывает также отказ чтения сохранённого draft |

Тесты: `tests/e2ee-key-input-audit.test.mjs` —9 новых boundary cases;
`tests/e2ee-device-vault.test.mjs` —5 новых lifecycle/persistence cases;
`tests/e2ee-directory.test.mjs` —1 новый checkpoint case;
native `E2eeKeysTest` —1 новый observer case; отдельный instrumented
`E2eeKeyAuditDeviceTest` проверяет actual device-vault/directory cold read.
Observer frames по-прежнему являются предварительным сбором истории: они не
разрешают публикацию до успеха всей цепочки, pinned checkpoint и durable CAS.

## Криптографическая композиция

- AES-256-GCM, AES-256-KW и P-256 signatures выполняют WebCrypto/JCA/OpenSSL.
  HPKE использует закреплённые `@hpke/core1.10.1` и native BC1.87; собственного
  AES/ECDH/HPKE алгоритма здесь нет. Наличие стандартных primitives не доказывает
  корректность их продуктовой композиции.
- В каждом seal новый случайный DEK и96-bit nonce; retry повторяет готовый
  envelope. AAD связывает owner/scope/domain/object/schema/generation/epochs/
  revision/key/device/operation. Подпись включает wrapped DEK, nonce и SHA256
  ciphertext/tag. Для проверки используется доверенный directory signer.
  Server cap2^32 seal/epoch не заменяет ограничения ещё неподключённых writers.
- Canonical binary context/commands не зависят от JSON order. Safe integers,
  bounded base64url, P-256 и DER/P1363 проверяются отдельно. ES256 допускает
  malleability proof bytes; operation identity исключает proofs, а проверка
  подписи/authority остаётся обязательной. Приёмка PHP сохраняет это разделение.
- HPKE info и HKDF/AAD разделяют owner, scope, epoch, key, recipient и назначение.
  Recovery требует отдельного256-bit секрета и доказанной пары ключей; Google
  identity, billing или server approval не являются crypto authority.
  Наличие32 bytes не доказывает энтропию: продукт должен выдавать CSPRNG secret,
  а не принимать пароль как secret. Низкоэнтропийный password vault этим review
  не спроектирован и не разрешён.
- File manifest аутентифицирует набор, порядок и размеры chunks, private file
  key и metadata. Prefix output остаётся quarantine до полного EOF/manifest.
  CAS/lock проверки local vault важны независимо от криптографии envelope.

Новых оснований менять suite/wire format в рассмотренном объёме не найдено.
Это ограниченный вывод по коду и тестам, не доказательство отсутствия дефектов.

## Доказательства

RED сохранены отдельно: `self-review-key-input-red-01.log` (0/5),
`self-review-vault-red-01.log` (3/6), `self-review-checkpoint-red-01.log` (8/9),
`self-review-native-red-01.log` и `self-review-native-red-unit-01.json` (0/1),
`self-review-durability-lifecycle-red-01.log` (6/8).
Отрицательные прогоны не переименованы в успешную приёмку.

Текущая web/серверная приёмка:

- Core web regression84/84, общий JS2000/2000 (`self-review-full-js-03.log`).
  В общий прогон входят ранее существующие remote-registration WIP tests;
  это не доказательство готовности их нативной интеграции.
- Actual Chromium157:31/31, secure WebCrypto, настоящий IndexedDB, cold reopen,
  сохранённый draft, отказ lowered checkpoint и lock. Console0 errors/0 warnings.
  `self-review-browser-03.json` содержит SHA256 точных bundled inputs. Изменение
  key bundle headers выполнено через реальную IDB transaction; строки контента
  до/после отказа совпадают. Hidden-at-binding отдельно проверен через synthetic
  lifecycle target в настоящем browser; полный системный background UX не заявлен.
- Scoped ESLint и owned TypeScript PASS. Static web build сохраняет прежние
  public routes/14-language catalogue/gallery/documents; точный log ниже.
- Четыре fresh isolated PHP8.4 suites PASS: envelope, store, shared-store,
  migration-transport. `output/qa/security336-self-review-core-01/results.json`.
  Это logic/integration на тестовом SQLite; live backend/Hostinger не менялись.

Native acceptance:

- Новый build SUCCESS10m48s, JVM249/249 across33 suites;0 skipped/failures.
  Native observer RED0/1 был получен до исправления на отдельном input.
- API26 `emulator-5594` и API34 `emulator-5578`: каждый12/12 без skipped.
  Это1 новый actual user-presence Keystore/SQLite directory cold-read case,
  2 envelope/provider,4 protected-original и5 actual HTTP regressions.
  System credentials подготовлены только на двух именованных QA AVD; API26
  использовал наблюдённый Confirm PIN flow, API34 — системную проверку тестового
  credential. Первоначальное отсутствие PIN восстановлено и перепроверено.
  Основной package/личные устройства не менялись.
- Полный lint SUCCESS14m46s:0 errors/208 warnings/8 hints; новых issue/file pairs
  относительно последней принятой HTTP policy нет. Финальные2 web guards после
  этого получили новый frozen input, повтор assemble/unit/lint SUCCESS51s.
  Нативные задачи анализа остались UP-TO-DATE; обе APK воспроизведены ПОБАЙТНО.
  Повторять platform cases для идентичных бинарников не требовалось: их связь с
  финальным input отдельно проверена в `self-review-device-final-binding-02.json`.
- Final input: `D5D689C2D1CE520004BB9998A5FC6C96FC6D131BA002B03DC4D5AFE21AAF837F`.
  Исходный platform input: `531CD21B9180CB6BD3AEC9847E4CD0183C0554397E5C8D8F3B6795BA2AFF71E8`.
  Main QA APK: `776ED5A41F8D7DAA7E38276680156575F3175A91E8A814E0A76ACFE6E12A3208`.
  Test APK: `D44A212675BA6A6E1410A09A47116A89D44D55F01F5CD855A25A5EEE711D9401`.
  Post-device, final input/APK/lint identities проверены отдельно. Это не release
  certificate/upgrade, физический/OEM device, live TLS/backend, настоящий process
  death или clean-device recovery полного аккаунта.

Окончательные logs: `self-review-native-final-02.log`, `self-review-native-unit-02.json`,
`self-review-native-final-identity-02.json`, `self-review-native-lint-02.xml`,
`self-review-native-lint-delta-02.json`. Старые APK/input1E4FEB... и промежуточный
web report02 не подтверждают финальное состояние review.

## Незакрытые условия полного E2EE

| Граница | Остаток и почему нельзя закрыть этим review |
| --- | --- |
| Полнота данных | Реальных source categories9/20; ещё11: personal archives/local-work,6 project и3 space. Статические registry/hash inventories не доказывают переноса каждого body/draft/queue |
| Миграция | Mandatory protected remote capture в реальных factories, pre-network reservation, state4/source/plan CAS, полный readback и global capacity пока не собраны в один продуктовый путь |
| Original custody и process restart | Same-active-actor quarantine не даёт authenticated handoff старых keys/roots/signer на другом устройстве. Реальные bounded WebView roles и nested legacy key/AAD ещё обязательны |
| Нормальная работа и recovery | Все writers/background paths, unlock/enrollment/recovery, файлы/Drive и clean-device восстановление ещё не приняты во всём охвате. Неуспех не разрешает empty vault/fallback/удаление старых оригиналов |
| Общие данные | Нужны explicit authorized source predicates и атомарные ACL-change + independent-root rotation. Conservative source token/inventory не является read grant |
| Доставка | Signed direct upgrades старых версий,48 system journeys и14-language semantic/visual security UX не завершены. Эти строки не закрываются1998 unit tests |
| Независимость | Review выполнил тот же AI-разработчик. Тестовые библиотеки и разные crypto providers дают отдельные oracles, но не независимую экспертизу полного протокола человеком |

Дополнительные пределы обещаний: trusted client/code delivery входит в модель
доверия. Код того же origin при разблокированном web vault способен использовать
его capabilities; CSP и `extractable=false` не исключают злонамеренную замену
самого клиента владельцем origin. Сохранённый checkpoint ограничивает rollback
от известного anchor, но без внешнего witness свежий клиент не докажет отсутствие
полного server fork. Уже раскрытые старые данные/прочитанная история не становятся
секретными задним числом; forward secrecy/MLS/ratchet не заявляются.
Очистка принадлежащих модулю массивов не обещает стирания immutable strings,
всех копий в управляемой памяти или внутренних буферов JCA/WebCrypto/HPKE.

Production сохраняет3.3.5/149, floors0, pilot/cutover off,
`GENESIS_DEPLOY_ANDROID=false`. Результат review не разрешает включение E2EE
и не является публикацией3.3.6.
