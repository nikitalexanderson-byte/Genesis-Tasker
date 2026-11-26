# Напоминания: source capture и сохранение истории, 19 ноября 2026

Статус: web/API/shared reconciler/native source и normal-writer guards прошли
описанную ниже source-приёмку. Это девятый source increment, не выпуск3.3.6 и не
включение E2EE. Production3.3.5/149, floors0, pilot/cutover off и
`GENESIS_DEPLOY_ANDROID=false` сохраняются. Счётчик принятых source categories
теперь9/20; это не процент готовности релиза. Все48 исходных системных сценариев,
остальные категории и независимый human crypto review остаются обязательными.

## Источники и полномочия

`personal.reminders` охватывает все6 retained owner tables:
`habit_reminder_profiles`, `habit_reminder_devices`, `habit_reminder_deliveries`,
`advice_notification_days`, `advice_notification_deliveries`,
`shared_notification_preferences`. Новый `legacy-reminders` — только подписанное
чтение под действующим lease/fence/sourceHash/checkpoint, текущим устройством,
owner-only scope и той же SQLite writer/file barrier. Читаются также disabled
devices, expired, failed/cancelled/sending jobs и старые request IDs. Обычные
status/schedule/prune/receipt helpers не вызываются; новые jobs не появляются.

Старые server-at-rest plan/target открываются **на старом сервере**, поскольку
это исходный читаемый сервером формат, а не E2EE. Возвращаются оригинальные
ciphertext и исходный UTF-8 JSON без нормализации/потери duplicate property names.
Общий pager считает реальные bytes **после** внутреннего transform:8MiB/page,
128rows/page, явные offset/totals/EOF; original+decoded payload не обходят cap.
Сломанный ciphertext останавливает read, не становится пустым планом. Новый root,
private device keys и recovery secret не принимаются и не выдаются этим endpoint.

Push subscriptions являются delivery authority. Их старый ciphertext сохраняется
только как inert device-local history; endpoint secrets не открываются, не
регистрируются и не становятся действующим согласием. `advice_notification_devices`
и `shared_push_subscriptions` — отдельное существующее endpoint/authority storage,
без private schedule/preferences; они не импортируются как content/grants.
`users.advice_notifications_json` уже охвачен `personal.advice`. Shared recipients,
watchers, audit event contents и project automation принадлежат project/history/ACL
категориям, а не разрешению читать чужой проект через personal source.

## Web и native capture

Web сохраняет точные12 owner localStorage values: device/frequency/receipts/snoozes,
moon settings/sent, task receipts, advice/shared opaque device IDs, generation и
две новые owner-scoped telemetry/delivered keys. Исходные2 origin-wide legacy keys
не удалены. Они и ownerless worker receipts требуют явного attribution review;
отсутствие/отмена review блокируют **до** private server IO. Чужой owner не
превращается в текущий. Источники3 существующих CacheStorage caches и отображённых
notifications читаются без delete/ack/recreate/permission request. Чтение response
body ограничено, storage/editor changes во время async capture обнаруживаются.

Actual `HabitReminderInputPanel`, bridge/settings и moon settings регистрируют
committed form state; unmount сохраняет detached copies, включая `1,,`, заметку,
quality, target, operationId, pending/open intent и статус. Async form tasks
учитываются до завершения. Registry живёт только в памяти текущей сессии и
закрывается при logout; DOM nodes, controllers, functions и login/recovery inputs
не копируются. Общий product UI freeze/restore/review journey ещё обязателен.

Native читает все Room reminder states и точные значения5 SharedPreferences
registries плюс два исходных DataStore moon values. Не используются `mapNotNull`
старых snoozes или нормализующий `UiPreferences` reader. Raw snooze JSON сначала
попадает в protected capture; shared strict parser независимо проверяет duplicate
decoded names и SHA256 owner scope, затем относит URI/string-set записи.
Нет старых ключей/DEK или общего decrypt port. Isolated bundled runtime получает
только captured metadata/content; HTTP/storage/OS grants ему недоступны. Вывод
идёт256KiB частями с backpressure/checksum и отдельным placement allowlist:
reminder history не может стать remote content.

