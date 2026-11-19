# Личные задачи: реальные web/native sources

19 ноября2026. Продолжение signed server source из `e2ee-336-tasks-source.md`.
Это подготовка клиента за выключенным cutover, не завершение3.3.6.
Production3.3.5/149, floors0, Android deploy false сохраняются.

## Сохранение и разрешение вариантов

Web захватывает exact owner cache, исходные pending/deletion строки, старую
ключевую metadata и mounted tasks/editors до любого private read. Обычные
readPending/writePending не вызываются: unscoped bytes не присваиваются текущему
аккаунту, malformed JSON не превращается в пустую очередь, предел2000 не
урезает историю. Смена аккаунта/поколения/предыдущего защищённого snapshot
блокирует перенос. Все исходные записи остаются на месте.

Подписанный server read добавляет все7 таблиц. SQL content переводится без
удаления полей; raw originals, ссылки на отсутствующие historical dependencies,
recovered ciphertext/revisions и exact creation states сохраняются. Recovered
records открываются только прежними ключами и прежним owner/purpose AAD.
Сервер не получает новый root. Обычный task bootstrap, синхронизация Google/
Яндекса и acknowledgement не являются частью source reader.

Чистый cache не отменяет tombstone. PUT из offline queue заменяет старую
display copy, но не выбирается вместо независимого remote изменения по одному
updatedAt. Delete/edit и независимые варианты требуют точного выбора из
показанных источников; неизвестный choice не является согласием. Mounted edits
используют base для three-way merge. Потерянный base и попытка создать запись
с уже удалённым ID требуют review. Повторы, исключения, detached originalDate,
три календаря, project/category references и reminders сохраняются.

Task IDs/даты/provider IDs находятся внутри ciphertext. Внешние record IDs —
случайные UUID, список хранится в зашифрованном index. Raw HTTP path/method/keys
остаются только в защищённом local snapshot. Исторические server creation
receipts — inert private history, не права выполнить provider request.
Каждый record отмечен requires-new-consent; обычный reader выключает прежние
sync/create flags, не удаляя исходные provider identities и варианты.
Product consent UI и последующая активная запись ещё должны быть подключены.

## Native boundary

Источник читает реальные Room tasks, включая deleted, revisions, raw ciphertext,
исходные plaintext strings, outbox и имеющийся wrapped old key. Orphan/stale
queue не исчезает при фильтрации. Три workspace queue IDs принадлежат отдельному
source; unknown operation требует review. Key loss не создаёт replacement.
Прежние keys и новый root не входят в isolated WebView. Native opening port
ограничен exact captured recovered ciphertext и owner/purpose; он возвращает
оригинальный JSON text для общего parser. В новом root отдельно сохраняется
native history с revisions, ciphertexts и inert retained operation markers.

CloudTaskSync удерживает owner permit от первого decrypt до ответа/commit/ack.
Persistent migration fence проверяется до ключа/HTTP. Owner generation/epoch
проверяются до подтверждения операции. Фоновая account sync получает permit
перед dataSyncMutex, nested HTTP/flush заимствуют capability; migration capture
ждёт завершения уже выполняющегося ответа и acknowledgement.

## Проверенный объём и текущие ограничения

- `runtime/tasks-producer-state-tests-07.log`:57/57 JS PASS, включая настоящий
  PersonalTasksSource через coordinator, encrypted snapshot до сети, crash/retry
  shadow plan и ordinary new-root E2eeScopeClient read. Остальные категории в
  этом fixture synthetic, это не приёмка полного продукта.
- `runtime/tasks-producer-state-full-js-03.log`:1510/1510 полный JS regression PASS
  после duplicate-key и actual-producer state fixes. Typecheck, scoped repository
  lint и web build после parser fix PASS:
  `tasks-parser-typecheck-final-05.log`, `tasks-repo-lint-final-06.log`,
  `tasks-web-build-final-02.log`. Lint0 errors/4 прежних img warnings;
  чужой untracked demo-output исключён, не изменялся.
