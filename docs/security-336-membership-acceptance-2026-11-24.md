# Общие проекты: приёмка изменения участников 24 ноября

Исходная база7287ac54. Это дополнительная предметная приёмка, не итоговое
крипторевью и не завершение полных сценариев33/34 или выпуска3.3.6.

## Исправленный дефект истории ключей

`genesisE2eeEpochKeys` учитывал bootstrap и rotate, но пропускал
rotate-membership. После изменения участников сервер терял соответствие
эпохи и keyId. Это нарушало полноту проверок выдачи истории новому устройству
и допускало повторное использование такого keyId следующей ротацией.
Теперь обе разновидности ротации входят в один проверяемый журнал эпох.
Web Directory и native E2eeDirectory уже поддерживали rotate-membership;
их код и принятые APK не изменены этим исправлением сервера.

Сохранён RED: output/release-3.3.6/membership-atomic45-1124-red02/
logs/e2ee-membership-atomic.log, E2EE_MEMBERSHIP_EPOCH_HISTORY_MISSING.
GREEN: membership-atomic45-1124-history02/results.json, PASS, cleanup PASS.
Новый backend suite исполнил39 собственных assertions, плюс260 prerequisites
e2ee-store. Проверены реальные SQLite migrations/triggers, P256 signatures,
staging/cancel/lost-ACK replay, три owner rotation под одним writer,
откат ACL/эпох/devices/events/retired manifests после отказа последней ротации,
отказ неполного closure/поддельной подписи, immutable receipt/page readback,
отказ удалённому участнику и сохранность прежних opaque objects для владельца.
Отдельно проверены отказ reuse текущего и уже retired membership keyId,
обязательная выдача исторических эпох1/2 и принятие полного набора grants
новому доверенному устройству. Это CLI/server lifecycle; opaque случайные
capsules/bodies не являются доказательством клиентской расшифровки или UI.

Первоначальные отказы45/02/03 и history01 вызваны setup/assertions тестового
окружения (missing shared include, неверное имя таблицы, ожидания404/count/
directory revision). Они сохранены; в PASS не переименованы. Единственное
изменение production — добавление rotate-membership в историю эпох.
Регрессия e2ee-shared-store также PASS в membership-atomic45-1124-green.

## Планировщик, wire и локальный lifecycle

tests/e2ee-membership-planner.test.mjs:15/15 PASS. Production TS/PHP planners
и codecs независимо сверены по полным результатам и hashes. Проверены role/
remove, последний guest, inherited grants/exclusions, category permissions,
space/Inbox, invitation admission, required ACL suffix, cycle/duplicate/hash
отказы, owner-transfer refusal. Wide fixture содержит210 scopes и208 grants,
с двумя grant pages: усечения после200 нет. Private category title не попадает
в технический wire. Этот тест сам по себе не применяет изменения.

tests/e2ee-membership-staging.test.mjs:6/6 PASS, настоящий production
MembershipAtomicStager с CAS/durable-port моделью и ECDSA packets. После
потерянного ACK/холодного создания модели используются те же подписанные
оригиналы. Частичная local save, missing/substituted pages, смена session и
foreign owner не вызывают transport. Cancel fence сохраняется до подтверждения;
изменение caller inputs не меняет сохранённый план. Local ports здесь in-memory;
этот bounded тест не выдаётся за encrypted IDB/Android process-death приёмку.

## Согласие владельца и финальный apply

Ещё9/9 focused JS PASS:6 owner-review/receipt и3 final-apply lifecycle.
Новый helper создаёт fresh recovery/device keys, настоящие HPKE root capsules,
подписанные bootstrap/migration/enrollment/membership chains. Проверены complete
parts, explicit fingerprint/roster, чужая authority/identity/ownership,
блокирующий private-effects adapter, сохранённый consent до выпуска нового root,
export после restart без новой ротации, stale review после observed commit.
Revoked device не открывает survivor capsule; survivor расшифровывает future
content. Immutable receipt не завершает операцию без обязательного readback;
его отказ можно повторить. Lost final ACK повторяет точный saved POST без
restaging; receipt с failed readback сохраняется и не исполняет commit заново.

Это production classes с реальной криптографией, но local CAS, transport и
normal-repository readback ports здесь model fixtures. Проверка root decryption
не выдаётся за чтение нормального task UI. Private-effects callback проверен как
обязательный blocking capability; полнота его product semantics требует своей
реальной populated приёмки. Начальные setup failures (prototype comparison/
неверное имя suite в harness) исправлены без изменения production guards.

Итого focused JS30/30 PASS. Нужны реальные membership owner-review/apply UI,
нормальное чтение истории новым участником и сводный20-path/48-scenario review.
Все activation/update floors остаются выключенными; APK149 сохраняется.