Новый snapshot сохраняется под новым root до source read. Текущий и предыдущие
attempts не replayed: они остаются отдельной локальной историей. Невыбранные,
старые/неполные действия не исполняются. Единственный remote logical object —
private shared preferences под новым E2EE root. Exact originals, failed deliveries,
queues, snoozes, grants ciphertext и все captures остаются локально под новым root.
`readMigratedReminderHistory` имеет только readback capability. Scheduling,
подписки, acknowledgement и old-key APIs отсутствуют. Новое расписание потребует
отдельного явного согласия; история не выдаёт identity, entitlement или ACL.

## Writer exclusion и совместимость

Actual web status/register держат один owner permit от device-ID creation до
borrowed HTTP и adoption projection flag. Частные local settings, task/moon/habit
delivery и receipts защищены до финальной записи. Telemetry новых действий
привязана к owner; старые origin-wide значения остаются для review.
Локально открытый legacy workspace может менять device settings офлайн, но
такой permit не разрешает серверный socket: private API по-прежнему требует
текущий подтверждённый session owner. Чужой/закрытый permit и preparing/active
marker запрещают запись до каких-либо side effects.
Известный серверный `privatePreferencesMode` запрещает local legacy writes даже
до появления deny marker на этом устройстве. Real cloud-client regression
сначала воспроизвёл обход, затем прошёл после проверки
`serverProtectedTransportOwners` внутри каждого owner check.

Background push, notification intent/ack и cache writes используют global Web
Lock и durable deny markers. Уже допущенный current-page receipt заимствует
owner operation. Cache serialization начинается **после** получения global/borrowed
permit; иначе ожидающий migration push занял бы queue, нужную той странице,
которую ждёт migration. Регрессия этого ordering проверена отдельно.

Worker capability2 требуется перед product migration. Только новый **основной**
`sw.js`, завершив установку guarded handlers, подтверждает capability2. Обновлённый
transport import внутри старого main worker сообщает capability1. Отдельный
red/green test воспроизвёл и закрыл ложное подтверждение готовности. Это local
worker capability, не повышение cryptoProtocol или update floor.

Native task/habit/sleep/moon writers и device frequency/moon preferences берут
тот же owner permit **до** scheduler/Room/DataStore mutexes и удерживают его до
OS side effects/receipts. Уже допущенные nested операции заимствуют capability.
Guest scope сохраняет собственные локальные напоминания. Logout cancellation не
включает старый writer и может отменить OS delivery закрытого аккаунта.

Verified incoming bootstrap — отдельный путь: он импортируется **до** переключения
active workspace. Поэтому actual importer получает target-owner permit и check
исходной authenticated generation/UID от AuthController; проверка текущего UI
scope для него не подменяет подтверждённый incoming owner. Legacy fence целевого
аккаунта остаётся обязательным. Permit охватывает parsing/encryption/Room batch и
cancellation старых alarms. Обычные editors/schedulers требуют active local scope.

Account/epoch проверяется повторно после ожидания scheduler mutex и DataStore,
перед OS effects и завершением writer. Task/moon/sleep callbacks используют
захваченный scope, а не новый dynamic workspace после ожидания. Ожидаемые
account-change и preparing-fence отказы в reminder entrypoint являются coroutine
cancellation: сохраняются запрет и исходники, фоновой SupervisorJob не падает.
Неизвестные ошибки не превращаются в успешное восстановление.

## Доказательства и незавершённая приёмка

- Backend3/3 PASS, включая новый suite и регрессии pagers Physis/Mindmaps:
  `output/qa/security336-reminders-source-backend-01/results.json`.
- Source/pages focused51/51 и расширенный source/worker/reminders набор115/115.
  Actual cloud API/owner gate VM:6/6; offline и known-cutover red/green сохранены.
  Финальный source/operations/worker набор42/42 PASS, включая opaque custom-URL
  provider и запрет URI userinfo/port/query/fragment/control substitution.
- Полный JS:1668/1668 PASS, failures/skips0:
  `output/release-3.3.6/runtime/reminders-source-full-js-05.log`.
- Typecheck10 PASS. Scoped eslint06:0 errors/4 прежних img warnings; final changed
  native-source module eslint07:0 errors/warnings. Lint05
  остановлен ошибочной областью команды (PHP-directory не поддерживается ESLint),
  в corrected06 PHP не выдаётся за проверенный JavaScript. Backend suites выше
  проверяются своим runner.
