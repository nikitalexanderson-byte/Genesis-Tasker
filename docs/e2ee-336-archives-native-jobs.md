# Native backup: одна owner capability на полное действие

19 ноября2026, выбранная приёмка завершена. Это normal-operation hardening,
не готовый `personal.archives` source; coverage остаётся9/20. Native file/form
inventory, nested content reconciliation и new-root restore ещё нужны.

## Реализованный контракт

Actual BackupPanel runtime получает caller-selected operation UUID до чтения
файла, local capture, crypto, HTTP, SAF waits и финальных receipts. Native
capability удерживает прежний owner mutex между RPC; nested Store/HTTP берут
уже принятую capability. UI double click и повторное начало до получения begin
receipt запрещены. History timestamps записываются синхронно внутри этого же
действия, без отложенного React updater с уже закрытым token.

Без capability разрешён только read-only startup status, проходящий свой обычный
owner gate. Остальные backup RPC и history writes требуют token этого native view.
End разрешён после истечения сессии; он сначала инвалидирует capability и ждёт
фактического завершения принятых native children. Lost begin receipt очищается
по caller-selected ID; end до позднего begin не позволяет опубликовать capability.
Закрытие view инвалидирует все его permits. Map и replay IDs ограничены.

Permit lifetime привязан к исходной app account epoch. Проверка действия по-прежнему
требует gateway/session; lifetime guard её не заменяет. Единственное намеренное
исключение — собственный verified backup reset, который retire свои HTTP clients.
Он сохраняет исходную account activation, завершает durable safety/acceptance,
затем освобождает permit. Restart разрешён единожды после verified reconciliation
и закрытия capability; его нельзя использовать как standalone reset authority.

Следующий инкремент20 ноября добавил полный многовызовный web permit:
`e2ee-336-archives-web-jobs.md`. Native mounted/
detached forms ещё не сохраняются этим job-контрактом. Это отдельные release gates.

## Доказательства и оставшаяся приёмка

- Focused JS72/72 PASS, включая7 новых operation-session races,24 capture/backup
  regressions и41 fragment/normalization case. Types02/scoped ESLint02 PASS.
  Initial lint отказал на throw inside finally; helper теперь сначала сохраняет
  исходную ошибку, затем выполняет cleanup и только после него возвращает/бросает
  результат. Ни original failure, ни cleanup failure не становятся success.
- Full JS1732/1732 PASS, failures/skips0: `archives-native-job-full-js-02.log`.
  Initial01 имел1 environment failure: неполный default PHP directory. В02 задан
  explicit проверенный owned GENESIS_QA_PHP; product dependencies не менялись.
- Повтор actual Chromium157/React/File/WebCrypto/IDB capture:14/14 PASS,
  console0 errors/warnings. Selected file, detached form и uncertain IDs читаются
  после cold unlock/удаления originals fixture. Это web capture regression,
  не native capability или полный product restore.
  `output/playwright/security336-archives-capture/results-job-02.json`,
  `before-detach-job-02.png`, `after-cold-unlock-job-02.png`.
  Bundle SHA256 `f2d21acd5c34583505511053d19479abc4c62e228c64418632cfbe5eec2f0e18`.
  Own browser session и loopback listener закрыты.
- Native build01 остановлен агентом до приёмки: self-review нашёл, что bounded
  E2EE error code из нового guard превращался в generic BACKUP_NATIVE_FAILED.
  Исправлен enum-pattern, failure/stop evidence сохранены. Это не внешний crash.
  Build02 SUCCESS20m3s; focused backup/collector JVM34/34 PASS. Android lint:
  0 errors/206 прежних warnings/8 hints. Это не повтор всех1209 прежних JVM suites.
- Actual API34:16/16 PASS, failures/skips0. Все6 новых whole-job bridge cases,
  6 operation-fence,2 reset/reconciliation и2 реальных SAF/journal-choice flows.
  Проверены waiting migration между RPC, nested HTTP, early end с draining,
  потерянный/поздний begin, same-UID relogin/view close, отсутствие mutation без
  capability и verified reset, который retire свой gateway до единственного restart.
- Actual API26/provider113: те же16 принятых cases, failures/skips0, на тех же APK.
  Первые14 headless/bridge cases PASS; два UI cases первоначально отказали до
  действий приложения: stock AOSP statementservice упал после установки APK,
  его system error dialog забрал window focus. Cause/PNG сохранены. В повторе
  закрыто только наблюдаемое окно этого конкретного сервиса на exact own AVD;
  verifier/permissions/AppOps не отключались. Оба реальных SAF/journal UI cases
  затем PASS. Два PNG в light/dark просмотрены; это не полная визуальная матрица.
  Optional runner flag до build/install/reset отказывает любому другому target;
  expected-refusal03 подтвердил exit1/NOT_RUN/0devices/0cases.

