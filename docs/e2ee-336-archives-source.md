# Личные архивы: подписанное чтение и transport больших rows

19 ноября 2026. Реализованы backend reader, web collector и native signed API для следующего обязательного
source increment `personal.archives`; это ещё **не готовый source adapter**.
К coverage categories этот reader сам по себе ничего не прибавляет.

`legacy-archives` читает все retained owner rows `backup_stages`,
`backup_safety_snapshots`, `backup_receipts` через тот же подписанный device proof,
lease/fence/source revision и SQLite/personal file barrier, что остальные личные
sources. Сохраняются просроченные stages/safety и точные uncertain operation IDs.
Backup preview/apply/authorize/prune не вызываются; entitlements, identity,
sessions, device approvals и ACL этим чтением не восстанавливаются.

Старый server-at-rest wrapper открывается только внутри действующего lease.
Возвращаются original ciphertext и raw UTF-8 JSON с сохранением duplicate names;
клиент обязан разбирать их строгим parser. Прежний server-known account key
может потребоваться для nested legacy envelopes; новый root/private device key
или recovery secret endpoint не принимает. Reader не создаёт отсутствующий ключ.

Backend `security336-archives-source-backend-01`:3/3 PASS, включая новый reader и
регрессии reminders/mindmaps paging. Проверены owner isolation, signature tamper,
wrong lease/fence/source, revocation/cancel, expired history without pruning,
inert receipts, original duplicate JSON, all141 receipt rows across2 pages,
corrupt wrapper refusal и transformed byte cap. Точные результаты:
`output/qa/security336-archives-source-backend-01/results.json`.

Дополнительная shared-owner boundary02:2/2 PASS. Project owner не получает этот
личный источник. Fragment transport03:3/3 PASS (archives/reminders/shared-store).
Опциональный signed `byteOffset` отдаёт до1MiB original UTF-8 JSON row bytes,
точные row/byte offsets, totals, полную length и SHA-256. Пока row не завершён,
nextOffset остаётся прежним; после завершения row меняется либо EOF. Каждый
fragment повторно проверяет исходный lease/source под writer barrier. Более8MiB
original+decoded row собирается без усечения; тест5MiB plaintext дополнительно
сохраняет original encrypted wrapper, весь join/hash и неверные offsets/empty EOF.
Максимум одного serialized row64MiB, исходный aggregate/source cap128MiB остаётся.
Результат: `output/qa/security336-archives-fragments-backend-03/results.json`.
Этот старый source hash не является будущим remote AAD/object ID.

Web collector проверяет точный header/context, стабильные totals/old-key provenance,
каждый offset/progress/EOF, canonical base64url, полный SHA256 перед fatal UTF-8
и strict duplicate-name JSON parser. До1MiB chunk,64MiB row,128MiB decoded total,
192MiB wire и10000 requests; owned byte buffers очищаются также при смене аккаунта.
Native opaque account key допускается только явно; web не принимает missing key.
Collector возвращает исходные rows, не complete/activation/restore authority.

WebCrypto/JCA emitters обновили cross-platform fixture:24 реальных signed packets,
включая archive fragment, плюс6 tampered offsets в PHP. Backend04:3/3 PASS;
JVM E2eeMigrationTest13/13 PASS. Final fixture SHA256:
`3e71c49ee2257e71a73dfc3399a8ac2527c4cbec420a00618cb3ccd2eae600bf`.
Focused web transport/migration87/87 PASS после regeneration fixture. Более8MiB
row, UTF-8 byte splits, duplicates/tamper/truncation/key loss проверены.
Static web build01 PASS:98 HTML/14 языков, exact dictionaries,280 gallery images,
offline precache. Native reassembly SUCCESS1m23s; это не device acceptance
нового archive API и не повтор full JVM/lint.

Evidence: `output/qa/security336-archives-cross-platform-04/results.json`,
`output/release-3.3.6/runtime/archives-fragments-js-fixtures-02.log`,
`archives-fragments-native-jvm-summary-01.json`,
`archives-fragments-native-assembly-identity-01.json`,
`archives-fragments-web-build-01.log` (последние4 под тем же runtime).

Web local capture теперь сохраняет все owner safety/held entries, memory-only
quota safety, actual mounted/detached BackupPanel и выбранные file bytes. Actual
Chromium/React/File/WebCrypto/IDB14 assertions PASS; полный JS1719/1719. Это
только protected source input primitive, без reconciliation/complete authority.
Приёмка и точные ограничения: `e2ee-336-archives-local-capture.md`.

Native fragment collector теперь проверяет те же lease/context/totals/key
provenance, offsets/EOF, row SHA256 и fatal UTF-8 с теми же64MiB/128MiB/192MiB/
10000requests пределами. Он сохраняет ORIGINAL row JSON как строки: Android
JSONObject не получает возможность заменить duplicate names. Общий TypeScript
`normalizeNativeArchiveRows` затем применяет strict duplicate-name parser и
отказывает, если старый account key не удалён из JS capability. Этот raw transport
не является source adapter и ещё не подключён к product migration/restore.

Focused JS41/41; JVM collector/pages/migration29/29 PASS (13 новых collector
cases,3 pager и13 coordinator/transport). Build01 SUCCESS8m22s, test-emitter02
SUCCESS45s; это JVM compilation/acceptance, не новая Android assembly/device/lint
проверка collector. Native collector с one-byte Unicode fragments реально выдал
fixture для common parser:6 cross-platform assertions PASS,4 exact rows, duplicate
names и raw old key отказаны. Fixture SHA256
`1fa8d6ea9163e741f2a408bf1adf2f2ff796b9accd5c89f3a78de8ad78bdb3b3`.
Types01/scoped lint02 и web build01 PASS:98 HTML/14 languages, exact dictionaries,
280 gallery/offline assets. Полный JS1719 относится к предыдущему capture increment,
не заявлен повторённым после этих новых exports.

Evidence под `output/release-3.3.6/runtime/`:
`archives-native-fragments-jvm-summary-02.json`, `...jvm-02.log`,
`...cross-01.json`, `...vector.json`, `...js-01.log`, `...types-01.log`,
`...lint-02.log`, `...web-build-01.log`. Existing native release/package/signature,
floors/cutover и production сохранены.

Остаются native archive/import files inventory,
strict nested content reconciliation web/native,
retained old-key availability и new-root readback/recovery. Cap generic pager
8MiB включает original+decoded payload: превышение явно отказывает; fragment
transport сам по себе не является готовым переносом. Большие архивы нельзя
усекать или заменять empty. Общий content-only import, Drive, normal product
routing, direct upgrades, исходные48 сценариев и независимый human crypto review
остаются обязательными. Pilot/cutover/floors и production не менялись.