- Chromium157, actual WebCrypto/localStorage/IndexedDB/device vault:14/14 PASS,
  новый connection после lock, private queues byte-identical, внешний IO
  запрещён CSP, console0 errors/warnings. Логи `tasks-browser-*-final-03.log`,
  screenshot `output/playwright/tasks-source-browser-336-final.png`. Signed server
  reply synthetic. Это source/vault acceptance; coordinator отдельно проверен
  в JS fixture, actual authenticated HTTP остаётся общим этапом приёмки.
- `runtime/native-tasks-source-api34-initial-01.log`:11/11 PASS. Настоящие Room/
  Keystore/packaged engine/new-root SQLite:4 source cases и7 CloudTaskSync cases.
  Включены invalidated key, orphan queue, A→B→A, persistent deny-before-decrypt,
  inflight response/ack drain и сохранение старой очереди после late owner change.
  QA package ru.genesis.calendar.qa1103.debug, metadata3.3.5/149, данные не очищались.
- Дополнительный negative test выявил, что backupJson использует JSON.parse и
  сам по себе не отказывает повторяющимся ключам. Добавлен ограниченный lexical
  preflight task source после grammar/node/size validation: повторяющиеся decoded
  names, включая Unicode escapes и nested fields, дают отказ. JSON в текстовом
  поле не является структурой документа. Raw native text проходит эту проверку
  до projection. Исходные failed logs сохранены: `tasks-web-source-tests-05.log`,
  `native-tasks-duplicate-json-api34-initial-01.log`; исправленный случай прошёл
  JS, настоящий Chromium и обе финальные native suites.
- Native main/test APK и6/6 JVM source tests PASS,0 failures/errors/skips.
  `native-tasks-source-build-01.log`:16m57s, lint0 errors/206 прежних warnings/
  8 hints. После parser fix обновлены packaged JS assets и APK:
  `native-tasks-parser-final-build-02.log`,40s. Основные Kotlin файлы после
  проверки lint не менялись.
- API34 и API35: по43/43 PASS, `native-tasks-final-api34-02.log` и
  `native-tasks-final-api35-01.log`. Все5 task source cases,7 actual CloudTaskSync
  cases и31 regression остальных real sources/cache/transport/timezone. Старые
  keys не нужны для чтения нового root; raw source/outbox остались неизменны.
- Сверка actual producer показала: personal_task_creations.state содержит target
  fingerprint, а не task JSON. Теперь сохраняются raw string bytes; чужой формат
  не превращается в новую задачу или право повторить provider IO. Дополнительный
  JS regression PASS; native test добавил настоящий64-character fingerprint и
  проверил его new-root read. Final main/test APK +lint PASS в2m9s:
  `native-tasks-producer-state-final-build-03.log`; по5/5 native source cases
  повторены на API34/35: `native-tasks-producer-state-api34-03.log`,
  `native-tasks-producer-state-api35-02.log`.
- Свежий `pnpm audit --json`:0 critical/high/moderate/low/info,
  `dependency-audit-tasks-2026-11-19.json`. Это registry advisory check, не
  независимая экспертиза протокола или гарантия отсутствия уязвимостей.
- API26:25/25 actual Room/Keystore/task queue/transport/cache/timezone cases PASS,
  `native-tasks-storage-api26-01.log`. Содержит все7 CloudTaskSync cases.
  Это не successful task source migration на Chromium69: shared engine требует
  совместимый provider; прежняя проверка old-provider fallback сохраняется.

Теперь real-source coverage5/20: workspace, Aurora, Stoicheion, Advice и tasks.
Это число adapters, не полнота всех данных каждого аккаунта. При actual-producer
review также найден server-side Google snapshot вне SQL. Его inventory, source
token и operation/file lock boundaries ещё не подключены: это обязательный
release blocker, `e2ee-336-provider-cache.md`, до любых product pilot/cutover.
Полный task source на совместимом API26 WebView и authenticated/default-inventory
acceptance остаются непроверенными. Product
unlock/bootstrap/editor/background routing, consent, recovery/direct upgrades,
shared rotation/files/automation, остальные source categories, offsite schedule/
restore drill,48 scenarios, смысловая вычитка security UI14 языков и независимый
crypto review остаются условиями полного внедрения. Daybreak scan не запускался:
его tools требуют отдельного явного запроса на эту службу. Это не результат
внешнего security/crypto review.
