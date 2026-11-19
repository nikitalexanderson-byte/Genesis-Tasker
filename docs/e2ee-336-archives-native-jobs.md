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

Обычные web jobs пока используют прежние transport guards и capture task counter;
полный многовызовный web permit ещё требует собственной интеграции. Native mounted/
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