- Chromium157, actual React form/WebCrypto/IndexedDB/CacheStorage/Web Locks и
  signed coordinator:29 assertions PASS. Capture до сети, independent recovery,
  uncertain commit, уничтожение исходного UI/storage, resume без recapture/replay,
  cold unlock/readback, no plaintext в wire/IndexedDB и no old-grant activation:
  `runtime/reminders-source-browser-summary-02.json`, `...identity-02.json`.
  Final bundle byte-identical: `...browser-comparison-04.json`; отдельный третий
  browser run не заявлен. Known-cutover helper проверен real cloud-client VM.
  Снимки: `output/playwright/reminders-source-336/`. Console0 errors/warnings.
  Это synthetic signed peer, не authenticated full-product/real-push acceptance.
- Final web build04 PASS:98 public HTML variants,14 languages,280 gallery images,
  exact locale dictionaries и offline precache.
- Native build01 остановился на JVM fixture (`copy` у обычного class); build02 —
  на двух прежних instrumentation calls нового suspend frequency setter. Fixtures
  исправлены, source reader/crypto не ослаблены. Build03 SUCCESS23m52s,
  JVM1209 total/1201 passed/8 прежних opt-in HTTP skipped/0 failed;
  lint0 errors/206 warnings/8 hints. Initial device runs13 PASS/2 FAIL каждый:
  startup Moon restore бросил необработанный account-change exception при
  переключении synthetic workspace, source-class и Physis regression завершились
  до остальных scenarios. Это реальная integration ошибка, не accepted source.
  Исправлены cancellation и повторные scope checks; отдельная новая device
  regression проверяет отсутствие parent crash/записи после ожидания mutex.
  Build04 SUCCESS27m35s; новая cancellation/mutex regression и все11 importer +
  2 reminder scenarios PASS, но positive source readback/large-history ещё отказали:
  по20/22 PASS на API34/35. Изолированный CDP diagnostic actual WebView113
  установил пустой URL.hostname для `genesis://` при корректном Android Uri.
  Записаны только static code frames/technical URI properties, не private values.
  Exact generated authority/first owner component теперь проверяются без
  нормализующего custom-scheme URL parser; исходные отказы и red/green сохранены.
- Final native assembly05 SUCCESS44s. После build04 изменился только общий JS URI
  parser; Kotlin/JVM и Android lint приняты из04, test APK byte-identical. JVM1209
  total/1201 PASS/8 прежних opt-in HTTP skipped/0 failed. Native lint0 errors/
  206 warnings/8 hints. Identity и сравнение: `...native-build-identity-05.json`,
  `...native-comparison-05.json`, `...native-jvm-summary-05.json`,
  `...native-lint-04.xml`.
- Actual API34/35 final: по22/22 PASS, failures/skips0. Это8 reminders source/guard/
  incoming bootstrap cases,1 Physis packaged-source regression,11 importer и
  2 task reminder cases. API26 GuardOnly:17/17 PASS, failures/skips0; packaged JS
  там не заявлен. Full history>16MiB прошла stream/backpressure/new-root readback.
  `runtime/reminders-source-native-device-summary-05.json`,
  `output/qa/security336-reminders-source-api34-03/results.json`, API35-03 и
  `security336-reminders-guards-api26-01/results.json`.
  Все3 task-owned AVD остановлены; личные устройства не использовались.

Дополнение после archives capture/normal-operation hardening: на отдельном
task-owned AOSP API26 с реально выбранным compatible WebView113 прошёл полный
тот же выбранный набор22/22, failures/skips0. Включает все8 packaged reminders
source/guard/bootstrap,1 Physis old-key-loss,11 importer и2 reminder cases.
`output/qa/security336-reminders-source-api26-supported-02/results.json`.
Это не изменение прежнего GuardOnly результата на Google26/provider69.
Official runtime provenance, public QA-only certificate/resource overlay и
ограничения: `e2ee-336-api26-supported-runtime.md`. Все9 sources целиком на API26
этим набором не подтверждены; full authenticated product и OEM matrix ещё нужны.

Непроверенное/оставшееся: полный authenticated enrollment/migration/normal E2EE
editors и восстановление форм; native mounted editor provider в product UI;
системный multitab/service-worker upgrade journey и реальные push permissions/
delivery; большие совокупные источники сверх128MiB/10000objects/локальных cap;
остальные API26 packaged sources/OEM matrix (Chromium69 недостаточен);
прямые signed upgrades/recovery, все48 сценариев, остальные source categories,
14-language semantic/full visual acceptance и independent human crypto review.
Ни одно ограничение не заменено пустыми данными, усечением или включением rollout.