Combined evidence: `runtime/archives-native-job-device-summary-02.json`,
`output/qa/security336-archives-whole-job-api34-01/results.json`,
API26-01 (initial failures retained) и API26-02 (UI retry). API35 для этого нового
job increment не повторялся. Native hash:
`150B241A7BA945E06D9103DB27CD2CF14041062D4105981E2A8767CCA0A8500F`.
Main APK SHA256:
`D20C3E44975C79F3C9BB7E64EF6B15214B2CD7929EE7C745F3C5F3535E28B7BE`;
test APK:
`5E0FE7CA37166D0031353A5803FF5F2052588294AC6E489CAF04F016A28BD857`.
Final native collector output снова прошёл6 cross-platform checks;
fixture byte-identical (`archives-native-fragments-cross-02.json`). Web build02
PASS:98 HTML/14 languages, exact dictionaries,280 gallery/offline assets.

Runtime logs находятся под `output/release-3.3.6/runtime/archives-native-job-*`.
APK/package/release certificate, production3.3.5/149, floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false сохранены. Deploy/Play/личных устройств не было.

## Ответ, ожидающий UI dispatch: проверенный инкремент20 ноября

20 ноября: выбранная implementation/acceptance завершена. Предыдущая проверка gateway
проходила до `withContext(Main)`; account epoch могла смениться, пока уже готовый
private reply ожидал UI queue. Actual view ещё мог оставаться mounted до Compose
dispose. Теперь owner/session проверяется также непосредственно перед `deliver`.
При смене аккаунта в UI выходит только bounded owner error. Поздний begin receipt
сразу закрывает свою native capability; caller-selected cleanup остаётся допустим.
Собственный verified reset сохраняет исключение только для прежней app activation.

Два новых actual bridge regressions приостанавливают ответ между IO и Main
publication: private server-snapshot reply после смены аккаунта и begin receipt
после logout/login в тот же UID. Test-only scheduling callback находится только
в native constructor, не в JavascriptInterface и не в provider/server API.
В build03 JVM34/34 и actual API34 whole-job class8/8 PASS, включая обе новые
гонки Main queue. Его lint остановлен агентом после assembly/приёмки, чтобы
завершить guard также в renderer queue перед окончательной общей проверкой.
Это не отдельный внешний crash/не полный successful lint03.

Final implementation04 добавляет native `currentSession(operationId)` и проверку
этого bound owner/permit в JavaScript непосредственно перед promise adoption.
Actual BackupPanel account guard и document access больше не используют no-op
в native entry. Исключение после intentional transport retirement допускается
лишь для прежней account activation и ещё живой capability собственного verified
reset; оно не разрешает новый API/write. Только exact `true` end и empty-object
restart receipts могут завершаться без текущей transport session. Malformed,
смешанные или private cleanup replies запрещены; native exception details не
становятся JS error text. Коды существующих subscription/auth ошибок сохраняются.

JS78/78 и полный1738/1738 PASS, failures/skips0; types04/scoped lint04 PASS.
Native build04 SUCCESS20m34s; focused backup/collector JVM34/34 PASS, failures/
skips0. Lint0 errors/206 прежних warnings/8 hints. Native source hash до/после
сборки совпал:
`971BF938347356691EDD15ACF89E1C8112464ACADFCEE3774EF049F854D49861`.
Main APK SHA256:
`F0F88954A7EF0DED986DA095A626F193836B96683ECFB75EEE73A7E7189FE1CA`;
test APK:
`33400DF71B094BC0F928EC4B3EA0B45759094E25438815D56D73BE3329884FB6`.

Actual API34 и API26/provider113: по19/19 PASS, failures/skips0 на тех же APK:
9 whole-job cases,6 operation-fence,2 reconciliation и2 реальных SAF/journal UI
flows. На API26 runner закрыл только наблюдаемое stock statementservice crash
dialog; действие записано, verifier/permissions/AppOps не отключались. API35
для этого reply delta не повторялся. Прежние16/16 относятся к build02;8/8 — к03.
Это не полная product lifecycle, source/recovery или визуальная приёмка.

Evidence: `output/qa/security336-archives-reply-api34-04/results.json`,
`output/qa/security336-archives-reply-api26-04/results.json`,
`runtime/archives-native-reply-device-summary-04.json`, `archives-native-job-identity-04.json`,
`archives-native-job-jvm-04.json`, `archives-native-job-lint-04.xml`,
`archives-native-reply-{js,full-js,types,lint}-04.log` под
`output/release-3.3.6/`. Coverage остаётся9/20; production3.3.5/149,
floors0/pilot/cutover off и GENESIS_DEPLOY_ANDROID=false сохранены.
