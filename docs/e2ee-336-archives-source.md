# Личные архивы: подписанное чтение retained server history

19 ноября 2026. Реализован только backend reader для следующего обязательного
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

Остаются web/native transport и настоящий capture всех local archives/import
staging/memory/held/safety/native files; strict nested content reconciliation,
retained old-key availability и new-root readback/recovery. Cap generic pager
8MiB включает original+decoded payload: превышение явно отказывает; клиентский
fragment collector ещё обязателен, backend-only chunks не являются готовым
переносом. Большие архивы нельзя усекать или заменять empty. Общий content-only import, Drive, normal product
routing, direct upgrades, исходные48 сценариев и независимый human crypto review
остаются обязательными. Pilot/cutover/floors и production не менялись.
