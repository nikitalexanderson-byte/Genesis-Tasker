# GENESIS 3.3.6 — передача работы в новый чат

## 23 ноября, после 10:55 UTC: bounded batch и повтор33

Native16/session23546 ещё RUNNING; app/android/contracts/public inputs не менять.
Web23 lint/types/build PASS, immutable output/release-3.3.6/web-private-23/public_html.
Web33/session68285 (consolidated-private-shared33.log) запущен на этом bundle и
текущем backend; полный personal + project/space journey, без повторения112 visual.

Серверный maxFragments<=50 теперь заполняет тот же bounded2MiB пакет следующими
таблицами того же фиксированного path после явного EOF. Web/native collectors
уже проверяют/потребляют такой порядок; path/scope/read grants не расширены.
Это сокращает многократную encrypted original custody для пустых таблиц.
Actual isolated e2ee-store suite PASS в output/qa/security336-private-path-batch-01:
cross-table order, all empty EOFs, maxFragments1 и forbidden table. Проверка
полного product результата ещё выполняется. Source checks PR45159475533 для
b235ed8a выполнялась; последний pushed кандидат дальше уточнять через git.

PHP для QA передавать явно: C:/Users/mrdeu/AppData/Local/Temp/
genesis-remote-original-php-d346771545be4522b57891c16e4fbb14/php.exe . Default
download8.4.27 сейчас возвращает404; уже установленный compatible runtime работает.

## 23 ноября: воспроизведён и исправлен отказ при продлении source lease

Web32 FAILED:12 personal/recovery checks PASS, затем project source capture
отказал E2EE_PRIVATE_PATH_TRANSPORT_INVALID сразу после migration-resume200.
Обновлённый signed fence возвращался в collector с прежним immutable context.
Новый regression воспроизвёл ТОТ ЖЕ отказ без полного browser journey. Теперь
web/native SignedMigrationTransport сначала проверяют actual signed payload,
owner/scope/migration/source/fence и каждый batch fragment, затем проецируют
технический fence для category reader. Raw HTTP originals и их реальные fences
не переписываются. JS streamed-planning34/34 PASS, включая новое продление;
log runtime/renewed-source-regression-after.log. Parser/budgets не ослаблены.

Mutation lease99ceef45 перенесена в основную ветку как24c42a38. Build15 остановлена
до lint из-за найденного cross-platform дефекта; PASS ей не приписывать.
Сейчас build16/session23546: full JVM + debug/test APK + lintDebug; inputs
заморожены. Log runtime/native150-renewed-source-build16.log, input hash рядом.
Добавлены3 native response-projection regressions и5-й component UI case:
реальные305s foreground expiry, отказ Keystore, новый system PIN и открытие
того же record. KEEP_SCREEN_ON действует только в test Activity, auth TTL300s
не менялся. Результаты native16 и реального browser33 ещё НЕ получены.

После identity16 запускать runtime/native150-unlock-component-api26-16.ps1
и native150-unlock-component-api34-16.ps1 (с новым RunId): ожидаются5 cases,
включая expiry без auth-refresh helper. API26 пока всё ещё synthetic PIN/37;
driver26 в finally восстанавливает исходные NONE/0prints. Затем полный native
controller/integrated account и остальные условия выпуска. Coverage9/20.

## 23 ноября, после 10:30 UTC: анонсные кадры переданы, приёмка продолжается

Просмотрены шесть реальных Compose-кадров кандидата с синтетическими данными:
lock/recovery/device-entry, RU light/dark, 1080×2400. Пользователю переданы
превью и output/announcement-3.3.6/GENESIS-3.3.6-screenshots-RU.zip с captions.txt.
Чёрные защищённые system fingerprint frames исключены; FLAG_SECURE не обходился.
Исходный QA test APK14 восстановлен поверх capture APK на owned API34.

Web mutation lease correction проверена37/37, lint/types/build22 PASS и сохранена
в linked worktree commit99ceef45 (codex/security-336-window-1123). После замороженной
native build15 перенести этот commit в основную ветку и пересобрать/зафиксировать
identity совмещённых inputs перед native acceptance. Web32/session65885 ещё
RUNNING:12 personal/recovery checks PASS, shared controller journey pending.

Build14 завершилась FAILED: JVM1419 PASS/8skipped, но lint13errors. В основной
копии исправлены оба StateFlow composition reads через lifecycle collection;
11 Core1.18 RestrictedApi usages изолированы в документированном API26–29
fingerprint adapter с одной локальной аннотацией. Новых зависимостей/глобального
baseline нет. Build15/session92159 (native150-lint-corrections-build15.log):
assembleDebug/assembleDebugAndroidTest/lintDebug выполняются, inputs не менять.

ВАЖНО: owned API26 emulator-5594 временно имеет synthetic PIN и fingerprint37
для проверки legacy adapter. Исходное состояние NONE/0prints сохранено в
runtime/api26-biometric-before-1123.json. Enrollment через настоящий Settings UI
подтверждён. Подготовлен runtime/native150-unlock-component-api26-15.ps1: после
актуальной build identity выполняет4 реальных component cases и в finally
восстанавливает NONE/0prints. Если запуск откладывается, вызвать
Clear-OwnedApi26Credential из owned-api26-auth-functions-1123.ps1 и проверить0prints.
PIN/содержимое старых storage scripts не выводить. API34 PIN/fingerprint сохранены.

CI exact b5616c4c: push45147148933 и PR45147580879 — оба Android и web-and-api
SUCCESS, включая browser scenarios. Это не приёмка новых local corrections.
Coverage9/20, floors0, cutover off; релиза/активации3.3.6 пока нет.

## 23 ноября, после 09:30 UTC: checkpoint и отдельный флаг опубликованы

Correction code committed df60ed7c, затем merge принятого main b5616c4c
(полный b5616c4cec9946d2fda1a0cd3110219a1de1ccfd) и push в publish/codex/security-336.
Remote называется publish, origin отсутствует. Draft PR48:
https://github.com/nikitalexanderson-byte/Genesis-Tasker/pull/48 . Не merge до
полной приёмки. Source checks push45147148933 RUNNING; web lint/types,
translation/domain/render tests и web build уже SUCCESS. Android продолжается;
PR run отдельный, group checks-${github.ref}, не отменять требуемые checks.

Native build14/session72672 уже прошёл main Kotlin/JVM и assembleDebug; сейчас
compileDebugAndroidTestKotlin, затем lintDebug; inputs до результата не менять.
Scoped36/36 PASS и web21 lint/types/build PASS; immutable web-private-21/public_html
готов. Web31/session90175 FAILED после actual migration-commit200: новый UI-based
product mutation guard запретил собственный product seed при post-migration unlock
(E2EE_MIGRATION_BUSY; historyGuards[]). Это НЕ успешный full personal/shared run.
Следующий correction block: перенести owner-counted mutation lease в чистый
app/e2ee/product-mutation-fence.ts, приобретать внутри WebProductMigration.#execute
перед источниками и отпускать в finally после завершения/cancel-drain. ScopeClient
и EditorQueue проверяют lease перед и внутри commit. Само открытое UI не должно
продлевать lease после завершившейся миграции. Удалить зависимость core writer от
private-migration-ui; обновить два regression cases на явную lease и проверить
вложенное/double release. Затем build22 и actual shared32, не повторять31 без fix.
Log runtime/consolidated-private-shared31.log, report output/playwright/
security336-private-shared-31-1123/private-product-results.json.
QA mapper logpoints теперь допускают все retained chunk URLs: сработать может
только реально загруженный; все conditions false, event loop не останавливается.

Отдельный флаг ПОЛНОСТЬЮ опубликован: main4cc6750315ce115074f129239598d6673ae73cc6,
Source checks45140708340 SUCCESS, Deploy45146768399 SUCCESS. Live meta exact SHA,
SVG200, весь Android manifest149 unchanged. Реальный radio «Русский» на EN `/`
имеет loaded /language-flags/ru.svg и textContent пустой. Снимок
output/playwright/ru-language-flag-live-1123.png просмотрен: единый стиль всех14.
Playwright CLI сначала получил403 browser challenge, затем тот же session сам
загрузил настоящий сайт; барьер не обходился. Browser session genesis-flag-1123
закрыт (exec3149 SUCCESS); чужие/IAB/Paddle tabs не изменялись. Это дополняет прежние
16 preview combinations, не новый полный accessibility audit. Security не deployed.

Дополнительный пункт для финального native review: ensureDurableKeys повторно
открывает auth-required аппаратный vault с300s window. Actual foreground write/
long migration после300s БЕЗ helper reauthentication ещё не принят. Headless
controller runner refresh90s нельзя выдавать за UX без повторного PIN; проверить
реальный expiry/refusal/resume и понятность gate, не ослаблять presence TTL.

Документация после b5616c4c dirty; новый push без кодовой необходимости сейчас
отменит выполняющийся branch check, поэтому объединить её со следующим нужным
checkpoint. Goal active; полный signed149→150/minified/API26/20paths/48scenarios/
final internal review/release остаётся. demo-output не читать/stage.

## 23 ноября, после 09:18 UTC: PIN/отпечаток принят, исправлены гонки

Actual component PASS4/4,0skipped на owned API34: output/qa/
security336-native150-unlock-component-api34-04/results.json. Production
RecoveryCredentialActivity + настоящий E2eeDeviceVault с auth-required key;
системный PIN, fingerprint37, cancel и background проверены. System PIN/fingerprint
screenshots в той же папке. PIN и fingerprint не эмулировались callback-ом: driver
ввёл прежний synthetic PIN в наблюдённое system password field и послал hardware
touch37 в наблюдённый prompt. Android14 сначала предлагает ещё один системный
Use PIN (button_use_credential), PIN field находится в SystemUI, не только Settings.
XML пишет единственный UiAutomation внутри instrumentation; driver его только
читает. Исходный PIN не менялся, personal devices/Play не тронуты. Это component
acceptance, НЕ integrated account/release PASS. Build13 main APK тот же3214F082…,
test F2A41B396427494AFD803EE0EFDA9124E6BB8B910C54FA2B128412AAC6F1064F,
source24E1865B6B94C28CBCA5F3585A472E0215A9792AC6199655FB789090A5EE404C.

Native controller guard02 FAILED ровно через15min: sameGeneration=false и
currentTransport=false; все owner/foreground/lifecycle/workspace/backup predicates
остались true. Реальный periodic worker начинал новую сессию под миграцией.
Прямой forced owned job2 использован отдельно как diagnostic injection и сохранён
в worker-interference-diagnostic.json; сам он не закрыл тест. В AuthController
background sync теперь defer/retry до закрытия active migration/owner UI intent;
null owner не блокирует cold session. В native controller test добавлен реальный
background refusal до prepare и безопасные phase/predicate logcat tags.

Web30 FAILED точно в catalogue row guard: outbox/job, sameSerial=false,
sameSize=false. Обычный encrypted upload менял account-wide custody под shared
migration. Теперь owner-bound UI scheduling fence проверяется перед и внутри
commit обычных scope-client jobs и editor queue publications; late receipt
оставляет исходный immutable pending packet для последующего retry. Migration
storage/guards не ослаблены. Web/native rememberDirectory стали идемпотентны с
повторным чтением serial/bytes после signature work: concurrent replacement всё
ещё отказывает. Новые regressions сначала воспроизвели дефекты; после исправлений
device-vault/scope-client36/36 PASS (runtime/migration-race-corrections-unit02.log).

Сейчас build14/session72672: full JVM + debug/test APK + lintDebug,
runtime/native150-race-corrections-build14.log. Web21/session49106: scoped lint
и full typecheck PASS, build/immutable copy pending, runtime/web-private-build21.log.
App/android/contracts/public inputs с начала14 не менять. Затем actual web shared
journey на build21 (без повторения112 visual captures), owned native key audit,
controller + integrated unlock. Старые FAIL не переписывать. Native comparator/
background code ещё требует runtime acceptance. Части AuthController содержат
существующие CRLF; git diff --check нужно различать CR-at-EOL и реальные пробелы.

PR47 уже merged; main push checks45140708340 всё ещё выполняется (Android SUCCESS,
web ongoing). Не запускать check duplicate. После SUCCESS штатный Deploy main
4cc6750315ce115074f129239598d6673ae73cc6 от живого incumbent и live verify flag/APK149.
Security изменения пока не опубликованы; main base надо включить в security
без отката. Coverage9/20, floors/cutover off, deployAndroid=false. Goal active.

## 23 ноября, после 08:49 UTC: активная диагностика

Build9 SUCCESS: JVM1419 PASS,0FAIL,8 opt-in skipped (не1427PASS), debug/test APK
собраны. Main APK3214F08276BE26A05F2729DCD16544C3094F0074C0E5CA502A82B57316EE6FB9.
Build10 также SUCCESS2m24s: только новые androidTest inputs; тот же main APK,
test APK925BD255EE196141AC5E1FBC6A220D3D3DECD8DC394C4C9D29D6C32EF0E1C3EB,
sourceD6851312E5D2B6CB4644A958200D5746784DDB61700881351CFA123DBAE6527C.

Настоящий NativePrivateProductHttpsTest в controller-unlock-api34-01 FAILED:
E2EE_ACCOUNT_CHANGED при savePlanningCell/retained history. До integrated UI
не дошёл; owned fixture cleanup PASS. В androidTest добавлена read-only диагностика
предикатов (booleans only, без IDs/cookies/keys). Сейчас повтор с ней:
session56282, runtime/native150-controller-guard-api34-02.log и
output/qa/security336-native150-controller-guard-api34-02-platform/.
Не менять app/android/contracts/public до результата этого run.

Новый NativeDeviceAuthenticationUiTest независимо монтирует настоящий
RecoveryCredentialActivity и открывает auth-required E2eeDeviceVault synthetic
record. Первая component попытка FAIL:4 сценария не увидели prompt. Тест после
изменения Compose request не ждал нового кадра; добавить compose.waitForIdle()
перед UiDevice wait, вывести безопасную причину finished при неудаче. Driver
нуждается также в -r для raw instrumentation и не должен запускать второй
uiautomator dump во время instrumentation: Android допускает только один
UiAutomationService. XML с наблюдённым fingerprint prompt должен писать сам тест,
driver только читает его через adb. Никаких PIN/fingerprint PASS ещё нет.

Web29 завершён FAIL: personal migration/edit/reload/offline/wrong-secret/recovery
прошли; actual Google re-confirm action достиг synthetic provider, повторный
project bootstrap200. Затем точный E2EE_SOURCE_HISTORY_CHANGED, storageFailures[].
Web30/session72194 использует тот же immutable build20 и новые неприостанавливающие
logpoints на каждом history guard, без раскрытия содержимого; log
runtime/consolidated-private-shared30.log, output/playwright/
security336-private-shared-30-1123/. Не повышать budgets и не снимать guards.
Замечен отдельный реальный дефект: rememberDirectory web/native всегда пишет
key-check даже для тех же verified bytes, увеличивая serial. После диагностики
исправить идемпотентность с повторным чтением/проверкой прежней serial и bytes,
сохраняя refusal при concurrent change и все проверки signed history.

PR47 merged штатным squash после SUCCESS обоих required jobs старого rerun.
Новый main4cc6750315ce115074f129239598d6673ae73cc6, push Source checks45140708340
RUNNING. Не dispatch-ить дубликат checks; после SUCCESS штатный Deploy по exact
main и живому incumbent, затем live verification флага/APK149. Production пока
4c209a00, safety3.3.6 не выложена. Native test/QA script изменения ещё dirty,
HEAD07e455d0 не pushed. Original prompt не менялся, demo-output не читать/stage.
Signed149→150, полная матрица, exact-candidate CI и внутреннее review остаются.

## 23 ноября, после 07:58 UTC: текущая точка

Native build8 честно FAILED: SDK37 больше не содержит typed FingerprintManager.
Legacy branch переведён на уже объявленный AndroidX Core1.18.0
FingerprintManagerCompat; классы/overload с android.os.CancellationSignal проверены
через фактический cached AAR/javap. Новых зависимостей/UI-библиотек нет.
Сейчас build9/session12731 (runtime/native150-build-9.log): основной Kotlin уже
скомпилирован, JVM/dex/test APK продолжаются. С запуска9 app/android/contracts/
public inputs не менять. Build identity до success9 остаётся старой6.

NativePrivateVaultUnlockUiTest.kt теперь находится в actual androidTest source,
с TLS setup/restore для owned fixture. Runtime draft одноимённого файла устарел:
не копировать его поверх android/. Четыре UI cases: cancel, system PIN, background,
hardware fingerprint; читают настоящий EDITED NATIVE PRIVATE project после unlock.
Готов runtime/native150-private-controller-and-unlock-api34-01.ps1 (syntax PASS,
НЕ исполнен): после build9 success/identity запускает real controller, затем UI
в SAME fixture/app data; background auth refresh остановлен до UI. Новый helper
owned-api34-auth-functions-1123.ps1 читает прежний synthetic PIN внутри процесса,
не печатает/не меняет его. На API34 через actual Settings добавлен ровно1 synthetic
fingerprint37, original count0/PIN unchanged. Setup evidence
runtime/native150-owned-api34-fingerprint-setup.json. Никаких биометрических
PASS пока нет. API26 wrapper01 для controller03 отдельно остаётся доступен,
его finally обязан вернуть original NONE. Личные устройства не трогать.

Web25 дал112/112 actual visual captures на build20, но весь run INCOMPLETE:
QA provider handler ошибочно считал return_to абсолютным URL и упал на относительном.
Исходный report RUNNING не переписан; run.json exit1/cleanup PASS. Исправлен
new URL(return_to,baseURL), origin check сохранён. Web26/session20469 затем FAIL
при shared migration: реальная или debugger-induced IndexedDB transaction abort,
E2EE_STORAGE_UNAVAILABLE. API bootstrap/read уже доходят до200. Нужна причина,
не снимать atomic/current/fingerprint guards. Web27/session30001 идёт на SAME
immutable build20, focus shared, без pause-on-all-exceptions в обычном прогоне;
QA hook пишет только IDB store/mode/DOMException name в storageFailures. Log:
runtime/consolidated-private-shared27.log, output/playwright/
security336-private-shared-27-1123/. Никакого общего shared PASS пока нет.

PR47 всё ещё НЕ merged/deployed. PR45121136850 attempt2 SUCCESS (Android12m10s,
web54m58s), standalone45121051152 SUCCESS. Обычный merge GitHub отказал, потому
required checks учитывают также отменённый push45121048967 на том же SHA. У main
enforce_admins=true, reviews0, required web-and-api/android strict; политику не менять.
Этот cancelled push повторён attempt2 (примерно07:48UTC), идёт. После green обычный
merge47, дать main PUSH checks завершиться без website_only cancel-дубликата,
затем штатный Deploy по exact main и live incumbent. Production4c209a00/APK149.

git diff --check PASS после LF normalization Manifest/backend-router. Код ещё
локальный correction checkpoint, исходный prompt не изменён, demo-output не читать
и не stage. Signed1498rows+draft baseline сохраняется; signed150/upgrade, minified/
lint, полная матрица20 paths/48 scenarios и итоговое internal review ещё нужны.
Coverage9/20, floors/cutover off, deployAndroid=false; goal active.

## 23 ноября, после 07:00 UTC: отпечаток/PIN и новые runs

Новое прямое steering владельца: «интегрируй также туда в приложение экран
блокировки с возможностью входа по отпечатку и пинкоду», «если еще не сделал».
Найден existing fullscreen PrivateVaultGate + системный PIN и auth-required
E2eeDeviceVault keys300s. Не создавать отдельный app PIN или копию recovery secret.
Added NativeDeviceAuthentication.kt: API30+ system STRONG BiometricPrompt,
negative action explicitly opens system credential; API26–29 FingerprintManager
с Material dialog и credential fallback. Atomic phases ignore late/duplicate
callbacks; cancel/stop/timeout/dispose close request. Keystore unwrap и все
original owner/foreground/one-use guards остаются после callback. Main vault
button явно называет fingerprint/PIN. Normal USE_BIOMETRIC/USE_FINGERPRINT
permissions; five localized strings в native-unlock-copy-v1.json для всех14.
Это CODE, не biometric/PIN acceptance или выпуск. Нужно проверить реальные
fingerprint success, PIN, cancel/background и сохранение исходных данных.

Build7/session30283 отменён Ctrl+C из-за этого нового native блока, НЕ PASS.
Owned Gradle process после отмены не найден. Сейчас build8/session35002:
full JVM + debug/test APK, runtime/native150-build-8.log; source snapshot/hash
native150-build-8-input.*. С запуска8 не менять app/android/contracts/public.

Web20/session69162 PASS: lint0errors/3 historical hook warnings, types/build;
immutable output/release-3.3.6/web-private-20/public_html. Web24/session7222
завершён FAIL после68 actual visual PASS: множество искусственных повторных
unlock исчерпало реальный e2ee-v1 budget600/10min, затем429 и startup gate.
Не повышать budget. Visual loop теперь между captures остаётся locked (это
правильный scope, весь functional unlock/recovery уже отдельно выполняется).
Desktop dialog по принятому universal CSS остаётся1020; локальное max620 не
override-ит общий selector. Читаемость full-column actions и dark theme видны
на actual screenshot vault-de-dark-1440; это не уменьшение общего modal frame.

После завершения24 добавлен qa/identity-confirmation в backend-router.php:
только owned CLI/loopback E2EE runtime, POST/CSRF, whitelist ordinary synthetic
actor, boolean confirmed; моделирует лишь provider delivery, меняя authenticated_at.
Prod E2EE300s guard не менялся. PHP syntax и QA JS lint PASS. Shared test специально
проверяет server refusal и actual Google reconfirm action, whose provider delivery
is fixture-only. Native headless также refresh-ит synthetic identity перед shared.

Новый web25/session46044, runtime/consolidated-private-shared-locales25.log,
output/playwright/security336-private-shared-locales-25-1123/: immutable build20,
112 visual locked states + actual personal/shared/re-auth journey; RUNNING.
После build8 запускать controller03 существующим runtime wrapper01 с новымRunId,
actual API26 PIN helper/finally NONE. Старый build identity6 не переименовывать.

PR47 флага всё ещё OPEN/BLOCKED, failed-job rerun45121136850 выполняется.
Standalone45121051152 SUCCESS. Merge/main checks/deploy/live verification ещё
обязательны; не включать security-код в этот срочный веб-выпуск. Goal active,
coverage9/20, cutover/floors off, APK149 и deployAndroid=false сохраняются.

## 23 ноября, продолжение после 06:53 UTC: reauth, сборка7 и signed149 baseline

PR47 российского флага всё ещё НЕ опубликован. Website-only Source checks45121051152
SUCCESS. PR checks45121136850 имел один FAIL premium mindmap-edit-second-client:
сразу после открытия cold формы получено пустое поле вместо уже сохранённого
описания. Все остальные scenarios, включая header, прошли; Android SUCCESS.
Повторён только failed job этого run, он выполняется. Не менять required checks
и не обходить blocked merge. После green — обычный merge, exact-main checks,
Deploy с живым incumbent и live verification, без security/APK149 changes.

Native build5/session30721 завершён SUCCESS. Build6/session51556 тоже SUCCESS:
source hash0E8881A3943CCA185E1C63CB207BCD76A4D5C7052937C313551B8C4D2E709F59,
APK9156BDC9725B280FA371284F13A521A008FFB7DC41BC02B77BB26188B26688A7.
Controller acceptance01 и02 честно FAIL до миграции на двух ошибках QA fixture:
POST creation возвращает201, isDone приходит integer0/1. Оба исправлены в actual
androidTest. API26 original NONE восстановлен в finally каждого run; personal
devices и API34 PIN не менялись.

Web23/session60060 завершён FAIL после полного personal recovery: resource
discovery теперь200, но bootstrap shared отказал E2EE_REAUTH_REQUIRED — за личный
перенос истекли реальные300s подтверждения входа. TTL НЕ ослаблять. Added whole
block: actionable Google re-confirm on web/native migration error, notice/action
всех14 языков в migration-copy-v1.json. QA shared journey теперь специально
проверяет expired confirmation refusal и реальную кнопку с synthetic provider
delivery; для этого ещё НУЖНО добавить строго loopback-only fixture endpoint
qa/identity-confirmation (boolean confirmed, CSRF, known synthetic owner,
authenticated_at only; не production). Native headless fixture тоже вызывает
этот endpoint перед каждым shared bootstrap. Google provider UI здесь не claim.

Web22 был FAIL после4 visual cases: locked vault не принимал public theme, пока
account observer ожидал unlock. Исправлено ограниченным accessor public appearance
и gated layout effect; max dialog620 и full-column readable text actions.
Lint/types/build19 PASS. Web24/session7222 на immutable web-private-19/public_html:
output/playwright/security336-private-shared-locales-24-1123/, последний snapshot
12 checks,20 visual PASS, run ещё RUNNING. Его loaded script старый: shared phase
ещё без reauth, ожидаемый FAIL там НЕ превращать в PASS. Не менять backend-router
пока этот run не завершит112 captures, чтобы не менять active fixture inputs.

Текущие builds: native7/session30283, runtime/native150-build-7.log, full JVM +
debug/test APK; источник app/android/contracts/public с запуска7 не менять.
Web20/session69162, runtime/web-private-build20.log; lint0 errors/3 existing hook
warnings, typecheck/build pending; после success immutable web-private-20/public_html.
После готовности fixtures и builds — native controller03 и shared25 с reauth.

На owned API34/emulator-5580 установлен официальный signed149, UID10194,
firstInstall06:25:44. adbd root только у этого owned AVD, PIN неизменен. Подготовлен
runtime/upgrade-149150/GenesisUpgradeProbe.java и readonly DEX probe-03.jar:
он работает под настоящим UID10194, использует platform AndroidKeyStore alias
genesis.local.v1 и фактический Room genesis.db schema1. Не подделывает login/ACL.
Seed и повторный запуск именно official149 сохранили8 rows (3 tasks incl tombstone,
3 outbox incl backup-held,1 reminder,1 structure) и1 encrypted planning draft;
4 records +draft расшифрованы тем же UID key. Evidence baseline149-seed-03.log,
baseline149-verify.log, clean startup errors log. Proof SHA256
28a5ae3a54f7622f91d31fff63617725989c76e93af19c8567bbd3e8317367a5.
Первые harness attempts до provider installation/readonly DEX не прошли и сохранены.
Signed150 пока НЕ собран/установлен: после официальной сборки нужен именно adb
install -r, тот же certificate/UID и schema2 actual startup, затем verify тем же
readonly probe. Это storage-retention, не signed-in Google/SAF UI acceptance.

HEAD всё ещё2057fdd6, correction block dirty, last pushed59adb64e. Не читать/stage
demo-output/. Coverage9/20, cutover/floors off, deployAndroid=false; final review,
точный CI и раздельные публикации остаются. Сохранённый исходный prompt не менять.

## 23 ноября, 06:22 UTC: дополнительные результаты текущих runs

Scoped lint и полный TypeScript read-marker01 PASS; web ScopeClient24/24 и PHP
read-marker04 две actual signed suites PASS. Native build5/session30721 всё ещё
compileDebugKotlin (owned Gradle PID12988). GC heap snapshot:3.67GiB used of6GiB,
active compiler CPU, не объявлять зависшим/ошибкой без новых данных. Исходники
app/android/contracts/public с начала build5 не менять. Web22/session69940 всё
ещё читает legacy-private-path; это не пройденный shared/locale journey.

Отдельный flag preview принят в16 combinations (две редакции × две CSS-схемы ×
четыре ширины), реальный выбор русского сохраняет редакцию. Before с production
показывает RU без img; after имеет loaded /language-flags/ru.svg, те же размеры,
что остальные13 языков. Evidence output/playwright/ru-language-flag-1123/results.json
и before/after PNG. Это PASS_FLAG_RENDERING; существующая сетка имеет узкие
контролы35px, поэтому это НЕ полный accessibility PASS. Не расширяли эту срочную
1-line замену изображения до переделки language layout. PR47 Android SUCCESS,
web checks ещё идут. Auto-merge repository запрещает; настройки не менять,
после green выполнить обычный merge вручную. Deploy флага всё ещё не был запущен.

Смысловая вычитка дополнительно охватила critical device-entry/revocation,
membership outcome/cancellation, Drive consent/disabled, shared restore,
decrypted file warning и message-key backup notice на всех14 языках. Locale
файлы не менялись. Это отдельная текстовая приёмка от pending112 visual captures.

По прежнему mail request прочитан исходный screenshot2078b37e: Gmail показывает
similarity/reputation spam banner, signed-by/mailed-by genesiscalendar.com/TLS.
Точного письма в connected Gmail нет; публичные SPF/MX Hostinger, DMARC p=none.
Конкретные доказательства/границы — docs/email-deliverability-2026-11-23.md.
DNS/провайдер/labels не менялись, писем не отправляли. Не объявлять spam исправленным.

## 23 ноября, 06:10 UTC: signed read correction, native base и отдельный RU flag

Последнее steering владельца: ответить об остатке и продолжать, заменить буквы
RU флагом России как остальные языки. Ответ дан:4 блока — shared corrections,
native/direct149→150 acceptance, CI/14-language/final internal review, publication.
Флаг исправлен отдельной1-line website branch от принятого main4c209a00:
worktree upgrade-currency-20261122, branch codex/ru-language-flag-20261123,
commit936e4aa6, PR47. Build:web PASS (196HTML/14languages), website-only
Source checks45121051152 выполняется; PR создал ещё45121136850 с Android.
Публикации этого флага пока НЕТ. После CI — merge, exact-main checks и штатный
Deploy с проверенным incumbent SHA, сохраняя APK149 и security off. Не менять
существующие workflows ради этой правки. Production до проверки остаётся4c209a00.
Флаг cherry-picked в security как2057fdd6; это нынешний HEAD, ещё не pushed.
Last pushed security59adb64e. demo-output/ не читать/stage/удалять.

Native base finished: API34 methods10 and API26 methods09 each29/29 PASS_LOCAL_SCOPE,
exact build4 hashAB1BFD65334CCF99E988672AACE5CD6AB87F2D78422358A96ABDDA131892656B.
Reports output/qa/security336-native150-api34-methods-10/ и api26-methods-09/.
Они явно переиспользуют только поимённые PASS из предыдущего того же installed
APK, проверяют raw instrumentation logs/hashes, повторяют failed/missing cases.
API34 old methods06 имел1 E2EE_UNLOCK_REQUIRED в длинном case; API26 methods07
остановился после9 PASS на transient uiautomator/ADB shell error. Failed originals
сохранены. Wrapper09 делает actual system credential refresh каждые90s во время
длинного headless case; crypto/Keystore guards не менялись. Source regression26:
67PASS/1authFAIL; этот KeyAudit затем вошёл в successful29. Relational10-path and
archives sources04 each4/4 PASS on both platforms. Это component evidence, не
повышение whole-product coverage9/20. API26 original NONE restored06:02:
runtime/native150-api26-credential-restored-after-base-1123.json. API34 PIN unchanged.

Shared21 дошёл до полного personal recovery и выявил реальный integration bug:
пять parameterless signed reads передавали {}, а действующий общий command codec
запрещает empty object/list ambiguity. Captured RED:
runtime/empty-read-payload-red-01.log. Dirty correction целиком: web/native send
{protocol:1}; PHP строго проверяет marker после подписи. Crypto codec НЕ изменён.
Bootstrap initial cursor now null (internal -1), supported indices0..4095 on all
three platforms; fixed actual PHP count(int) TypeError at bootstrap completion.
Actual PHP signed start/stage/readback/complete/lost-ACK replay plus wrong marker,
signature tamper and limits now2/2 suites PASS in security336-read-marker-04/.
Web ScopeClient24/24 PASS including both regressions (runtime/read-marker-web-01).
Lint/typecheck session90886 pending final poll; no source errors observed yet.

Added actual native controller HTTPS test under android/.../auth/
NativePrivateProductHttpsTest.kt: real AuthController + factories + Keystore/Room
and isolated PHP, personal edit/lock/unlock + shared project/space transition.
It is NOT compiled/accepted yet. Native build5/session30721 now compileDebugKotlin;
runtime/native150-build-5.log. It builds affected ScopeClient JVM tests and both
QA APKs, then saves exact native identity. Do not edit compiled input during it.
Runtime draft of test is older copy after any later actual-source correction;
android/ remains authoritative. Native minified/lint old run40724 was cancelled
because a real source correction superseded it; NOT PASS. Rebuild/recheck latest.

Web build18 PASS; immutable output/release-3.3.6/web-private-18/public_html contains
flag and read correction. Shared+14-language real vault visual run22/session69940:
output/playwright/security336-private-shared-locales-22-1123/,
runtime/consolidated-private-shared-locales22.log. It captures112 actual locked
vault combinations before shared transfer. It is still RUNNING; do not promote.
Startup10 PASS, reading source data last observed. QA now catches shared load
errors before waiting for absent selector. Source checks59 run45118054426 failed
Android on unavailable Kotlin Compose plugin2.2.10 resolution, before compilation;
web job still ran through backend/API into browser last observed. Saved raw job
log ci-45118054426-android-failure.log. Do not rerun old candidate after next fix.

Prepared runtime/native150-private-controller-https-01.ps1 for new native test
on owned API26 only. Start AFTER build5 success/identity. It creates fresh local
TLS/PHP E2EE fixture, exact ADB reverse, actual credential confirmation/refresh,
then restores original NONE and cleans only marked owned runtime. Not executed.
Check results and fix real failures, not mock endpoint claims. Baseline149 signed
APK remains verified and direct signed149→150 still NOT performed. Main package
absent on owned API34 (only isolated qa1103.debug and test installed).

Playwright skill read and npx verified. Isolated CLI sessiongenesis-ru-flag-1123
is at user preview localhost4392 (Vite in website worktree). It now rendered the
full public page; radio/flag DOM eval session50613 pending poll. This is an owned
anonymous browser, not the user account. Keep screenshots under output/playwright.
emulator-5580/API34 and emulator-5594/API26 are the only authorized emulator serials; no personal
devices/Play changes. Full final review, evidence consolidation and authorized
separate release still remain. Goal active; no 3.3.6 release/activation claimed.

## 23 ноября, 05:28 UTC: corrected source acceptance и header PASS

Native150 build4 SUCCESS, exact source hash
AB1BFD65334CCF99E988672AACE5CD6AB87F2D78422358A96ABDDA131892656B.
Main QA APK29DB281EDC6234AAD9D373C0240A409145A03E7E891119CEA36F487DCBFD2991;
test APK1FE5E1875BC05CC5181D6606CBCE49031439FC48B991819071A6E728C9682F37.
Actual relational10-path and archives tests now4/4 PASS on each owned API26/API34:
output/qa/security336-native150-api26-sources-04/ and api34-sources-04/.
These component results do not yet promote full product coverage9/20.

Header5 was7/8 PASS: one held-module request bypassed page.route via installed
service-worker cache. Header case now blocks SW specifically for deliberate
network deferral; separate worker lifecycle coverage is unchanged. Header6 is
8/8 PASS, unchanged immutable build17, startup10/10 and owned cleanup PASS.
Full browser4 remains383/391 PASS; its8 header failures are superseded only by
this corrected targeted result, not rewritten. Actual shared20 failed on a
test locator matching the parent load button and three nested load buttons.
Selector now addresses the direct parent button. Shared21/session5821 runs
against unchanged build17; do not mark it passed before its actual result.

Current owned runs: API26 source regression/session81801; exact installed-APK
per-method authentication API34/session16839; native lint/minified build/session
40724. Runtime wrappers/output native150-*05/06 preserve exact identities and
use real credential verification (API26 UI, API34 LockSettings). The first
method wrapper refused before instrumentation because Android34's installed
path contains '~'; only its path validator was corrected. Do not count that
aborted run as PASS. API26 still has our synthetic PIN; restore original NONE
after all owned acceptance. API34 credential remains unchanged.

English copy of the security contract families was read, plus critical
vault/migration/archive/key-loss copy in all14 languages. This is semantic
review of those actual strings, not complete visual/native14-language acceptance.
Source checks45111716099 remains FAILED on its old header cases. Final exact
candidate CI, shared/native completion, source/scenario evidence consolidation,
signed149→150 upgrade and final internal crypto review/release remain.
Production/main4c209a00, APK149, floors/cutover off and deployAndroid=false unchanged.

## 23 ноября, 05:15 UTC: личный recovery PASS, shared UI correction и QA среды

Pushed HEAD остаётся a1b57fd2; новые исправления ниже ещё dirty. Main/production
4c209a00, APK149, floors/cutover off и deployAndroid=false не менялись.
Private18 завершён PASS: actual personal migration/activation, no profile-cache
canary leak, normal edit+durable reload+реальный ciphertext ack, offline unlock,
clean-browser wrong-secret refusal и successful recovery. Immutable build16;
run.json подтверждает unchanged bundle и owned cleanup PASS. Это впервые полный
личный mounted journey, но не весь shared/native acceptance.

Shared19 прошёл тот же personal journey и нашёл реальную product ошибку:
privateVault UI-флаг нигде не выводился из подтверждённого privatePreferencesMode,
поэтому Account скрывал PrivateSharedSecurityPanel и предлагал повторную personal
migration. Исправлено централизованно для /session, metadata replies и offline
profile; флаг не является crypto authority. Account privacy/offline text теперь
использует уже локализованный vault copy вместо неверного server-key описания.
Targeted30/30 PASS, typecheck/private-profile01 и lint01 PASS, build17 PASS.
Shared20/session3363 идёт на immutable web-private-17/public_html:
output/playwright/security336-private-shared-20-1123/,
runtime/consolidated-private-shared20.log. Не объявлять его пройденным заранее.

Общий browser4 завершён383 PASS/8 FAIL из391,0 skipped, unchanged immutable
build16, cleanup PASS. Все8 — header startup: raw pointer нажимался через новый
workspace-startup-gate (это видно на held screenshot). Source checks45111716099:
Android SUCCESS; web/API job прошёл lint/types/tests/build/backend/API и упал
только на header cases в конце browser run. Его FAILED не переименовывать.
Header test теперь ждёт admission и проверяет настоящий hit target до жеста;
сохранены проверки координат/одного нажатия после загрузки lazy controls.
Header5/session29965, runtime/consolidated-header5.log, immutable build17.
Если gate не исчезает при удержанных modules, изучить причину, не снимать guard.

Native150 build2 SUCCESS20m43s; JVM1418 PASS/8 opt-in skipped. Initial API34
selected retry:5 authentication failures и1 malformed relational fixture.
Raw per-case system reauth then4/5 PASS; remaining orphan test встретил более
ранний E2EE_CORRUPT_FILE. Это явный допустимый parser refusal, assertions
no-write/no-network/no-consumer сохранены. В build3 оба owned emulators прошли
этот последний case. Source tests ещё НЕ приняты: relational compare ошибочно
использовал technical command canonical encoding для private keys с `_`, а
новый archive test подавал v1 form в actual v2 inventory. Исправлены fixtures:
structural private JSON equality и actual appendValue + v2 manifest.
Build3 SUCCESS2m42s; build4/session48349 с этими исправлениями выполняется,
runtime/native150-build-4.log. Никаких production crypto проверок не ослабляли.
Активный ArchivesMigrationSourceTest.kt в android/ — источник истины; scratch
output/runtime/ArchivesMigrationSourceTest.kt остался старым v1 и не копируется.

Первый API26 full run42 PASS/56 FAIL: среда загрузилась без WebView provider,
а shell locksettings verify на API26 не поддерживается и refresh ThreadJob
завершился ошибкой. Это НЕ product PASS. Original NONE credential restored.
Проверенная QA среда восстановлена по e2ee-336-api26-supported-runtime.md:
только own emulator5594 перезапущен с writable-system, pinned provider113 и
static overlay восстановлены; current/preferred valid, relros2/2. SDK image не
менялся. Публичный testkey/байты/ограничения уже описаны в том ADR.

Сейчас API26 снова имеет НАШ synthetic PIN, original NONE известен; helper
runtime/owned-api26-auth-functions-1123.ps1 умеет Initialize/Confirm/Clear через
наблюдаемый System Confirm Device Credential UI, с проверкой закрытия Activity.
Evidence runtime/native150-api26-ui-auth-02.json. Не использовать shell verify
на API26. Перед каждым Device.provision case нужен свежий Confirm; долгий
concurrentProtectedKeyCreates case требует UI refresh во время заполнения
provider (не ослабление Keystore). После полного owned run вернуть NONE через
Clear-OwnedApi26Credential. API34 имеет прежний synthetic PIN — его не менять;
там system shell verify перед каждым case уже работает. Refresher03 остановлен.
Следующий шаг — build4 targeted relational/archive на обоих эмуляторах и actual
API26 source/streamed cases на поддерживаемой среде, затем20-path acceptance.

Official incumbent149 скачан и проверен в baseline-335-149/:286545165 bytes,
SHA2560027746c382954972c711d7be96150d7dcca09c634f259b62c0f94892a3a70ff.
Package ru.genesis.calendar,3.3.5/149, valid APKv2, certificate SHA256
1e161d36f574b0560d808c7ee95e1abe98165b3385336d0276fb381dfd901cb8.
Signed150/release/direct upgrade ещё не делались. Остаток final review/release
и все границы сохраняются; demo-output/ не читать/stage.

## 23 ноября, 04:35 UTC: CI и текущие live QA sessions

Checkpoint a1b57fd28d25ad041dc317f0a4ca031e2eccf0a0 запушен fast-forward
в codex/security-336; main/production4c209a00 не менялись. Штатный Source checks
45111716099 выполняется: web lint/types/test/build уже прошли, идут backend и
Android build. Deploy/Android release не запускались. Typecheck04/lint03 PASS,
build16 PASS, targeted cache/relational29/29 PASS.

Private17 на immutable build15:10 PASS/1 FAIL. Personal activation, plaintext
cache canary, edit+reload и offline unlock прошли; clean-browser ожидал изменённую
задачу до сетевого подтверждения queued edit. В журнале нет post-edit put до
этой проверки. Тест теперь отдельно дожидается реального retry ciphertext ack
после намеренного reload race, затем проверяет другое устройство; product-код
ради этого не ослаблялся. Private18/session12103 идёт на immutable build16:
output/playwright/security336-private-18-1123/, runtime/consolidated-private18.log.
При ошибке clean client теперь сохраняется его отдельный screenshot/ARIA dump.

Общий browser4/session56679: immutable build16,
output/playwright/security336-browser-4-1123/, runtime/consolidated-browser-4.log.
Free пройден; Standard выполняется. Нельзя объявлять весь run PASS по частям.
Native150 build2/session85329 всё ещё compileDebugKotlin;03 refresher/session99419
ждёт build report. Source/Android inputs после старта этого build не менялись.

Owned API26 wrapper/session5547 также ждёт build2, затем повторно проверяет
SID0/SP handle0, ставит известный synthetic PIN, проходит observed credential UI,
запускает98 source/platform cases, обновляет system authentication через свой
ThreadJob и в finally снимает только свой credential, возвращая исходный NONE.
Script runtime/native150-api26-acceptance-01.ps1; report будет
output/qa/security336-native150-api26-01/, credential evidence —
runtime/native150-api26-credential-01.json. Не менять исходники под этим run.

Обнаружен конкретный пробел coverage:9 personal adapters +10 relational paths
оставляют native personal.archives без полного adapter/runtime/readback journey.
Готов draft двух meaningful native archive tests в
output/release-3.3.6/runtime/ArchivesMigrationSourceTest.kt. Он ещё НЕ добавлен
в android/ и НЕ скомпилирован, чтобы не менять inputs текущего platform run.
После его завершения добавить тест, проверить Kotlin/API формы, собрать test APK
и выполнить на обоих owned emulators. Это не утверждение coverage20/20.

Последний uncommitted source change — только QA web-private-product.mjs с ack/
clean diagnostics; demo-output/ по-прежнему не читать и не stage. Gates/floors,
APK149 и deployAndroid=false сохраняются; внутренний final crypto review и
signed149→150 acceptance ещё обязательны.

## 23 ноября, текущее продолжение: приватный кэш и native150

После f9ae9591 исправлена реальная утечка трёх private preferences в обычный
last-user cache. Единая запись, frozen preparing, owner-bound оригиналы,
encrypted custody/readback до очистки, safe portable projection и офлайн apply
описаны в e2ee-336-private-profile-cache.md. Targeted29/29 PASS; build16 PASS.
Typecheck04/lint03 запущены. Исходный security prompt не изменялся.

Mounted private16 ранее дошёл до activation, затем упал на ошибочном ожидании
bootstrap.workspace. Реальный контракт после activation —409 E2EE_UPGRADE_REQUIRED.
Это ожидание исправлено; private17/session88074 идёт на immutable build15:
output/playwright/security336-private-17-1123/, runtime/consolidated-private17.log.
Сценарий включает canary profile cache, нормальные edit/reload, offline unlock
и recovery в чистом браузере. Последние archive/custody добавления уже в build16.

Первый native150 успешно собран, но platform run INCOMPLETE:6 FAIL и изменение
source hash во время instrumentation. Два класса:5 несовпадений ожидаемых ранних
отказов и1 неверный fixture count11 вместо10 relational paths. Общий контракт
содержит20 paths; relational subset —10, включая personal.local-work. Root/capsule
fixture mismatch из предыдущего продолжения исправлен. Уточнены ранние отказы,
сохранены no-write/cold-repair assertions; JSONException повреждённого source
журнала теперь нормализуется в E2EE_SOURCE_HISTORY_INVALID. Ни один failed run
не объявляется PASS. APK до cache fix сохранены как partial в
output/release-3.3.6/native150-before-cache-1123/; fingerprint не подменялся.

Новый incremental build и7 затронутых cases: session85329,
output/qa/security336-native150-api34-1123-2/,
runtime/consolidated-native150-api34-2.log. Synthetic API34 auth refresher03
session99419 ждёт build report, не меняет credential и останавливается marker03.stop.
Предыдущие refreshers завершены. Только owned emulator-5580/API34 и
emulator-5594/API26; личные устройства не трогать.

Убраны точные три дочерних процесса superseded baseline от00:48 Moscow,
чей rendered-html worker крутился больше6h; evidence runtime/superseded-baseline-processes.json.
Это не завершённая приёмка того старого run. Все security gates/floors off,
coverage9/20, production APK149 и deployAndroid=false сохраняются.

Остаток: завершить mounted personal recovery, native corrections/API26,
полный immutable browser regression, 20-path/48-scenario evidence, minified/lint,
signed149→150 direct update, internal final crypto review и отдельные штатные
web/API/APK workflows. Security branch ещё не опубликована. demo-output/ не читать,
не stage и не удалять. Новые source изменения требуют точной новой build identity.

## 23 ноября, 03:05 UTC: perf corrections и подготовка номера150

Unit5:2115 PASS/2 FAIL из2117. Обе ошибки окружения: отсутствующий PHP в PATH
и невыбранный pinned QA PHP; при явных GENESIS_QA_PHP/OPENSSL_CONF оба suite11/11
PASS (unit-5-php-environment-1123.log). Это не2117PASS в одном запуске. После
этого storage.list получил bounded getAllKeys(limit+1) с сохранённым cursor
fallback, чтобы не делать отдельный IndexedDB IPC на каждый ключ. Scoped39/39,
typecheck/lint PASS, generated legacy worker соответствует исходнику.

Private11 остановлен как superseded до завершения; statusCANCELLED, owned cleanup
PASS, hash bundle не менялся. Private12/session99017 использует cache+batch build12
в output/release-3.3.6/web-cache-12/public_html; источники ещё читаются. Full3 на
неизменном build10 прошёл free/standart/premium, выполняет business; итог не готов.

Native main/JVM/test APK build завершён SUCCESS25m49s, но штатный fingerprint
отказал из-за изменения web/storage во время compile. Нельзя подставлять новый
hash к старому APK. Оба APK скопированы в native-frozen-149-1123/ с SHA и явным
статусом partial pre-version-bump. На них raw instrumentation96 в session74614,
runtime/consolidated-api34-sources-3.log; это не финальная приёмка3.3.6/150.

Следующий номер подтверждён по существующим Android release runs и APK:149
максимальный известный. Подготовлены3.3.6/150, current release-notes asset/copy14
языков, version/package/artifact guards существующих android-release/publish.
Никаких dispatch/publish/Play/device updates. После web fixes нужен один точный
native150 build и его platform acceptance, включая signed direct-upgrade149.
Все прежние gates/coverage9/20 сохраняются; release ещё НЕ готов.

## 23 ноября, 02:50 UTC: текущая общая приёмка

Сайт отдельно опубликован: main4c209a00, Deploy45099066004 SUCCESS; GPS/VPN,
обе языковые редакции и региональные донаты уже в принятой базе. Security не
публиковалась. HEAD e12b7c60 плюс локальный correction block; demo-output/ не трогать.

Web build10 PASS и scoped typecheck/lint PASS. Native platform3 собрал оба QA APK;
обновлены устаревшие androidTest fixtures, в том числе новые provider bounds.
Старый source96 run:72 PASS/24 FAIL, не PASS. Новый android-full на emulator-5580
(API34), session44205, output/qa/security336-native-sources-api34-1123-2/ ещё
собирает основной код. После изменения web/storage во время compile source hash
может отказаться: завершить build, затем повторить incremental build/identity,
а не подменять сохранённый fingerprint. Личные устройства не использовать.

Mounted private-product10 снова превысил10min на чтении источников (до archives),
без activation. Зафиксирована повторная обработка тех же ciphertext. storage.ts
теперь имеет bounded unlocked-only verified-read cache: каждый вызов заново читает
durable cell, сравнивает ВСЕ own data descriptors envelope и текущие root/signer,
scope/epoch/serial. Изменённый/чужой ciphertext, accessor, неизвестное поле и
отозванный signer не проходят; значения возвращаются отдельной копией. Lock/write/
eviction очищают owned bytes; <=256 entries/4MiB, body>256KiB не сохраняется.
Targeted23/23, typecheck и scoped lint PASS; полный unit5/session53554 выполняется.

Чтобы не менять проверяемый dist-web под действующим full3, cache build11 собран
отдельно в output/release-3.3.6/web-cache-11/public_html. QA server/runner принимают
явный --bundle и продолжают проверять его точный hash до/после. Private-product11
проверяет этот bundle; full3/session71478 проверяет прежний build10. Full3 уже
прошёл все free CRUD/backup/layout cases, выполняет standart; итог ещё неизвестен.
Новый локальный cache не принят полным browser journey. Coverage9/20, floors0,
cutoveroff/deployAndroidfalse. Далее: результаты, реальные fixes, весь20-path/
48-scenario объём, direct upgrade149, финальное внутреннее crypto review и выпуск.

## 23 ноября, 01:43 UTC: общая JS/JVM приёмка прошла

Security HEAD e12b7c60 включает main4c209a00356a0211a5a11a24580b458be3cf7bc3
(PR46 merged); строгие AGENTS сохранены. Exact-main website-only checks45094862291
ещё выполняются; после них отдельный Deploy с incumbentc1205c04. Security не push.

Полный unit4/session55606:2090/2090 PASS,0 fail/cancelled/skipped,
runtime/consolidated-unit-4.log. Native6/session55279 BUILD SUCCESS14m4s:
1426 tests,0 failures/errors,8 opt-in skipped,248 XML suites; т.е.1418 PASS,
а не1426 пройденных. Новый native platform build/session8780 собрал основной
debug APK, но instrumentation compile выявил6 устаревших вызовов редакторов
(migrationOwner); исправлены4 androidTest файла. Lint этого run ещё выполняется,
параллельный Gradle не запускать. Логconsolidated-native-platform-1.log.

Web build6 PASS после обновления generated legacy worker и выделения planner/
private-security-ui в самостоятельные chunks; прежний350000-byte gate сохранён.
196 HTML/14languages/13 dictionaries,151 offline entry assets/433 visuals PASS.
Первый full browser82166 остановлен: build ошибочно был без GENESIS_MINDMAPS=true,
поэтому missing mindmap controls не считаются продуктовым дефектом/PASS.
Перед его новым запуском нужен production-флаг и новый build. Но не менять
dist-web до завершения текущего private-product run, который проверяет его hash.

Новый mounted private-product suite использует настоящий built app/PHP/SQLite,
отдельный explicit synthetic --e2ee opt-in. Session59102, логconsolidated-private-product-1.log,
output/playwright/security336-private-1123/. Уже PASS: ordinary pilot identity,
реальная task create/reload, обязательные2 recovery downloads, confirmation без
horizontal overflow360/390/768/1440. Полный перенос/normal writers/clean recovery
ещё выполняются. Coverage9/20 не повышено, gates прежние.

## 23 ноября, 01:23 UTC: второй блок общей приёмки

Production сайта ужеc1205c045862fcfbaa01b48a1fbd7f04d6693b75,
Deploy45088162015 success. После live-ошибки языка/рублёвых Terms отдельно
подготовлен website-only PR46, commit41091fafb556d96b02e6db48a0d74093f1cdb97f
в upgrade-currency-20261122, веткаcodex/public-document-currency-20261123.
Локально1248/1248 unit/render, typecheck/lint0errors/4warnings, build:web196HTML,
public-region5/5 + startup4/4 PASS. Исправленный live ещё НЕ опубликован;
required CI45090567554/45090593699: Android jobs PASS, web browser ещё выполняется.
Auto-merge в репозитории выключен; не менять настройку. После слияния обязательны
exact-main website_only checks и Deploy с expected incumbentc1205c04.
Production manifest149 SHA582a282682b23af7368efe3a1f61533731a1915135f8dbd25dda6fbc7be54f63
не изменился. Browser liveWebsiteTab IAB2/tab9 остаётся на/terms?lang=en со старым
русским документом; final browser marker ещё не выдан. Не выходить из аккаунта.

Security послеd9ce2fb7 имеет локальные незакоммиченные исправления. TS Node runner
теперь transform-types, concurrency2 и scoped app-module resolver; CommonJS helper
кеширует модуль перед evaluation, устраняя циклическую рекурсию. Loader resolution
проверен42/42 content plan/readback/legacy snapshot tests. Первый завершённый полный
unit2:1864PASS/58FAIL/1cancelled из1923, не PASS. Большинство ошибок — устаревшие
fixtures: streaming native result-part acknowledgements, workspace privatePreferences,
provider bounds1M/65536, команда8MiB, отдельный технический local-write marker в
Physis fixture. После исправлений targeted159:158PASS/1FAIL; последний реальный
дефект editor queue устранён на web/native: merge снимает superseded preparing origin,
чтобы старый неслитый текст не отправлялся перед итогом. Web editor22/22 PASS.
JVM test получает свежий serial после failed prepare; новые Drive6 тестов проверяют
настоящий adapter/device-document/vault с заменой только внешних transport/session
ports: ciphertext download/readback, отказ при corruption/retirement/connection switch,
24MiB limit и disconnect без удаления. Они уже PASS в полномunit2.

Unit3 завершился2057PASS/33FAIL из2090. После него исправлены реальные TDZ
readKeys в ownership catalogue и ошибочный запрет экспорта публичного verifier SPKI;
signer остаётся verify-only, private signing key не открывается. Streamed planning
targeted30/33 PASS;3 negative assertions обновлены под более ранний полный custody
отказ, все3 затем прошли отдельными targeted cases. Новый fixture сохраняет настоящий
подписанный directory через device.rememberDirectory. Migration coordinator/source
81/81 PASS, включая exact replay незавершённого stage и CAS race с сохранением обоих
attempts. Admission1M/65536/512MiB проверяется новыми верхними границами. Targeted
lint всех изменённыхTS/JS —0errors/0warnings; полныйtypecheck PASS.

Backend2:155PASS/1FAIL из156 (shared-bulk-large превысил budget при compiler).
После освобождения compiler повторён только этот suite с тем же budget: PASS,
10001 tasks/10000 writes/one conflict228.5s, ветка6000 nodes6.7s,22MiB peak.
runtime/backend-bulk-idle.log и backend-bulk-idle-1123/logs/shared-bulk-large.log.
Таким образом все156 suites проверены, но это не156PASS в одном прогоне.
Полный HTTP API:402PASS/0FAIL, runtime/consolidated-api-1.log,
output/release-3.3.6/api-full-fixed-1123/api-results.json. Серверный код после этого
не менялся; повтор всего backend без новой причины не нужен.

Native4 с heap6GiB скомпилировал ВЕСЬ основной Android-код; упал на compile tests
из-за2 устаревших APIs. Native3/session65273 ранее остановлен Ctrl+C после явного
Gradle heap-exhaustion warning4GiB. Native5 компилирует tests:1426completed,
20FAIL/8opt-in skips. Исправлены fixture privatePreferences, philosopher default,
новые archive bounds/exact stage replay и API message backup (canonical32byte key).
Устаревший repository.writeBackup удалён из unit: его заменили real export/import
и entitlement checks; новый SAF handoff всё ещё требует platform/UI acceptance.
Ещё один РЕАЛЬНЫЙ native defect: retained intake сохраняет старые chunks, поэтому
редактирование должно GET-проверять already-bound ciphertext до PUT. Исправлено;
не ослаблять immutable file fixture. Messenger unknown-outcome fixture теперь
явно теряет и POST reply, и следующий reconciliation read; подтверждённый conflict
имеет реальную конфликтующую строку. Workflows checks/android-release используют
6GiB вместо4 по фактическому compiler evidence; схема публикаций не менялась.

Текущие running sessions:
-55606: полный unit4, runtime/consolidated-unit-4.log; весь JS correction block.
-55279: native6, runtime/consolidated-native-6.log; основной messaging fix и
  актуальные JVM fixtures. Никаких параллельных Gradle.
-82376/8909/23019/12977/96968 уже завершены, результаты выше.

Далее: результаты этих прогонов, реальные дефекты блоком, merge опубликованного
сайта в security с сохранением строгихAGENTS, browser/product recovery+upgrade149,
полный20-path/48-scenario acceptance и внутреннее финальное crypto review.
Security не push-илась, coverage9/20, floors0/cutoveroff, Android deployfalse.
demo-output/ не читать/stage. Goal active; субагентов/Daybreak не использовать.

## 23 ноября: общая приёмка начата, исправлен первый блок

Сайт PR45 merged в mainc1205c045862fcfbaa01b48a1fbd7f04d6693b75; required
CI45079650977/45079645821 success. Exact-main check45084250291 выполняет
browser scenarios; Deploy ещё не запускался. Main перенесён в security merge
cf0d4ed3, все строгие правила сохранены. Конфликты толькоAGENTS и QA suite map,
оба public-region и mindmap-save сохранены. Production всё ещёac8ccf60/APK149.

Основной кодовый проход сохранён fa74cd4e,05b89c4c,b1ad92e9. Общее тестирование
теперь разрешено порядком владельца. TypeScript404 →68 →16 →0 diagnostics,
последний PASS consolidated-typecheck-4.log. Lint73errors →0/22warnings,
consolidated-lint-2.json. Исправлены не только типы: restore digest теперь
canonicalJson вместо JSON parser; shared task status использует правильные
prepare args; recovery enrollment shadowing, old draft discovery prefix,
protocol5 refusals, UI committed-layout capture и refs, exact packet/result types.

i18n аудит3 PASS: английский, ещё12 локалей, native14, notification/template
catalogues. Новые snapshot/file/confirm/pending labels вычитаны для всех14.
Визуальная/смысловая приёмка всего остального нового UI ещё не выполнена.

Первый полный backend:132PASS/24FAIL.22 связанных failures начинались в старой
fixture inventory assumption: shared_space_ui имеет дополнительный space-wide
DENY/HASH fence, но read grant толькоpersonal. Fixture теперь явно сохраняет
этот запрет и проверяет, что space read по-прежнему запрещён. Её stale-marker
upgrade перенесён сv4 на действующийv8. E2EE store и shared-mindmaps PASS в
backend-fixed-contracts2/3-1123. Полная schema классификация обновлена через140:
семь новых signed/ciphertext protocol tables и2 private routing user fields.
Схема, включая negative unclassified-copy test, PASS backend-schema-final-1123.
Нужен повтор всего backend после этого блока; отдельно shared-bulk-large в первом
прогоне превысил локальный budget при тяжёлом параллельном Kotlin compiler.
Нельзя объявлять все156 suites PASS без фактического прогона.

Native первый фактический compile выявил93 diagnostics, в основном lexer >=
после generic return type и duplicate language. Исправлены14 native файлов,
callback Unit, explicit device-document current, readonly Handle closure,
missing imports, observer scope, job key и list prefixes. Второй native compile
ещё работает: exec63351, logconsolidated-native-2.log. Первую неудачную попытку
конфигурации отличать от compiler: PowerShell property args должны быть QUOTED.
Native UI5 переводных строк исправлены уже после старта второго build — нужен
ещё финальный точный build после всех изменений. Личные устройства не трогались.

Полные JS build/unit сейчасexec21989, logconsolidated-build-unit.log;
concurrency2, тот же полный tests/*.test.mjs и trace-sanitize test. Первые два
wrapper запуска были остановлены i18n errors до build/tests; они не PASS.
Нужны результаты полного unit, native, backend/API/browser, затем recovery/upgrade
3.3.5→3.3.6 и внутреннее крипторевью точного кандидата, исправления и выпуск.
Coverage остаётся9/20, floors0/cutoveroff, GENESIS_DEPLOY_ANDROID=false.
Gmail spam отдельный незавершённый пункт. demo-output/ не читать/stage.

## 23 ноября: завершён основной кодовый проход, далее общая интеграционная приёмка

Сохранён блок больших данных: semantic source/planning512MiB aggregate, отдельный
logical file64MiB, metadata16MiB, custody metadata128MiB; API/AEAD batch/chunk limits
не увеличены. Большие task histories пакуются в4MiB shards с exact ordered indexv2;
reader поддерживаетv1/v2, проверяет границы и EOF. Native source result transport
потоковый для всех10 domains, вход передаётся с acknowledgement по одному chunk,
с прежним network-disabled bridge. Локальный content-only archive128MiB plain /
192MiB file и100k entries/history; device document256MiB с bounded chunks. Drive
сохраняет существующие16MiB plain/24MiB transport bounds, клиенты отказывают до
сети; большие локальные файлы нельзя выдавать за уже отправленные в Drive.
Избыточная заранее выделенная память SAF заменена ростом буфера по факту чтения;
readback sealing проверяет hash потоково. Retired ciphertext export получил
отдельные owner-bound retry/cancel без старых keys/writer. Старые данные не
удаляются при admission failure. Все эти изменения пока source-only.

Основные известные кодовые блоки текущего списка связаны; следующий этап — общий
compiler/typecheck/lint/tests/build/CI, исправления реальных дефектов, приёмка
по исходному prompt и итоговое внутреннее crypto review. Нельзя считать это
готовностью выпуска или coverage20/20. Подтверждённое coverage9/20, cutover/floors
off, production Android3.3.5/149. Личные устройства/Play не менять. Сайт PR45
успешно merged в mainc1205c045862fcfbaa01b48a1fbd7f04d6693b75 после обоихCI;
точный main source check45084250291 ещё выполняется до штатного Deploy.

## 23 ноября: private reminder projection — код

Foreground compiler использует настоящие task/habit codecs и recurrence/quiet-hour/
frequency rules. Новый bounded rolling8-day/2048-event projection содержит только
opaque tokens/times/delivery flags, зашифрован отдельным локальным Keystore key;
он не открывает root, private content или writer. Receiver/maintenance/boot restore
читают только эту проекцию и показывают generic GENESIS с foreground входом.
Acknowledgement сохраняется до notify; возможна потеря одного generic alert при
crash в этом промежутке, без replay storm. По истечении — один generic unlock
alert; без нового foreground unlock новые дни не вычисляются. Account switch
перепланирует технический wakeup, старые данные/очереди не удаляются. Ошибка
компиляции видна в настройках на существующем14lang error copy. Частота private
habit reminders меняется в device preferences без legacy writer. Никаких
compiler/tests/CI/review; приёмка notifications ещё обязательна.

## 23 ноября: batched signed source transport — код

Web/API/native используют подписанный maxFragments<=50 и bounded2MiB ответы,
с неизменными1MiB scalar chunks. Collectors проверяют каждую координату, lease,
row hash, totals и EOF. Exact original replay сопоставляет batch packet; старый
single original используется только при отсутствии batch. Renewal проверяет
вложенные original fragments. Общая custody capacity согласована на2GiB/65536
parts/8000 observations/1M records/128MiB aggregate metadata, без увеличения
per-request limits или общего canonical command codec. Исправлено затенение
счётчика rows в native immutable table reader. Это source-only; compiler/tests/
CI/review не запускались. Остаток: semantic source/planning128MiB, bounded native
bridge input, широкие content-only archives/restore, private reminder projection
и завершение интеграции исходного промпта. Сайт PR45 ещё ожидает полный CI.

## 23 ноября: immutable private table shards — код

Relational source делит большие таблицы на bounded parts (обычно4MiB); прежний
object ID становится encrypted v2 manifest с точными ID/count/size/hash частей.
Small/v1 tables продолжают читаться. Normal web/native sourceTable, bootstrap и
personal shared views seed используют общий проверяющий reader с exact EOF.
Native output allowlist допускает только ожидаемые part IDs; original immutable
server trigger уже покрывает эти ID. Ключи/ACL не переносятся. Никаких проверок
исполнения. Следующим блоком начат batched signed fragment transport: незавершённые
изменения сейчас в server e2ee-legacy-private-path.php, migration-session/transport
и remote-original.ts; ещё нужны JS/native collectors и exact original replay.
Не запускать security compiler/tests/CI и не объявлять wide блок завершённым.

## 23 ноября: wide provider/product capacity — код

Physical provider admission и точный namespace inventory согласованы на web/native:
до1000000 encrypted record cells и65536 key containers, при реальной физической
квоте и прежней атомарности CAS. Лимиты отдельного запроса/батча/AEAD не увеличены.
Native prefix discovery использует индексный диапазон вместо substr scan.
Product index/bootstrap/proofs на web/API/native допускают100000 entities и4096
подписанных частей. Новая migration140 сохраняет принятые bootstrap parts/packets.
PHP bootstrap читает parts по одной; граф зависимостей обычной transaction и
bootstrap проверяет SQLite temp graph с bounded PHP ready pages, без fetchAll
целого графа. Web rollback comparison использует Map вместо квадратичного поиска.

Это ещё НЕ весь very-wide блок: private-path fragment transport requests,
table sharding/normal table readers, 128MiB planning/source limits и широкий
content-only backup/restore ещё требуют кода. Никаких compiler/tests/CI/review.
Security не опубликована, coverage9/20, cutover/floors off. Отдельный сайт PR45
cc52b46a: targeted region browser5/5 + startup4/4 PASS; full CI45079650977 и
45079645821 всё ещё выполняются. Старые414c4791 runs упали только из-за hash-only
fixture login; исправлено reload в QA, product code для этого не менялся.

## 23 ноября: background lock fencing — код

Private CloudSyncWorker/два reminder workers больше не входят в legacy sync,
expireIdleHabits/Room scheduler и не получают фоновые ключи. Сохранённый private
alarm/action показывает только GENESIS с открытием foreground; task/habit action
не меняет данные без vault. RestoreReceiver также не восстанавливает legacy
schedule защищённого аккаунта. Очереди и исходные расписания не очищаются.
Остаток notifications: новый полноценный technical reminder projection для private
режима ещё не подключён; generic wakeup старых PendingIntents не заменяет его.
Никаких compiler/tests/review. Далее wide transport/provider/source integration.

## 23 ноября: revoked-device replacement и отдельный reader — код

Web key storage получил append-only цепочку новых identity slots; native — новый
hardware slot с durable pending/readback и атомарным выбором. Старые namespaces,
encrypted bundles, hardware aliases и recovery containers не удаляются. Замена
явная: независимо сравненный personal target, подписанный revoke именно прежних
ключей, новый deviceId/root/keypair и обычный enrollment с новым approval. Ошибка
unlock/Keystore не запускает замену автоматически. Старые активные native handles
отсекаются указателем slot; web рассылает обычный cross-tab lock.

Web/native отдельные read-only readers не импортируют старый signingPrivate.
Typed ownership catalogue переведён на read-only device contract; проверочные
и receiving keys достаточны для custody/дешифрования. Original editor history,
разрешённые semantic device documents и retained migration user content можно
экспортировать отдельным independently keyed content-only backup из locked UI.
Native использует свежий credential и существующий ciphertext SAF handoff.
Никакие старые commands/grants не исполняются; writer/transport у reader отсутствуют.
Copy14lang добавлена. Текущие лимиты64MiB/10000 остаются частью следующего wide
блока, не заявлены как его решение. Код без compiler/lint/tests/build/CI/review.
Далее background writers/уведомления, very-wide bounds и остаток исходного задания.

## 23 ноября: typed shared content restore — код

Добавлен общий durable journal и web/native backup UI для выбранных типизированных
shared record versions. Target — тот же существующий project/space, открытый через
текущий trust/membership; чужой архивный scope ID не выбирает writer. Preview,
consent, bounded add-only операции и независимый normal product readback сохраняют
существующие версии/tombstones. Вложения берутся только из аутентифицированных
записей архива, пишутся обычной immutable queue и читаются обратно до записи задачи.
ACL/member-category policies, root topology, approvals, receipts и история jobs
не становятся authority. Automation definitions выключены, series paused; завершённые
задачи требуют нового действующего подтверждения. Original bytes/journals остаются
в custody и inert export. Copy14lang добавлена. Legacy table originals сохраняются
как content-only: этот adapter принимает типизированные normal records, не угадывает
их из произвольной старой таблицы. Весь блок source-only, без compiler/tests/review.
Далее: revoked-device replacement/background, very-wide bounds, остальная интеграция
исходного prompt; затем один общий QA/исправления/внутреннее review. Coverage9/20.

## 23 ноября: typed restore практик Стоихейона — код

Практики добавлены в общий add-only journal, preview/consent/resume, оба backup UI
и typed custody/export. Web editor/restore используют один normal aggregate;
native writer сохраняет совместимый practice aggregate через E2eeFeatureDocument.
Текущие works и tombstones не заменяются. Draw grants, reroll counters и другие
серверные права из архива не восстанавливаются. Полная native интеграция и общий
compiler/QA/review ещё не выполнялись. Далее: shared restore, very-wide bounds,
revoked-device replacement/background и оставшийся охват исходного задания.

## 23 ноября: typed Aurora session restore — код

Aurora sessions добавлены в общий add-only journal/preview/consent/resume и оба
backup UI. Полный async Aurora validator проверяет owner, source и current
readback в общем движке; normal web/native aggregate writers сохраняют текущие
sessions/removed/active selection. Никакие result grant, purchase, draw limits
или серверные service receipts из архива не применяются. Отдельные result bytes
и learning/history остаются в аутентифицированном архиве; открытие результата
по-прежнему требует текущего серверного разрешения и reference этого поколения.
Код без QA/compiler/review. Следующие restore domains: Стоихейон/shared.

## 23 ноября: typed Physis restore — код

Physis добавлен к общему add-only restore на web/native, включая backup UI,
typed custody/export и текущую проверку feature access. Web редактор и restore
используют один normal aggregate factory/validator; native пишет тот же aggregate
формат через E2eeFeatureDocument, common bundled engine проверяет полный health
schema source и readback. ID текущих записей и tombstones не заменяются.
Код без compiler/tests/build/review; исходные архивы/journals сохраняются.
Следующие typed domains: Aurora/Стоихейон/shared; прочий остаток ниже остаётся.

## 23 ноября: typed diary/mindmap restore — код

Добавлен общий domain restore journal: семантический source до сети, add-only
preview/consent, сохранённый fingerprint исходного состояния, bounded batches,
CAS штатных repositories и независимый normal readback, resume после прерывания.
Web/native панели backup подключены к дневнику и личным интеллект-картам; записи
и tombstones текущего поколения не заменяются, квоты/доступ проверяет обычный
repository. Заметки восстанавливаются сначала device-only, включение upload
остаётся отдельным действием. Предупреждение переведено на все14 языков.
Новые journals включены в typed custody и content-only export, они не служат
restore authority после импорта архива. Никаких compiler/tests/build/review.

Остаток typed restore: Physis, Aurora, Стоихейон и shared domains; затем very-wide
bounds и revoked-device replacement/background. Сайт ожидает CI отдельной ветки
414c4791; новый welcome render test проверяет обе редакции на всех14 языках.


## 23 ноября: переносы и raw bulk input — код подключён

Private transfer ports подключены к web/native нормальным product adapters:
durable input до IO, immutable file copy с независимым readback, destination
readback до soft retirement точных source versions. Direct task moves используют
тот же перенос между проектами; положение и явные изменения расписания сохранены.
Внутри проекта move проходит через обычную подписанную task transaction.
Незавершённые переносы входят в обе очереди pending/resume и retained custody/
content archive; никакого возврата к читаемым legacy endpoints.

Web bulk action/selection и native bulk form зарегистрированы для migration
capture до асинхронной записи: raw strings/selection/origin/calendar/baselines
и pending receipts. Cross-project ввод относится к personal.local-work с null
верхними координатами; реальные project/space IDs остаются в selection и исходных
снимках. Фиктивные scope IDs не создаются, формы остаются history-only.

Это завершение кодового блока без compiler/lint/tests/build/CI или общего source
review безопасности. Coverage9/20, floors0/cutover off. Далее: остальные typed
restore domains (diary/maps/physis/Aurora/Стоихейон/shared), very-wide bounds,
revoked-device replacement/background и оставшаяся интеграция исходного задания;
затем один общий QA/исправления/внутреннее крипторевью и выпуск.

Срочный веб-кандидат PR45 в отдельном upgrade-currency-20261122, HEAD9437513e.
Обе региональные редакции ×14 языков, GPS priority/VPN, disabled donation вне RU.
Локальная сборка196 HTML, i18n, targeted unit/render и browser matrix PASS;
required CI45074216964/45074213353 ещё выполняется. До live Deploy не переносить
неопубликованные веб-правки в эту security ветку и не объявлять их выпущенными.

## Срочный веб-запрос владельца — 22 ноября, текущее продолжение

Сохранён код client automation/series commit0cc1e3ca; после него добавлены private
bulk model и web/native routing, encrypted recovery pointer/custody/export,
перенос whole-tree с durable capture/copy/readback/retirement state machine.
Перенос ЕЩЁ НЕ подключён к web/native ports (move/copyFile/transferLoad/transferSave),
raw form attribution также не завершена. Не объявлять advanced block завершённым.
Новое копирование хранит source до проверенного destination readback; пока это
source-only незавершённая реализация. General QA/compiler/tests/build не запускались.

Новый срочный запрос: отдельный международный веб-выпуск для Paddle (оператор
Iurii/поддержка, нейтральная pricing copy, author/hreflang metadata и legal pages).
Работа выполняется в upgrade-currency-20261122 от свежего publish/main отдельно
от security. После веб-выпуска вернуться к подключению transfer ports, bulk raw
attribution, затем прежнему остатку. Goal active; E2EE/floors выключены.


## 22 ноября: клиентские автоматизации и серии — реализация

Добавлены общий client planner и normal-product routing web/native: определения
и условия, preview, signed owner/executor metadata, deterministic run/effect IDs,
история запусков, explicit retry, цепочки/лимиты и encrypted mentions. Серии:
preview/save/refresh/skip, три календаря, snapshot дерева без файлов/обсуждений,
материализация с CAS и постоянными occurrence IDs. Эффекты и run/series receipts
входят в одну подписанную product transaction; сервер проверяет фактического
исполнителя, актуальное правило/epoch и права. Foreground pumps используют только
открытый vault; скрытая вкладка/фон не получают отдельного ключа. Старые jobs не
возобновляются; исходники остаются content-only, instance baseline перепривязан.

Код без compiler/lint/tests/build/CI и без общего source review. Это не QA PASS,
не повышение coverage9/20 и не готовность активации. В этом блоке ещё остались
bulk/cross-scope execution и их raw-input attribution/custody; далее остальные
restore domains, very-wide bounds, revoked replacement/background и полный QA.


## 22 ноября: advanced form storage и attribution — код

Existing useSharedWorkDrafts теперь выбирает device-root journal после cutover
для workflow/planning/fields/views/templates/automation/access/import forms.
Текущие, заменённые и подтверждённые значения сохраняются отдельными encrypted
documents; clear — soft retirement, старые значения/части остаются. Mode change
подписан на private account; portable archive только inert content, typed custody
подключена. Web series input имеет owner/space/project attribution.
Native advanced journal helpers требуют открытый vault; automation и series
UI включены в NativeMigrationMemory с полными raw input/base/retry coordinates.
Код не проверялся исполнением. ОСТАТОК: bulk/cross-scope input attribution,
client automation/series/bulk execution, остальные typed restore domains, wide
bounds, revoked replacement/background и исходная полная интеграция.


## 22 ноября: typed personal workspace/task restore — код

Общий durable restore journal + web/native normal personal repository adapters
и оба backup UI: сохранённый source до сети, preview counts, explicit consent,
CAS, проверка нормального readback, resume неопределённого результата. Только
добавление отсутствующего личного workspace/task content; существующие записи
и task tombstones не заменяются, внешние Google-копии выключены. 14lang copy.
Original archive/journals/chunks сохраняются и экспортируются как inert content.
Другие domain-specific restore adapters (diary/maps/physis/Aurora/Стоихейон/shared)
ещё нужны; не считать весь typed restore завершённым. Общий анализ/тесты не запускались.


## Срочный сайт опубликован22 ноября

Mainac8ccf604bb42f7b7b19411f8703b88cd7dce8d2 / checks45057471114 / Deploy45061812677 success. Live desktop/Account и manifest149 подтверждены. Опубликованный main перенесён в security, strict block-first AGENTS сохранён. Security3.3.6 не публиковалась.

## 22 ноября: typed custody новых control documents (код)

Оба migration ownership catalogue учитывают personal-device-entry и invitation-
recipient documents: typed input/receipt, owner/authority binding, все текущие
chunks и сохранённые suffix parts. Чтение идёт через отслеживаемый read-only
provider; данные не становятся restore/enrollment/membership authority.
DeviceDocument получил optional read-only reader без изменения штатного writer.
Общий анализ и исполнение отложены до завершения всего кода по порядку владельца.


## 22 ноября: полный код пути приглашений (без приёмки)

Добавлены signed personal recipient consent, ограниченные страницы входящих и
ожидающих запросов, durable request до IO и exact receipt/state readback.
Приём получателем не выдаёт membership/keys. Owner admission входит в существующий
полный membership planner/atomic apply с revalidation приглашения, текущих прав
пригласившего и recipient consent. Consume/response admitted/ACL/rotations — одна
транзакция. Верификация устройства/выдача ключей остаётся отдельной.

Web/native показывают pending owner и pending device после reload, не переходят
в недоступный scope и не предлагают повторный Join/decline после admission.
Owner panel открывает существующий полный review; общий контракт14lang.
Новая migration139 и новые local recipient documents добавлены. Их typed custody
вместе с personal-device-entry marker ещё нужно подключить следующим кодовым блоком.
Никаких compiler/typecheck/lint/tests/build/CI security; coverage9/20.

Строгий порядок владельца22 ноября записан в AGENTS: сначала целые блоки кода,
затем общий analysis/QA/review, затем исправления. Остаток: custody новых markers,
very-wide bounds, advanced forms/automation/series/bulk/cross-scope, typed restore,
revoked replacement/background и оставшаяся интеграция исходного prompt.


## 22 ноября: mounted first personal trusted-device entry (source-only)

Cloud-sync/AuthController foreground factories + trusted personal-target export
подключены к новым core modules. Web PrivateVaultGate предлагает separate trusted
route: случайный local code, explicit save, independently compared target, saved
request/approval/retry; visibility/pagehide/unmount очищают UI и закрывают candidate.
Native locked gate получает новый bounded system credential на каждый шаг;
public intent захвачен до Activity, IO candidate закрывается перед возвратом.
Submit открывает normal product account из того же bundle/saved directory.
14lang shared copy добавлена, Android sourceSet уже включает contracts/e2ee.

Перед дальнейшим source work просмотреть новый UI/bridge diff. Никаких compiler/
lint/tests/build/CI security; coverage9/20. Ещё нужны typed marker custody/source
review и последующая общая functional/i18n/visual acceptance; это не QA PASS.
Остатки: recipient invitations/list/accept/decline + pending key-access/activity;
very-wide transport/local records; advanced/forms/automation/series/bulk/cross-scope
attribution; typed restore; revoked replacement/background и остальное prompt.

Срочный PR44 MERGED: mainac8ccf604bb42f7b7b19411f8703b88cd7dce8d2. Оба required
runs45053598174/45053630523 success. Exact-main website-only Source checks
45057471114 running; Android skipped. Deploy НЕ запускался, production6672bbef.
После success штатный Deploy с fresh incumbent, live QA и merge main в security.


## 22 ноября: first personal trusted-device entry core (source-only)

Добавлены personal-device-target/entry и matching Native E2eePersonalDeviceTarget/
Entry. Неизменяемая comparison capability создаётся из независимо сверенного
public personal target. Candidate provisioning хранит только новые local root и
device keys, не root личного scope. Existing bundle сохраняется. Signed directory
с заранее сравненной authority проверяется до provision. E2eeDeviceAccess принимает
узкий candidate context, прежний product account constructor совместим.

Protected chunked marker до challenge IO, stable attempts, explicit fresh request
с сохранением предыдущего; staged approval требует reconcile вместо abandonment.
Submit использует прежние challenge/selfProof/owner approval/exact receipt/normal
directory readback. Это ЕЩЁ НЕ UI: нужны foreground cloud/AuthController factories,
trusted target export, оба locked gates,14lang, lifecycle/credential handoff и
typed custody нового marker. Не объявлять first entry готовым.

Source review/diff check; compiler/lint/tests/build/CI не запускались. Coverage9/20.
Другие остатки: recipient invitations, very-wide bounds, advanced/forms/automation/
series/bulk/cross-scope attribution, typed restore, revoked replacement/background.
PR44 head0ca81bed ещё web browser QA, оба Android jobs success; Deploy не запускался.


## 22 ноября: foreign bound-product writer readback (source-only)

Web/native confirmPrepared теперь проверяет исходный подписанный packet и exact
receipt, нормальный текущий index либо точную historical version/proofHash и
расшифрованное тело. Чужой доверенный writer не обязан иметь локальный draft
на устройстве инициатора: readback не создаёт чужой journal и не пишет чужой ack.
Для собственного writer отсутствие original draft остаётся ошибкой; совпадение
чужого intent с локальным journal отвергается. Actual writer сохраняется из
проверенного signed proof, не подменяется initiating actor.

Compiler/lint/tests/build/CI security не запускались, coverage9/20. Остаток:
получатель/list/accept/decline invitations + pending key-access/activity UI; very-
wide transport/local records; first personal trusted entry; advanced/forms/
automation/series/bulk/cross-scope attribution; typed restore; revoked replacement/
background и оставшаяся source/divergence review исходного prompt.


## 22 ноября: ordinary invitation issue/revoke (source-only)

Новый shared-invitation-request связывает обычные space/project POST invitations
и DELETE invitations/id с существующим signed service. Полный raw input сохранён
до IO, UUID/intent стабильны без email/content hash. Web/native проверяют точную
квитанцию и fresh state: email/role/permissions/creator. Retained custody JS/Kotlin
понимает оба вида и null defaults. Server сохраняет business invite permissions/
escalation, транзакцию и prepared ID; эти действия не меняют membership/directory
и не передают ключи. Текущий подписывающий device + business permission допускают
routing без выдачи directory authority.

ОСТАТОК invitations: получатель/list/accept/decline и pending-key-access UI;
private activity presentation. Затем foreign product writer readback, very-wide
bounds, first personal trusted entry, advanced/forms/automation/series/bulk/cross-
scope attribution, typed restore, revoked replacement/background и прочее prompt.
Compiler/lint/tests/build/CI security не запускались. Coverage9/20.

PR44 head0ca81bed: оба Android required jobs success, оба web-and-api ещё выполняют
browser QA. Пока не merged/Deploy, production6672bbef.


## 22 ноября: combined category name+permissions (source-only)

Обычный PATCH member-category теперь целиком сохраняет title+permissions.
privateTitle остаётся в protected local draft и encrypted category version;
review/plan fingerprints и operation pages используют technical projection без
названия или его hash. На сервер идёт только rename:true; PHP/Kotlin/JS отвергают
privateTitle в wire header. Owner сам расшифровывает old/proposed values и
проверяет все остальные поля как точные normal effects. Initial UI показывает
сохранённое название, owner UI — проверенный before/after (web/native,14lang).

Source review/diff --check; compiler/lint/tests/build/CI security не запускались.
Coverage9/20. Следом ordinary invitations, foreign product writer readback, very-
wide bounds; затем остальные original prompt categories. Срочный сайт PR44
head0ca81bed проходит штатные required runs45053598174/45053630523; пока НЕ
публиковался, production6672bbef. Локально automatic Business enable, announcement
CTA, no Account toggle и desktop moon geometry проверены; см. web checkout.


## 22 ноября: private project-access view / typed native journal outcome (source-only)

Добавлен common membership-project-access: normal state/preview читают полный
pinned topology/ACL snapshot и normal decrypted project/task records. Catalogue
не берётся из legacy SQL; title удалённого project читается из проверенной
истории. Полный productIndexHash проверяется до/после чтения, snapshot после
catalogue считывается заново. Fingerprint состоит из technical metadata и
ciphertext refs; private titles/task values не хешируются для сети. Права,
наследование grants и assignment counts сохраняют обычный формат экрана.

Web/native ordinary GET/POST project-access подключены к этому view. Исходный
confirmed expectedFingerprint проверяется до initial apply; explicit fresh
resolution имеет отдельный preserved intent. Native members selector читает
private space root и verified ACL roles; identity labels отделены от authority.
Native planning journal send теперь ждёт foreground membership gate после
завершения isolated runtime; Typed VerifiedPrivateProjectAccessReceipt заново
читает original desired operation и completed durable cryptographic apply.
Сохранённая квитанция может отражать actual newer revision после явного нового
review; обычная network receipt по-прежнему требует exact+1. Raw HTTP/import не
создаёт typed receipt. Все commands/attempt markers и старые originals сохранены.
Pending background counters не считают waiting-for-review завершённым запросом.
Native runtime передаёт только safelisted typed project-access error codes.

Source review и git diff --check; compiler/lint/tests/build/CI security НЕ
запускались, coverage9/20 без изменения. Далее: combined category title+permissions
с полным сохранением private intent, ordinary invitations, foreign writer readback,
very-wide bounds; затем оставшиеся категории полного исходного prompt.

Срочный сайт ОПУБЛИКОВАН: main6672bbefd65abc4b9c3268800d02c57bd82ed967,
Source checks45042239234 success, Deploy45048236052 success. Live meta/health,
manifest и полный APK149 SHA-256 проверены. Живое окно тарифов показывает USD,
RUB/ЮKassa отсутствуют, screenshots360/390/768/1440 dark без переполнения.
Подробные пределы read-only QA записаны в web-pricing-region. Следом merge этого
main в security checkout с сохранением расширенного security AGENTS.md.

## 22 ноября: mounted membership review UI / durable normal outcome (source-only)

Web PrivateMembershipGate смонтирован в layout; Native PrivateMembershipHost — рядом
с migration host до vault early return. Pending/import entry подключён к существующим
панелям безопасности. Initial plan, owner approval и final apply имеют отдельные
подтверждения; grants/roles/permissions, scope/effects counts, actor/user IDs и
key recipients видимы; длинные grant lists постраничные. Общая copy написана на14
языках. SAF/browser framed review import/export и approval JSON подключены.

Обычный native request выходит из isolated runtime до ожидания человека. После
завершения host перечитывает durable atomic apply либо durable reviewed no-op;
UI result не является authority. Common membershipOperationResult даёт normal
revision/changed, no-op не создаёт signature/atomic state. Explicit resolution
сохраняет связь с исходным shared request; повторный fork идемпотентен,
разветвление/изменённый original — divergence. Старые packets/consent сохраняются.

Async web entry callbacks проверяют тот же account/view generation после await;
ошибка requirePrivateAccount не оставляет busy. Native ON_STOP отменяет UI jobs.
Общий counted private-ui-fence устраняет конфликт восстановления inert/overflow
при handoff между membership/migration/vault dialogs. Source review исправил
nullable intents и shadowed Kotlin error. Это НЕ compiler/visual/i18n acceptance.

git diff --check выполнен; compiler/typecheck/lint/tests/build/CI security не
запускались. Coverage остаётся9/20; cutover/floors off; никаких security push/deploy.

Следующее: verified private project-access GET/preview и Native planning-journal
send; полноценный combined category rename+permissions; ordinary invitations;
foreign product writer readback и very-wide transport/local records. Затем
first personal trusted entry, advanced/forms attribution, automation/series/bulk/
cross-scope, typed restore, revoked-device replacement/background и оставшийся
source/divergence review исходного prompt. Общая QA/crypto review — после кода.

Urgent main6672bbefd65abc4b9c3268800d02c57bd82ed967: exact-main checks45042239234
пока выполняет browser scenarios; Deploy НЕ запускался. После success выполнить
штатный website-only Deploy со fresh live incumbent, liveQA и merge main в security.

## 22 ноября: ordinary shared-request bridge / streamed owner-review file

После8f779f90 добавлены common membershipOperationForSharedRequest и nullable
SharedLivePorts.membership. Normal request целиком сохраняется ДО map/review;
role/remove/space-role/permissions/grants идут в новый durable operation, а не
legacy endpoint или display-only ACL edit. Web broker хранит только UI intent,
не authority; pause/restart сохраняет encrypted original, logout снимает waiter.
Это ЕЩЁ НЕ mounted review UI: next создать PrivateMembershipGate, pending entry
и matching NativeMembershipUi/Gate, 14lang copy; до этого новый source path
не считать рабочим обычным UI. Native callback membership ещё не подключён.

Добавлены matching TS/Kotlin framed review file reader/writer и foreground
cloud-sync/AuthController APIs. 6MiB max на frame, полный ordered header→plan→
preview→products→end, exact EOF/count/fingerprint. Import сохраняет header/parts
как inert originals до проверки pinned signatures/private effects. Отсутствующий
suffix/duplicate/reorder/truncation не даёт complete. Никаких trust/consent/apply
из одного файла. Native SAF streaming и browser async generator не собирают
пакет в один giant JSON. UI file picker/download ещё требуется.

Combined member-category rename+permissions намеренно fail-closed с сохранённым
raw input: нельзя выбросить title или изменить только private display ACL. Нужно
подключить full private input attribution (либо нормальный отдельный review таких
полей) до завершения этого UI. Project-access GET/preview из verified normal
records, display names/private root titles, ordinary invitation flows тоже нужны.

Impeccable context успешно выполнен; harden.md/craft-floor.md прочитаны. Existing
security UI authority: app/PrivateSharedSecurityPanel.tsx, Native PrivateSharedSecurity.kt
и PrivateMigrationGate.tsx/layout.tsx. Сохранять оформление; все screenshots/detector
и security compiler/lint/tests/build/CI отложены до окончания code phase владельцем.

Urgent exact-main checks45042239234: website job running, Android skipped, main
6672bbefd65abc4b9c3268800d02c57bd82ed967; PR43 merged. Live всё ещё c29b76e3,
Deploy не запускался. После green выполнить existing Deploy свежего main со fresh
incumbent, затем live QA и merge main в security сохраняя AGENTS/security source.

## 22 ноября: durable cancel / explicit fresh semantic review

Operation drafts теперь сохраняют optional cancelled/resolves, понимают прежние
originals и запрещают preview/confirm/start отменённого intent. TS/native resolver
сначала сохраняет local cancellation, затем получает server tombstone; committed
или unknown outcome требует read-only reconciliation и не создаёт duplicate.
Fresh fork только после подтверждённой отмены сохраняет старые proposal/review/
packets и начинает новый intent без переноса consent. Composers перечитывают
cancellation между staging/upload/sign/packet steps; v2 cancel tombstone сохраняет
late continuation inert. Native/web API добавлены. Source-only, без QA/compiler.

Urgent PR43 MERGED: main6672bbefd65abc4b9c3268800d02c57bd82ed967. Оба required
runs45034742687/45034738601 success. Exact-main website_only Source checks
45042239234 запущен; сайт пока incumbentc29b76e3, Deploy ещё НЕ запускался.

Следующий source шаг — подключить обычные роли/remove/grants/category/invitation
UI к новому durable path14lang. Impeccable SKILL/context уже прочитаны/запущены
успешно для app/PrivateSharedSecurityPanel.tsx; существующая система оформления
разрешена как scoped refinement. Следует прочитать reference/harden.md и
craft-floor.md до UI edits. Detector отложен до общей QA по прямому code-first
порядку владельца; security compiler/tests/build/CI по-прежнему запрещены.

## 22 ноября: ordinary-operation composer / complete private effects (source-only)

После651def7e добавлены common MembershipOperationComposer, web factory/API и
matching NativeMembershipOperationComposer. Frozen reviewed input → полный normal
index + decrypted target versions → deterministic batches и ВСЕ local product
drafts до первого upload → immutable versions → atomic plan → paged owner review.
Ни composer, ни prepare не создают implicit owner/final consent. Packets собираются
только из exact saved approvals и ещё раз pinned signature verification.

Root snapshots/atomic anchors теперь содержат productIndexHash полного normal
business index (с tombstones); PHP независимо рассчитывает тот же hash под lock.
Параллельно появившаяся/изменённая задача больше не может быть пропущена при
clear-assignments. Старые snapshot/anchor originals без hash остаются readable
inert, но новый builder/foreground review/final preflight их не применяют.

Common effects edits сохраняют related/files/body, снимают только assignee,
обновляют category permissions и добавляют immutable private role-history.
Normal history UI берёт actual writer из signed proof и отдельно хранит initiating
actor. Server bounded maintenance для уже завершённой задачи не меняет status,
completion, approvers/dependencies или иные presentFields; history create доступен
только внутри bound membership transaction, не через ordinary direct command.

Mandatory owner effects adapter теперь расшифровывает original normal records и
все предложенные immutable versions собственной scope; common pure verifier
требует ТОЧНО expected normal effects, включая complete task set. Подпись writer
не заменяет эту проверку. Web использует реальные repositories; Native — те же
pure edits/verifier в existing isolated runtime и настоящие JCA repositories.
createdAt из исходного durable intent входит в v2 request/fingerprint; прежний
source-only request без него сохраняется в retained mode, не даёт fresh consent.

Остаток этого path: ordinary role/remove/grants/category/invitation UI14lang,
durable stale semantic resolution/cancel, доступность foreign writer readback,
very-wide streaming/runtime/local-record bounds. Затем остальные original prompt
categories: first personal trusted entry, advanced/forms/automation attribution,
typed restore и revoked-device replacement/background, source/divergence review.
Compiler/lint/tests/build/CI security НЕ запускались; coverage9/20 не повышен.

Urgent PR43 всё ещё head45ad2e22; rerun45034738601 Android success, browser running
(начало browser15:37 UTC, снимок16:04 UTC). Не отменять этот required run. После
green merge expected head, exact-main website_only checks, штатный Deploy и liveQA.

## 22 ноября: v2 paged all-owner effects review (source-only)

Добавлены membership-atomic-review/owner/web-owner/review-prepare TS и matching
Kotlin Review/OwnerReviews/NativeReview. Полный header/page collector связывает
effects, scopes, actor begin signature, verified user/device recipient roster и
actual bound-product writers. Durable owner inputs/consent/packets precede network
verification/root rotation/export; v1 review не принимается. Foreign approval
paste stays inert until independently pinned owner signature succeeds. Exact saved
exports survive restart without re-sign/apply. Real web/AuthController foreground
APIs and typed retained partial/complete custody добавлены. Retained mode rebuilds
only existing saved signed history; foreground review requires current anchors.

Next: ordinary-operation composer from frozen reviewed effects to private record
edits, normal role/remove/grants/category/invitation UI14lang, stale semantic
resolution/cancel; остальные original prompt categories и very-wide streaming.
Source-only; compiler/lint/tests/build/CI запрещены до конца code phase.
Coverage9/20, production149/floors0/cutover off; demo-output/ не читался.

Urgent PR43 required CI45034742687 полностью success, но merge405: duplicate
push CI45034738601 cancelled checks также считаются required. Его cancelled jobs
перезапущены без ослабления защиты; не отменять повторно. После success merge
expected head45ad2e22, exact-main website_only checks и штатный Deploy.

## 22 ноября: historical bound-product readback (source-only)

Web/native confirmPrepared теперь получает исходный signed packet. Exact current
head сверяется с его proofHash; при более новой revision normal history читает
ровно исходную immutable version, verifyProductPage/client.verifyServiceProof
проверяют подписи, actual writer и точный command hash. Entity metadata, parent,
deleted, payload/object и decrypted body должны совпасть с сохранённым draft.
Более новый head сохраняется. Точный current ACL readback остаётся обязательным;
поздние ACL changes пока требуют explicit divergence/resolution. Все четыре
call sites/declarations сверены чтением; source-only, без compiler/tests/CI.
Coverage9/20 и production149/floors0/cutover off остаются.

## 22 ноября: durable final apply / реальные web и native readback adapters

Послеbd6a5c9c added matching TS/Kotlin final apply coordinators, separate v2
final-consent fingerprints, immutable signed requests/receipt pages и exact
unknown-outcome retry без повторного staging committed плана. CancelRequested
идёт только в read-only reconciliation. Real WebPrivateAccount/AuthController
bridges используют pinned normal scopes/index/decrypted products и итоговый
ACL readback до complete; receipt сохраняется раньше. Typed retained readers
сохраняют partial originals и связывают complete pages с observed signed frames
и actual foreign writer. Новые controls не входят в content-only import/replay.

Next: v2 all-owner full effects review/exchange и ordinary role/remove/grants/
category/invitation UI, input/effects-to-private-product composer. Historical receipt
readback добавлен ниже; explicit divergence/resolution для поздних ACL-изменений
ещё нужен, без overwrite или автоматического rebase. Very-wide streaming/native/local-record bounds и
остальные категории исходного prompt остаются. Не считать этот path normal E2E
готовым. Source review/diff only; никаких security compiler/lint/tests/build/CI.
Coverage9/20, production149/floors0/cutover off неизменны. demo-output/ не читался.

Urgent PR43 head45ad2e22, required CI45034742687: Android success, PHP backend
success после исправления race, браузерные сценарии ещё выполняются. Сайт пока
не опубликован; дождаться required checks, merge expected head с [skip ci],
exact-main website_only CI и штатный Deploy. Сохранить APK/manifest149.

## 22 ноября: signed-origin/complete receipt verifier (source-only)

Послеa7ed0822 added matching atomic-proofs TS/Kotlin: independently pinned
historical directory frames, actual foreign writer attribution, exact next
signed membership event, complete plan/packet page binding и paged receipt
collector. Receipt pages/counts/actors/versions/checkpoints checked before
mandatory normal scope/product readback callbacks; only all pages can finish.
Observed history remains separate from hypothetical append. No signer/POST/key
capability in verifier. Actual adapters + durable apply coordinator remain;
do not claim an interface callback as completed normal readback. V2 full effects
owner review, normal UI and the remaining original prompt still required.

Urgent PR43: required CI45033064903 Android PASS, web PHP130/131. Found existing
post-COMMIT activity UPDATE race in genesisChangeSpreadCard. Fixed in isolated
urgent checkout; existing full concurrency suite20/20 local repeats + PHP syntax
PASS. New urgent head45ad2e22a60468d68af9982fa0a2b918062b9f89, required PR CI
45034742687 running; duplicate push45034738601 cancelled. Nothing published.
When green, merge via expected head/[skip ci], run exact main website_only CI,
then existing Deploy with fresh live incumbent. Preserve APK149 and manifest.

Security source/compiler/lint/tests/build/CI still NOT run. Only source review/
diff hygiene. Coverage9/20, floors0/cutover off, GENESIS_DEPLOY_ANDROID=false.
No security push/deploy/devices/Play. demo-output/ remains unread/unstaged.

## 22 ноября: native/web receipt codecs и bounded attributed preview

После3b3b26a6 added strict receipt/header/page codecs, apply/read authorization
actions и оба native/web HTTP adapters. Server temporary ACL preview всегда
rollback; bounded pages include real userId/deviceId/desired role и hashes.
Web/native stagers читают страницы без пропуска scope indices, проверяют anchors;
retained custody понимает preview originals и valid foreign product writers.
Это всё ещё НЕ durable final apply coordinator или normal repository readback.
V2 all-owner effects review и обычные UI ещё нужны. Source-only/no QA/coverage9/20.

## 22 ноября: source-only server atomic writer / operation semantic preflight

После1f89c64c added operation/operation-grants manifest pages, matching TS/Kotlin
header validators, PHP current technical snapshot/fingerprint/normal planner,
full ACL/effects/anchor comparison и final transaction writer. New files:
e2ee-membership-operation.php, e2ee-membership-atomic-apply.php, migration138.
Products (including signed relayed writers), exact ACL, invitation/projection
revocation, all-owner rotations и immutable paged receipts share one lock.
Commit retry checks exact saved request hash; live personal signer is mandatory,
fresh anchors only waived for immutable prior result/read-only receipts. No
legacy audit/automation handlers execute. Private role history/readback are
still client work. Code is uncompiled/untested; coverage remains9/20.

Next: client apply signatures/coordinator/paged receipts + normal repository
readback and retained custody for new controls; allow/attribute the actual
foreign bound product signer consistently. V2 all-owner full effects review,
normal UI, very-wide streaming and remaining original prompt categories follow.
Do not treat v1 approval as v2. No security QA/push/deploy/device/Play. User's
code-first order, production149/floors0/cutover off remain.

Urgent web: branch CI45029384697 success; merge43 was rejected because GitHub
did not count workflow_dispatch checks as required PR checks. No protection
bypass. Empty source-identical commit9eaf74056d4d5dd34092727fd6b97ae0f0308158
triggers ordinary PR CI45033064903 (both required jobs), duplicate push CI
45033058071 cancelled. PR43 remains unmerged/unpublished; publish it first when
required PR checks pass, then exact main website_only checks and штатный Deploy.

## 22 ноября: packet-page coordinator и storage-only seal (source-only)

После9457c126 добавлены durable web/native packet manifests/pages и exact saved
seal requests, matching binding collectors для всех rotations/products/anchors,
native/web HTTP и migration137. Сервер seal сверяет complete persisted plan и
packet pages по одной и блокирует insert после immutable manifest. Это не final
ACL/product application. Retained custody теперь понимает также partial/ready
packet sets и foreign owner signatures по независимо pinned history. Content-only
restore не получил возможности исполнять control outboxes.

Следующий шаг остаётся final atomic writer: full graph/root/ACL closure, complete
effects, bound product commits, ACL/revocations/Google projection и owner rotations
под одним lock; затем paged receipts/readback, v2 all-owner review и обычные UI.
Не принять прежнее v1 согласие за review v2 effects manifest. Общая code-first
очередь из исходного prompt сохраняется. Никаких security compiler/lint/tests/
build/CI/push/deploy; coverage9/20, production149/floors0/cutover off неизменны.

## 22 ноября: durable atomic plan stager и retained custody (source-only)

Добавлены account-scoped web/native stagers, общий strict local TS codec и
matching Kotlin codec. Header/pages сохраняются/readback до IO, signed requests
immutable и повторяются без re-sign при unknown outcome. Cancel намерение
durable до запроса; между upload запросами перечитывается header. Typed custody
проверяет все ready pages, orphan/mismatch, immutable serial и exact signed
personal owner device request по pinned history. Input-only interrupted pages
сохраняются inert. Account lock/session guard действуют на storage/sign/HTTP.

Это ещё plan staging, не готовая normal membership: final atomic writer,
packet coordinator, complete receipts/readback, v2 owner review и ordinary UI
остаются. Новые outboxes не исполняются из content archives. Source diff/hygiene
прочитан; compiler/lint/tests/build/CI не запускались. Coverage9/20, floors0/
cutover off, production3.3.5/149 и GENESIS_DEPLOY_ANDROID=false сохранены.
Срочный web PR43 всё ещё в отдельном browser CI45029384697; его публикация первая.

## 22 ноября: atomic v2 pages/staging/cancellation (source-only)

После31f967ed добавлены TS/PHP page/manifest hashes, immutable SQL stage и
begin/page/status/cancel API с подписью текущего personal owner device. Веб и
оба native HTTP-адаптера подключены; pure native planner собирает общий manifest
с проверкой review fingerprint. Есть permanent cancellation tombstone, в том
числе до begin, и bounded hash-only status. Подробности и обязательный остаток:
`security-336-membership-atomic.md`. Это ещё не atomic apply: final graph/effects/
product/ACL/invitation/Google/owner rotations, paged receipts/readback, durable
client coordinator и normal UI не написаны. Очень большой snapshot ещё требует
streaming capture; не выдавать общий native input bound за wide E2E.

Security compiler/lint/tests/build/CI не запускались; generated assets не
обновлялись. Coverage9/20, cutover off/floors0, Android149 сохранены. Чужой
demo-output/ не читать/stage. Срочный web PR43 живёт отдельно и пока проходит
последний browser CI; затем штатный отдельный Deploy и перенос main сюда.

## 22 ноября: common membership planner/drafts/graph и bound product foundations

После120a6736 написан и подключён в isolated native runtime общий pure planner
normal role/remove/space permissions/category/grants. Исправлены from/null,
actor complete rows, effect-only scope closure и сохранение промежуточных clears.
Полный raw input сохраняется/readback до graph/state IO; proposals/history,
explicit review, repeated real pinned/decrypted graph checks и freeze до crypto
имеют общие web/native composers. Новый membership-graph — только technical
идентификаторы и пока только space owner. Missing pins/roots не подменяются.

Shared product получил prepare/confirmPrepared и binding в первой durable записи;
ordinary flush не применяет такие transactions. Новый product-commit-bound нельзя
выполнить вне containing membership writer context. Его proof требует следующий
подписанный directory frame с тем же membershipHash. Custody readers сохранены.
Пока этот action не используется normal handlers: complete effects/anchors hash,
atomic product/ACL/revocation, wide staged protocol, owner effect exchange и UI
ещё нужны. Полный объём: security-336-membership-operations.md.

Продолжать с полного effects manifest и staged atomic membership применения,
затем normal initiator/owner/invitation UI и stale semantic outcome/cancellation.
Project-owner-only graph нельзя открывать через generic readState bypass: нужен
проверяемый owner exchange. First personal trusted entry, advanced/form attribution,
automation/series/bulk/cross-scope, typed restore, revoked replacement/background
и source/divergence review остаются. Код ещё НЕ компилировался/тестировался;
assets генерировать после всего кода. Никаких tests/compiler/lint/build/CI/push/
deploy/device/Play. Coverage9/20, production/Paddle3.3.5/149/floors0/cutover off/
GENESIS_DEPLOY_ANDROID=false сохранены. demo-output/ не читать/stage; субагенты/
Daybreak запрещены. Этот turn — progress, не blocker.

## 22 ноября: обычные ACL semantics исследованы; excluded сохранён

После9bd8caf0 добавлен фактический `excluded`0/1 в project-grant specs/hashes
web/native/API. Старый input без этого поля читается inert и показывается как
reviewRequired; live operations не подставляют0. Non-input старые состояния
требуют custody review. Нет compiler/tests/build/CI/push/deploy.

Прочитаны реальные normal routes (не начинать их аудит заново):
- shared-projects.php1016: project role меняет row, отзывает приглашения target,
  RememberDirectProjectAccess и RefreshRestrictedProjectAccess; запрещён inbox.
- 1051: space role/permissions сбрасывают member category при manual change,
  default permissions при смене role, manager rows для admin/owner, inbox member
  для non-guest; guest удаляет inbox membership и clears private task assignees.
- 1127: removal clears task assignees + external Google projection links,
  отзывает invitations; последний guest без проектов теряет space/inbox; direct
  grant удаляется/становится excluded, затем restricted inheritance recompute.
- shared-project-access.php: pure nearest-explicit ProjectAccessRoles(projects,
  grants), includeDescendants и excluded→none. SaveProjectAccess обновляет space
  access revision, весь набор grants, derived project member rows, assignments,
  приглашения и audit. Legacy max grants5000, current batch200changes/256scopes;
  широкий atomic protocol ещё требует отдельного bounded/staged решения.
- shared-member-categories.php: category permissions распространяются на всех
  прикреплённых non-owner members; AssignMemberPermissions copies permissions и
  organizer flag. Это тоже ACL/rotation, не обычный private title write.

Central intercepts: web e2ee/shared-web-live.ts privateSharedRequest до run/model;
native NativePrivateProducts.sharedRequest до sharedLive.request. Здесь можно
сохранить полный encrypted raw role/remove/grants input ДО IO и открыть новый
membership review host. Пока обычные кнопки ещё идут в неподдерживаемую private
ветку. Не временно возвращать их в plaintext API и не запускать legacy functions
с generic SQL bypass. Нужен pure planner с теми же semantics и независимо
проверенным decrypted project topology/affected-scope closure, product changes
для private assignees и full atomic owner signatures. Затем normal UI14lang,
invitation request/consumption, stale-plan semantic resolution.

Большой остаток и ограничения ниже сохраняются. Coverage9/20; production3.3.5/149/
Paddle/floors0/cutover off/GENESIS_DEPLOY_ANDROID=false неизменны. QA только после
всего кода; demo-output/ не читать/stage, субагенты/Daybreak запрещены. Progress.

## 22 ноября: matching multi-owner membership exchange foundation (кандидат)

После39d98061/efaa701a добавлены membership-exchange / owner-review web/native:
полный typed request fingerprint, отдельный durable owner review до scope IO,
fresh owner-signed rotations, staged unverified imports и независимая проверка
pinned signed history/complete roster/manifest/epochs. Initiator product теперь
собирает свои и импортированные verified signatures; отсутствующий owner не
подменяется локальной подписью. Batch immutable; полный result сверяется с каждой
chained directory checkpoint и реальным readback. Real foreground/session-bound
cloud/AuthController bridges, normal-scope key readback для surviving recipient
и typed retained custody подключены. Наблюдённая signed history хранится отдельно
от hypothetical appended approval. Подробности: security-336-membership-exchange.md.

Следующий кодовый шаг — реальные обычные role/remove/grants adapters + durable
raw input до state/preview IO, full independent affected-scope closure, initiator/
owner UI с verified user/device attribution и14 languages; затем invitation
request/consumption и semantic resolution/cancellation stale partial plans.
Не считать эти модули готовой normal membership. First personal trusted entry,
advanced/form/automation/bulk/cross-scope, typed restore/revoked/background и
source/divergence review остаются. Foreign directory proof не требует roots
инициатора; independently accepted authority pin остаётся обязательным.

Никаких compiler/typecheck/lint/tests/build/CI/push/deploy/device/Play. Code-first
этап продолжается; coverage9/20, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false,
production3.3.5/149/Paddle сохранены. demo-output/ не читать/stage; субагенты/
Daybreak запрещены. Текущий turn progress, не blocker.

## 22 ноября: membership ACL hash projection исправлен (кандидат)

После3f97d92f/291238ee matching JS/Kotlin/PHP contract `acl-name-value-v1`
исправляет beforeHash/changeHash/batch hash/duplicate keys без расширения общей
canonical grammar. SQL column names становятся sorted name/value records;
строки сохраняют точные UTF8 bytes в utf8/base64url wrapper. Typed changes и
readState сверяют значения/coordinates/hashes. Новые membership journals имеют
hashFormat; старые input-only originals доступны как inert history, но старый
план не может автоматически получить новый hash или новую подпись. Retained
custody readers подключены. Подробности: security-336-membership-contract.md.

Код не компилировался/не тестировался. Следующий конкретный участок остаётся
normal membership/invitation UI и all-owner rotation exchange: нынешний
E2eeMembershipProduct.prepare всё ещё сам готовит все scopes, а scope client
требует собственника; импорт подписанной чужим owner rotation ещё не подключён.
Нужны полные before/change/scope/device reviews, durable input до state/preview IO,
обычные role/remove/project grants handlers, потом invitation request/consumption
и exact receipt/readback/resume/semantic stale-plan resolution. First personal
trusted-device entry, advanced/form/automation/bulk/cross-scope, typed restore,
revoked replacement/background и source/divergence review остаются.

Производство3.3.5/149/Paddle-сайт/floors0/cutover off/GENESIS_DEPLOY_ANDROID=false
сохранены; coverage9/20. Общая QA только после всего кода; никаких tests/compiler/
lint/build/CI/push/deploy/device/Play. demo-output/ не читать/stage, субагенты/
Daybreak запрещены. Состояние progress, не blocker.

## 22 ноября: signed device-access exchange в обычном Account (кандидат)

После11ff51d3 добавлены matching device-access contracts/journals и Account UI
web/native: durable request до challenge IO, exact optional requestId receipts,
self-proof, manual independent fingerprint, owner-only HPKE forwarding текущих/
исторических roots, durable signed grant до export, candidate-only submit и
exact receipt/directory/normal-scope readback. Pins сохраняются отдельно от open,
чтобы новое устройство могло запросить доступ.14-language copy включена штатным
assets path. Request/grant originals не удаляются; background/session/lifecycle
guards сохранены. Retained recovery enrollment теперь читает фактический
hex64 sessionHash сервера. Подробности: security-336-device-access.md.

Код ещё НЕ компилировался/не тестировался. Это shared enrollment внутри уже
разблокированного personal product account; начальный personal entry по-прежнему
использует независимый recovery. Следующий код: normal invitation/member editing,
multi-owner membership/rotation и first-device trusted entry. При чтении найден
ещё не исправленный блокер membership hashing: raw ACL keys/after содержат
underscores, запрещённые canonical technical object keys. Нужна отдельная
совпадающая wire-hash projection (sorted name/value arrays) в API/web/native,
включая beforeHash/changeHash/batch requestHash/custody; не расширять глобально
canonical format и не менять старые подписанные packets.

Остальной large remainder ниже сохраняется. QA только после всего кода;
coverage9/20,3.3.5/149/Paddle-сайт/floors0/cutover off/GENESIS_DEPLOY_ANDROID=false
сохранены. Никаких push/deploy/device/Play. demo-output/ не читать/stage,
субагенты/Daybreak запрещены.

## 22 ноября: semantic resolution locked project preparation (кандидат)

После d682118c добавлен resource-create-resolve: под тем же SQLite writer lock
возвращает прежнюю preparation или сохраняет permanent semantic cancellation
receipt для original resource-create-prepare. Late original/renewed request с
тем же semantic payload больше не создаёт проект. Проект/область/история не
удаляются; отмена строго проверяет форму original topology, bootstrap authority
и текущий personal device, но не требует прежних anchors быть текущими.

Web/native journals сохраняют hashes/fixed resolver до IO и проверяют весь
result. Только cancelled допускает новые intent/resource/scope IDs с независимым
будущим root; coordinates сохраняются до нового input journal. Рестарт дописывает
тот же child. Полный input сохраняется, consent/anchors не переносятся. Pending
скрывает старую попытку только после проверки durable replacement. Recovery UI
имеет явный resolve action с14-language explanation; waiters переносят только
promise результата, не keys/secrets/input. После started обзор показывает IDs/
roles из encrypted review без зависимости от доступа к прежнему space context.
Content-only export сохраняет resolution hashes/receipt/lineage как inert data,
не bootstrap packets. Retained service custody понимает resolver originals.

Это исходники, без compiler/typecheck/lint/tests/build/CI/push/deploy/device/Play.
Coverage9/20, floors0/cutover off, GENESIS_DEPLOY_ANDROID=false и production
3.3.5/149/Paddle-сайт сохранены. Следующий большой участок: normal invitation
acceptance/member editing/device approval и all-owner membership/rotation UI.
Далее advanced shared/form attribution/automation/bulk/cross-scope, typed restore,
revoked replacement/background и interrupted-source/divergence review. Общий
кодовый этап продолжается; QA только после всего кода. demo-output/ не читать/
stage, субагенты/Daybreak запрещены.

## 22 ноября: обычное создание private project подключено (кандидат)

После eb87df2b добавлены web/native encrypted project input journals и composers
реально pinned/decrypted space/parent/category/status anchors. Обычные create
buttons теперь сохраняют полный input до IO, открывают явный participant/role
review, отдельно сохраняют consent и выполняют fixed preparation → migration →
actual product baseline → immutable root/status revision2 transaction → readback.
Обычный private project result читается до complete. Account pending/resume
перечисляет space и project, content-only archives включают оба типа input.
Общие copy/roles/default status titles добавлены на14 языках. Это routing review,
не device approval: ни preview, ни кнопка согласия сами не выдают keys/capsules.

Space/project preparation дополнительно разрешает потерянный response даже
если scope-setup journal уже complete после directory read: повторяется тот же
semantic service intent, receipt сверяется с exact bootstrap command hash.
Завершение space creation также перенесено после actual normal result read.

Код ещё НЕ компилировался/не тестировался. Coverage9/20 не повышен. Следующий
кодовый участок: semantic resolution/cancellation locked project preparation
после started=true, с сохранением original intent/packet, permanent tombstone
против поздних retries и явным новым review перед новой попыткой. Не retarget
старый bootstrap/ID. Затем остальные normal membership/invitation/device/rotation,
advanced parity/automation/bulk/cross-scope, typed restore/revoked replacement,
background и interrupted-source/divergence review. Не запускать общую QA до
завершения всего кода. Production3.3.5/149/Paddle-сайт сохранены, floors0/cutover
off/GENESIS_DEPLOY_ANDROID=false; никаких push/deploy/device/Play действий.
Субагенты/Daybreak запрещены, чужой demo-output/ не читать/stage.

## 22 ноября: reserved chaos-status source positions

После26070b3d при source inspection composition найден блокер старых/новых
project baseline: оба shared-domain readers запрещали position -2/-1 существующих
system chaos statuses. Внесён узкий typed reader: только exact chaos-open/done:
resourceId, project binding, is_chaos1, соответствующие is_done и positions.
Обычные positions остаются nonnegative integers; flags0/1 проверяются явно.
Это code-only fix, не QA. Следующий большой кодовый участок всё ещё project
creation journals + independently verified anchors + normal UI, как ниже.

Прочитано для следующего шага (не начинать заново): WebPrivateAccount имеет
scopeSummaries/contentScopes/shared/sharedRecords; shared-web-live.ts open()
ищет exact resource в E2eeSharedTrust.list(), вызывает trust.open(scopeId), затем
account.sharedRecords. E2eeSharedRecords даёт product.index/read, get(kind,id),
sourceTable и actual normal product writer. Space creation journal — образец в
private-resource-create.ts; composition в cloud-sync.ts completeCurrentPrivateSpaceCreation.
Native normal createSharedProject сейчас всё ещё sharedCall→legacy JSON API:
AuthController.kt около1436. Web createSharedProject около2865. Project UI
подключать только после encrypted pre-network input/preview/explicit review.

## 22 ноября: read-only project preview и реальные scope-client ports

После8836bb1c added signed personal-owner project-create-preview + реальные
web/native E2eeScopeClient.readProjectCreationPreview. Server inspect выделен
из verify: preview не создаёт placeholders/receipts/membership/scope/capability.
Actual prepare заново проверяет exact reviewedMembers и только после сравнения
материализует FK/capability. Client ports проверяют cp личной области, resource,
shape, same-scope anchors и неизменность selection. Контракты теперь отдельно
читают selection и proposal topology. Подчёркнуто: response reviewedMembers —
предложение routing, не согласие пользователя; UI должен хранить отдельный review.
Уточнены metadata2 ограничения task-list/inbox category, совпадающие в3 клиентах.

**Продолжать с project creation journals + actual UI**: оба encrypted input до IO,
независимо pinned/decrypted space/parent/category/status anchor composition,
read-only preview → explicit durable review → fixed signed preparation/receipt →
project migration + actual baseline → intended private root и localized statuses
с readback → complete/normal result. Подключить обычные web/native create buttons
и account pending/resume. Existing private-space journal/controller — рабочий
образец кандидата, не надо заново исследовать весь migration engine.
Подробности: security-336-private-resource-creation.md. Все предыдущие ограничения/
остаток сохраняются, no tests/compiler/lint/build/CI/push/release/device, coverage9/20.

## 22 ноября: signed fresh-project server preparation (кандидат)

После95e140a5 добавлена project-ветка resource-create-prepare:
GenesisE2eeProjectCreation проверяет current space/parent/category/status anchors,
metadata2 ancestor topology, create/write permissions, отсутствие цикла/inbox/
archive и exact sorted reviewed inherited members. Capability привязана к PDO/
transaction и потребляется после fresh inheritance. Существующий factory
сохраняет feature/space-owner quotas/creator owner/defaults; теперь получает
только технические placeholders. Scoped restricted inheritance не переиндексирует
и не изменяет старые проекты/назначения. Это routing rows, не device/capsule trust.
Rows + independent bootstrap + semantic receipt атомарны. Project receipt содержит
topologyHash, placement, exact statuses{id,isDone,isChaos}, reviewedMembers иcp1.

Fencev8 разрешает exact rows ещё для shared_space_project_categories. Current
private category/status heads создают недостающие FK placeholder rows без
вывода title/colour/order. Старые строки сохраняются и проверяются по lineage.
Web/native project-create-contract / E2eeProjectCreationContract и service custody
теперь явно понимают новый payload; bootstrap keys/authority всё ещё проверяются.

**Точный следующий код**: read-only recipient/topology preview пока отсутствует;
нужны обе durable private-project creation journals, независимая проверка anchors
и явный review до подготовки, fixed payload/receipt, migration + actual product
baseline, private intended root и localized status values с readback, normal
create/resume buttons/account pending list. Не переподключать обычный project
create к plaintext API после personal cutover. Space journal уже работает как
кандидат; его нужно расширить/сочинить project counterpart, сохраняя original input.
Документ и точная форма серверного payload:
security-336-private-resource-creation.md, server/src/e2ee-project-create.php.

Никаких compiler/typecheck/lint/tests/build/CI/push/release/device actions;
coverage9/20, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false.3.3.5/149/Paddle-сайт
сохранены. Остальной большой кодовый остаток ниже остаётся. Не читать/stage чужой
demo-output/, не использовать субагентов/Daybreak.

## 22 ноября: foundation fresh project topology / exact row capability

После07dd5e35 добавлены совпадающие web/native/API project metadata2
(space/parent/category/board/kind/layout/inbox/archive) и сравнение с decrypted
body. Старый metadata1 project header явно читается как история без topology
authority, старые originals/jobs не выбрасываются. Persistent fencev7 разрешает
только exact full before/after row capability для shared_projects/statuses через
отдельный connection-local WeakMap, в transaction и с finally cleanup; SQL
callback не запрашивает БД и не принимает boolean request bypass. Четыре ACL
таблицы/полный membership rotation protocol не расширены и не ослаблены.

В actual normal root commit теперь подключён e2ee-project-topology.php:
синхронизация только signed technical category/board/layout/archive, private
category/status heads, parent access/restore quota; односторонняя смена parent/
kind/inbox запрещена. Live topology reader требует exact undeleted metadata2
root + active product bootstrap + совпадающий SQL tuple, без legacy fallback.
Это foundation; factory/signed preparation/inheritance и обе обычные кнопки
создания projects ЕЩЁ не подключены. Точный следующий участок и ограничения:
security-336-private-resource-creation.md. Нужны all-scope parent operation и
оставшиеся delete/restore quota/trash lifecycle semantics. Остальной остаток ниже.
Код не компилировался/не тестировался; coverage9/20,3.3.5/149/Paddle/floors0/
cutover off/GENESIS_DEPLOY_ANDROID=false сохранены. demo-output/ чужой, не читать/
stage. Субагенты/Daybreak запрещены.

## 22 ноября: lost-start cancellation и постоянная отмена attempt (кандидат)

После06103b46 добавлен новый code-only блок: schema135 permanent cancellation
tuples и SQL lease guards, signed migration-cancel-start с полным original
подписанным start, атомарное разрешение/operation tombstone и отмена только
matching lease. Новые start/resume не оживляют отменённый migrationId, обычный
expired lease сохраняет renewal. Shadow objects/прежние receipts сохранены.

В реальных web/native cancel flows raw state + fixed resolver сохраняются до
IO. Timeout/process death повторяет тот же packet; только полностью проверенный
результат позволяет clear live pending. Оба пакета остаются типизированной
защищённой уликой startCancellation в прежних1/2/4 journals. Узкий старый
cancelled/no-lease/start-pending допускает только custody/resolution, не restart/
run/barrier release. После resolution перепроверяется ownership graph, затем
existing controller требует fresh preparing directory. Active/другая текущая
миграция сохраняет границу.

Подробности/обязательные будущие races: security-336-retained-migration-history.md.
Код ещё не компилировался/не тестировался; coverage9/20. Общий кодовый этап,
fresh project/member/device/automation/restore/background и changed-prefix/domain
divergence review остаются.3.3.5/149 и Paddle-сайт сохранены, floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false. Push/deploy/CI/build/device не запускались.

## 22 ноября: возобновление прерванного local source-stage (кандидат)

Web/native теперь аутентифицируют все записанные prefix parts отдельно от
логического EOF, открывают прежний journal с исходным actor/target/CAS serial и
повторно сверяют producer со всеми сохранёнными байтами, включая complete paths.
После совпавшего prefix дописываются только новые immutable parts; сохранённый
короткий хвост нельзя расширить или заменить. Account-wide ownership proof
признаёт эту точную quarantine-роль, не пропуская неизвестные remnant cells.
В reconciliation/publication по-прежнему входят только полностью завершённые
paths/manifests с transactional catalogue CAS. Последний resumed journal
используется повторно без ещё одной полной копии.

Документ: security-336-retained-migration-history.md. Это только код; общие
QA/compiler/typecheck/lint/build/CI ещё не запускались, coverage9/20.
Changed-source prefix/divergence review и ambiguous legacy cancel ещё требуют
реализации, как и большой остаток fresh project/member/device/automation/restore/
background ниже.3.3.5/149 и Paddle-сайт сохранены; никаких push/deploy/device
действий. Не читать/stage чужой demo-output/.

## 22 ноября: normal native Messenger journal (кандидат кода)

После3d411176 добавлен `data/MessengerJournal.kt` и подключён к обычному native
MessengerRepository/Screen: owner/conversation/kind binding, stable draft token,
durable edit target/base revision, explicit legacy draft/pending readers,
строгое receipt/readback, done/recovery markers до cleanup и сохранённые inert
originals. DELETE не очищает независимый текущий черновик. Explicit copy recovery
требует fresh existing-create/advanced-CAS proof, а не любого409. UI write/send
больше не используют необвязанный delayed draft callback.
Документ: `security-336-native-messenger-journal.md`. Код не компилировался и не
тестировался; coverage9/20, общая приёмка только после завершения кода.

Следующий участок — interrupted source-stage capture/legacy-cancel/divergence
review; остальной большой остаток ниже остаётся, особенно fresh project
topology/inheritance, membership/device/invitation UI, automation/bulk/cross-scope,
typed restore/revoked replacement/background. Никаких push/deploy/CI/build/device
действий.3.3.5/149 и Paddle-сайт сохранены. demo-output/ не читать/stage.

## 22 ноября: native shared-message файлы переведены на новый handoff

После6e88a5b9 добавлен непроверенный код реального native MessagingScreen:
protected intake/output selection до picker, transient URI-only handoff над
vault gate, свежий repository после unlock, строгие conversation/draft/key pins,
source/part hashes до chunk IO, same-source/nonce/ciphertext resume, сохранение
оригиналов и displaced drafts, явные defer/restore/copy UI и14-language copy.
Сохранение файла проверяет исходный message seq/revision/file и использует общий
bounded prefix/readback writer. Archive/message input/message output разделены
purpose; старые прямые plaintext provider callbacks удалены из этого экрана.
Описание и реальные границы: `security-336-native-message-attachments.md`.

Ещё остаются normal Messenger durable edit/exact-command recovery и детали
старого shared-message conflict recovery, а также общий прежний остаток:
fresh project topology/inheritance, membership/invitation/device UI, advanced
parity/automation/bulk/cross-scope, typed restore/revoked replacement, background
и interrupted-stage/legacy-cancel/divergence. Общий кодовый этап продолжается;
QA/compiler/lint/build/CI не запускались. Coverage9/20, floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false; production3.3.5/149 и Paddle-сайт сохранены.
Субагенты/Daybreak запрещены, demo-output/ чужой — не читать и не stage.

## 22 ноября: fresh-space create/resume подключён (непроверенный код)

После shared controllers2c1d3ba2 добавлена реальная web/native композиция обычной
кнопки create space: encrypted input до IO, независимый recovery dialog,
space+inbox transitions, actual product baselines, immutable private initial
root/revision2 с readback, фиксированные pending invitation IDs/receipts/readback.
Незавершённые creation inputs перечисляются/возобновляются в account security.
Приглашение не создаёт membership, device approval или key capsule; обычные
member/invitation/device-review UI ещё требуют композиции. Подробности обновлены
в `security-336-private-resource-creation.md` и implementation-pass.

Далее: fresh project topology/inheritance и нормальная membership/invitation
композиция; также остаются advanced parity/automation/bulk/cross-scope, typed
restore, revoked-device replacement, native attachments/background и источники
с interrupted-stage/legacy-cancel/divergence. QA/compiler/lint/build/CI пока не
запускались по порядку владельца; coverage9/20.3.3.5/149 и Paddle-сайт сохранены,
floors0/cutover off/GENESIS_DEPLOY_ANDROID=false. Не читать/stage demo-output/.

## 22 ноября: shared controllers подключены, далее полный create flow

Поверх223891fb добавлен кандидатный код web/native shared owner transitions:
повторное использование открытого owner device, active personal deny barrier
без ослабления при отмене child scope, полный matching source registry,
технический signed inventory старых ресурсов, recovery-signed shared setup,
реальные recovery/stop/cancel UI и private product bootstrap/readback.
Описание: `security-336-shared-migration-controllers.md`. Coverage всё ещё9/20;
compiler/typecheck/lint/tests/build/CI не запускались по порядку владельца.

Следующий кодовый участок — композиция сохранённого fresh-space intent со
space+inbox transition, private initial values, адресатами и create/resume UI;
затем project topology/inheritance, domain parity, automation/bulk/cross-scope,
typed restore, revoked-device replacement, native message files/background и
оставшиеся source-stage/cancel/divergence cases. Полная приёмка, исправления,
точное итоговое внутреннее крипторевью и раздельные выпуски ещё впереди.
Не читать/stage demo-output/, не использовать субагентов/Daybreak. Production
3.3.5/149 и принятая Paddle-витрина сохранены, floors0/cutover off и
GENESIS_DEPLOY_ANDROID=false. Разрешение полного выпуска уже есть.

## Следующий участок: общие migration controllers и создание ресурсов

Retained-history код сохранён локальным коммитом **9990d744** (32 files,1841
insertions). Проверки по порядку владельца ещё не запускались, coverage9/20.
Затем добавлен новый кандидатный код подготовки свежего private space:
`server/src/e2ee-resource-create.php`, web/native `E2eePrivateResourceCreation`,
новый signed service `resource-create-prepare`, транзакционная композиция
существующих shared-space factory/bootstrap и проверка этой роли в обоих custody
readers. Исходный prompt SHA256 по-прежнему
5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338.

Новый код пока не является работающим create UI: он сохраняет полный input
зашифрованно до сети и атомарно создаёт только технические space/inbox/status
rows и preparing scope, без передачи названия/описания/обложки/приглашений.
Реальные shared migration controllers, обе миграции space+inbox, private initial
values, участники и project topology — следующая конкретная реализация.
Подробный разбор уже существующих функций, persistent SQL fences и допустимого
направления: **security-336-private-resource-creation.md**. Не повторять поиск
с нуля и не пытаться обойти active-space fence обычным legacy-create.

No tests/compiler/lint/build/CI/push/release/device actions. Floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false;3.3.5/149 и Paddle-сайт сохранены. Не использовать
субагентов/Daybreak; не читать/не stage чужой demo-output/. Разрешение на полный
раздельный выпуск уже дано, внешний аудитор не нужен; итоговый внутренний review
точного финального кандидата остаётся после всего кода, QA и исправлений.

## Продолжение22 ноября: retained ownership и повтор перехода

Поверх HEAD485acdfd добавлен новый непроверенный код web/native: общий реестр
владельцев и ролей всех областей, полное чтение legacy v1/v2 plans, state4/5
preparation/adoption и control packets, настоящая retained source history,
подтверждаемая подготовка после отмены, явная проверка обычных product outboxes.
При замене обычного завершённого job сохраняется его исходный header; при renewal
Aurora сохраняется прежний packet. Оба content-only exporters теперь включают
читаемые пользовательские значения прежних планов как inert history.

Подробности: `security-336-retained-migration-history.md`. Это НЕ compilation/QA,
НЕ финальное крипторевью и НЕ приёмка релиза. Coverage9/20;3.3.5/149 и принятый
Paddle-сайт сохранены; floors0/cutover off/GENESIS_DEPLOY_ANDROID=false. Чужой
demo-output/ не читать/не stage. Тесты/compiler/lint/build/CI/push не запускались.

Точный остаток этого блока: legitimate incomplete source-stage capture пока
удерживает барьер; unresolved legacy start/no-lease cancellation требует явного
разрешения; divergent previous/current domain snapshots требуют review workflow.
Не обходить это префиксным фильтром, удалением originals или пустой подстановкой.
На общем QA проверить новую web/native композицию и стоимость повторного полного
чтения графа. Typed restore/revoked-device replacement ещё не реализованы этим
экспортом. Следующий кодовый участок — создание новых закрытых shared resources,
затем shared migration controllers и остальная parity/automation/background работа.

Историческое «cancelled state4 вообще не поддерживается» в нижних срезах заменено
этим новым кандидатным кодом и перечисленными конкретными ограничениями. Общая
приёмка всех 48 сценариев/14 языков/размеров/тем/API26+/149 upgrade, исправления,
точное внутреннее крипторевью и уже разрешённые раздельные выпуски ещё впереди.

## Кодовое продолжение22 ноября — поверх исторических срезов

Локальная ветка `codex/security-336`, кодовый HEAD `4f4bfd5f`. Добавлены пять
кандидатных коммитов после `4a87de8e`: `e8c581a8` (личные Drive-копии web/API/
Android), `66582ed1` (явная проверяемая отмена перехода в обоих интерфейсах),
`c933e9f0` (transient SAF для независимого ключа сообщений), `434c919e` (web
выгрузка текущих/исторических файлов), `4f4bfd5f` (native выбор назначения,
повторное разблокирование и проверенная выгрузка выбранных версий).
Все изменения сохранены локально. `demo-output/` чужой: не читать и не stage.
Новые security-коммиты не отправлялись и не публиковались.

Это **не проверенный релиз**: по порядку владельца общий тестовый этап ещё не
начинался; compiler/typecheck/lint/tests/build/CI не запускались. Coverage остаётся
9/20. Drive rollout выключен, действующая3.3.5/149 и принятая Paddle-витрина
`c29b76e33cc42160616b2df6f5eca61af94f6c63` сохранены. Floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false. Оригинальный prompt по-прежнему имеет SHA256
`5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338`.

Новые документы: `security-336-drive-backups.md`,
`security-336-native-message-key-files.md`, `security-336-content-file-output.md`.
Новые секции общего журнала находятся сверху в implementation-pass.

Точный следующий кодовый остаток:

- Cancelled state4 пока нельзя безопасно передать в новый state3/source history:
  `prepareStagedLocked` и старый source-only reader его намеренно отвергают.
  Нужны полный аутентифицированный граф прежних владельцев/ролей оригиналов и
  планов и их чтение с EOF, включая все scopes. Не исправлять фильтром префиксов,
  ignore-list, удалением оригиналов или трактовкой отсутствующего/corrupt journal
  как «не начинали». UI отмены использует существующий signed cancel и оставляет
  барьер при любой неясности; полноценный restart этим не реализован.
- Полная shared domain/advanced parity, создание новых закрытых spaces/projects,
  membership/inheritance/roles/quotas и multi-owner rotation. Существующий server
  bootstrap требует уже существующий управляемый resource; нельзя вернуть
  plaintext legacy-create как обход после personal cutover. Общие контроллеры
  перехода и межобластная история требуют завершения до активации.
- Client automation/series, bulk/cross-scope transactions, advanced shared input
  attribution, typed normal-repository content restore, revoked-device replacement
  с сохранением originals и remaining reminder/background/deep-link paths.
- Native message attachment pickers/plaintext callbacks и полное durable staging
  черновиков/файлов, exact-command recovery старого shared-message UI. Новый
  NativeUserFileOutput уже даёт bounded cancellable prefix/readback writer, но
  эти пути пока к нему не подключены. Transient key-file handoff не является
  durable draft/file queue.

Известная адаптация тестового API для будущего общего этапа: из
MessagingRepository удалён старый raw `writeBackup`; существующие JVM случаи
MessagingRepositoryTest около190/204/214 ещё ссылаются на него. Перенести их на
фактическую новую handoff-приёмку с сохранением live-entitlement/late callback/
owner/lifecycle assertions. Не выдавать старые PASS за этот код.

После всего кода: общая приёмка и исправления (48 исходных сценариев,14 языков,
web размеры/темы, API26+,3.3.5/149 upgrade/recovery/concurrency/process death),
затем внутреннее крипторевью точного финального кандидата и уже разрешённый
штатный раздельный web/API и подписанный APK выпуск. Внешнее человеческое
заключение больше не требуется; не запрашивать разрешение выпуска повторно.

## Последнее уточнение21 ноября — приоритет над историческими gates

Владелец сообщил, что внешнего заключения нет, и поручил: «сделай ты этот ревью
и перепиши md что ты сам все перепроверишь в конце». Финальное крипторевью
выполняет этот же исполнитель после кода, общей приёмки и исправлений. Отдельный
внешний аудитор больше не является gate этого выпуска; не просить его повторно.
Результат называется внутренним AI review. План: `security-336-final-review.md`.
Все остальные проверки и границы выпуска сохраняются; исходный prompt не менять.

В последнем продолжении созданы локальные WIP-checkpoints ac386416 и6f3d2d2b:
recovery Keystore без замены прежнего контейнера, common shared advanced records,
fingerprint/baseline UI, exact completion review, signed history, реальные
encrypted task files и private queries. Всё ещё НЕ компилировалось/не тестировалось.
Новый uncommitted `app/e2ee/content-archive.ts` начинает local content-only capture
и inert import; полного backup/restore/Drive и native/UI composition пока нет.
Текущий git diff и ведущие разделы implementation-pass имеют приоритет ниже.

## Состояние по прямому указанию владельца

**Актуальное продолжение:** владелец возобновил работу в чате «Продолжить выпуск
3.3.6» и после короткой паузы снова поручил продолжать до выпуска. Полный исходный
промпт остаётся обязательным. Сначала весь новый код инфраструктуры и его реальная
композиция; только затем общий QA, корректировки и последующие release-этапы.
Тесты/сборки/публикации в новом проходе ещё не запускались. Историческая остановка
ниже не является текущим состоянием.

В новом проходе добавлен **непроверенный** код async feature-document driver,
web/native Авроры и immutable paid-result references, web ФЮЗИС, private prefs,
profile metadata cache и renewal enrollment. Добавляется инфраструктура общих
entity transactions/proposals/attestations с signed business intents и pinned
group trust. Новые файлы/миграции128/129 ещё не прошли compilation/QA. Все эти
изменения не повышают accepted coverage9/20. Текущий diff и журнал
`security-336-implementation-pass.md` имеют приоритет над историческим списком
«где остановились» ниже. Чужой `demo-output/` по-прежнему не читать/не stage.

Последнее согласованное правило работы: **сначала завершить весь код, затем
общий прогон проверок, затем исправления и проверка исправлений**. После каждого
helper не запускать полный QA, typecheck, сборку или повторные проверки старых APK.
В этом проходе таких запусков не было. Новые результаты PASS не заявлялись.

## Где работать

- Checkout: `C:/Users/mrdeu/.codex/work/genesis-tasker-20261108/public-candidate`.
- Единственный репозиторий: `nikitalexanderson-byte/Genesis-Tasker`, remote `publish`.
- Рабочая ветка: `codex/security-336`. Не переключать занятую копию.
- Источник требований: `docs/security-336-implementation-prompt.md`.
  SHA256: `5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338`.
- Полный текущий журнал: `docs/security-336-implementation-pass.md`.
- Общий релиз: `docs/release-3.3.6.md`, категории: `docs/e2ee-336-data-paths.md`.
- Старый OneDrive checkout, `calendar-genesis` и архив не использовать для разработки.
- **Не читать, не изменять и не stage `demo-output/`**. Это чужой untracked каталог.
- Не создавать субагентов и не запускать Daybreak в этом продолжении.

## Git и публикация

Последний pushed commit: `e93b23d0f46ebf91a807fb29810ecb3aba4e93d1`.
Локально сохранены WIP-коммиты, которые не проверены и не отправлены:

1. `f80a6eb5` — все source factories, архивы и streamed migration.
2. `ddaa43e3` — foreground vault и personal product repositories.
3. `19a24bab` — явный offline unlock, lifecycle и queue acknowledgements.
4. `cbd1cef9` — web/native diary, device-only drafts, chunked device documents.
5. Следующий локальный WIP-чекпоинт с текстом
   `compose native maps and reviewed conflict intent before consolidated QA`
   сохраняет остальные изменения и этот handoff; точный hash — в `git log`.

Owned manifests лежат в `output/release-3.3.6/runtime/`:
`implementation-pass-owned-paths.txt`, `product-pass-owned-paths.txt`,
`diary-pass-owned-paths.txt`, `maps-feature-pass-owned-paths.txt`.
Коммиты создавались с разовым `-c core.hooksPath=.../product-pass-no-hooks`,
чтобы соблюдать перенос проверок на конец прохода. Глобальные hooks не отключались.
Использовать explicit owned paths, не включать чужие файлы.

**Production остаётся 3.3.5/149. Accepted coverage остаётся 9/20.** Наличие
кандидатного кода источников и новых редакторов не означает приёмку 20/20.

До полной приёмки: `GENESIS_DEPLOY_ANDROID=false`, update floors0,
pilot/cutover выключены. Сохранять package, сертификат и данные. Поддерживаемый
upgrade QA — только **3.3.5 → 3.3.6**; APK раньше3.3.5 владелец исключил,
но schema migrations не удалять. После готовности владелец уже разрешил отдельные
штатные web/API Deploy и публикацию подписанного APK на сайте. Google Play,
личные устройства и треки не менять. Hostinger — только
`/home/u531952483/domains/genesiscalendar.com`.

## Что уже реализовано в кандидатном коде

Подробности прежних проходов есть в implementation-pass. Ключевые точки:

- Явный61-table source catalogue, реальные attachment bytes, fixed server
  allowlist, signed read grants, captured HTTP originals, staged source capture,
  streamed plan adoption/CAS и migration journal protocol5 на обоих клиентах.
- Web/native foreground account capability; Google identity отдельно от vault.
  Независимый secret, recovery-kit enrollment, pin и signed directory, явный
  offline unlock, lifecycle locking. Нет возврата к legacy key после ошибок.
- `personal-product-live-v1` соединяет private workspace/tasks/tombstones;
  native task/project/list/habit/tracker repositories используют новые readers/
  writers. Старые Google projections не исполняются от private task writes.
- Web personal mindmaps и теперь native `NativePrivateMindmaps` работают через
  `personal-mindmaps-live-v1`. Native seed открывает проверенные migrated image
  attachments. Views и новые conversion drafts сохраняются новым локальным root.
  Старые conversion receipts остаются history-only.
- Web/native diary используют `personal-diary-live-v1`. Device-only notes/drafts/
  promotion tickets находятся в отдельном хранилище без network/flush capability.
  Sync off сначала сохраняет локальные копии, затем tombstones активного remote
  содержимого. Включение sync явно сохраняет новые upload IDs до отправки и
  сохраняет источник до подтверждения. Это не обещание физического удаления
  исторического серверного ciphertext.
- Новый локальный device-document формат: manifest, digest,256KiB chunks,
  bounded64MiB, атомарный root/slot CAS. Фиксированные слоты ограничивают рост
  при повторных сохранениях; чтение чужой новой ревизии даёт явный conflict.
- Native diary/dream saved forms ссылаются на new-root draft. Черновики могут
  сохранять ещё пустое тело. Shared14-language notice объясняет отсутствие
  device-only истории на новом устройстве. Повреждение существующей истории
  не трактуется как её отсутствие.
- Read-only private services для dream clock/voice entitlement не принимают
  содержимое, ключи или настройки дневника и не открывают legacy diary endpoint.
- Product reads восстанавливают потерянное подтверждение по точной квитанции,
  не отправляя несохранённую операцию. Неизменившийся acknowledged GET больше
  не добавляет снимок в editor history на каждом poll.
- Последний проход добавляет durable `review` intent в обе editor queues:
  explicit conflict decision сохраняется до cancel/replace сети; старая версия
  и old packet identity сохраняются. Web fork/native adoption сохраняют
  расходящиеся карты как копии. Stale review должен требовать нового решения.
- `app/e2ee/feature-document.ts` сохраняет baseline первой pending правки;
  `app/stoicheion-restoration-storage.ts` подключён к реальному migrated seed.

Весь новый большой проход **не компилировался и не тестировался**. Возможны
TS/Kotlin/JS/PHP ошибки. Предыдущие primitive/custody PASS не относятся к нему.

## Где остановились и что делать после возобновления

Остановились на чтении Aurora workspace/native bridge. Изменений Aurora host,
paid results и native bridge ещё нет. Aurora `validateDocument` — **async**;
generic feature driver пока принимает sync validator. Сначала корректно
адаптировать driver/port и подробную domain validation, не передавать Promise
как документ. Подготовленные результаты сейчас содержат legacy iv/ciphertext;
для active private account нужен настоящий new-root result/reference flow с
сохранением проверок billing/issued-result immutability. Не пропускать оплату
и не открывать legacy result endpoints для обхода cutover.

Остаток реализации до общего QA:

- Aurora, оставшиеся stoicheion draw paths, Physis, advice и private preferences:
  реальные editor/repository entrypoints web/native и полная domain validation.
- Setup/migration/resume UI и фактическая композиция существующих source factories
  с mounted/unmounted editor captures. Все local histories/variants должны быть
  доступны для явного восстановления; не выполнять старые actions/import receipts.
- Shared CRUD, атомарные multi-table операции, approvals/signatures, membership,
  роли и rotation, client automations и quotas. Generic snapshots сами по себе
  не заменяют shared business authorization.
- External-copy consent, content-only import/backup/Drive, independent message
  key lifecycle. Imports не восстанавливают sessions, entitlement, tokens или ACL.
- Native reminders/background/deep links и оставшиеся optimistic UI closures.
  Временный skip retired protected workspace при scheduling — не готовые reminders.
- Expired enrollment challenge renewal и invalidated/revoked native-key recovery
  с original custody. Не заменять старый bundle/root автоматически.
- Проверить coverage per-scope local draft attribution, shared map draft scope,
  historical/nested Physis epoch pins и архивные файлы. Locked epoch сохранять
  явным состоянием, не скрывать.
- Завершить conflict review и его UI для остальных aggregate documents; последние
  review/cancel/replace изменения требуют особенно внимательной проверки
  concurrency, process death и receipt recovery. История настоящих edits всё ещё
  ограничена1024 retained drafts: нужна честная стратегия роста/архивирования.

Затем один согласованный JS/PHP/browser/native/i18n/upgrade/crypto QA, исправления,
проверка исправлений и отдельные разрешённые releases. Наш крипторевью —
**внутренний AI review**, не независимое человеческое заключение.

## Прочие согласованные решения

- Языки: отдельный раздел только `/ru/`, остальные через переключатель/`?lang=`;
  один origin, новые DNS/поддомены не нужны. Android до входа показывает русский
  только при текущем положительном IP-определении РФ; после входа все14 языков.
- Paddle: прозрачный согласованный сценарий, реальные юридические роли,
  действующая ЮKassa. Не скрывать витрину/реквизиты ради модерации; checkout
  не включать без одобрения и технической/платёжной приёмки.
- Дизайн по снимкам и предыдущие изменения сохранять. При итоговом QA нужны
  обе схемы, web360/390/768/1440, Android и смысловая вычитка14 языков.
- Пост для Telegram с картинкой нужен **после настоящего выпуска**3.3.6.
  Отправка в Telegram не поручена.

## Для будущих проверок

Owned AVD: `emulator-5594` / `GenesisSecurity336_API26_AOSP`,
`emulator-5578` / `GenesisSecurity336_API34`. PIN должен оставаться NONE.
QA package: `ru.genesis.calendar.qa1103.debug`. Личные устройства не использовать.
SDK: `C:/Users/mrdeu/AppData/Local/Android/Sdk`.
JDK: `C:/Program Files/Android/Android Studio/jbr`.
Не запускать параллельные Gradle операции.

Для общего PHP/JS QA при возобновлении:

```powershell
$env:GENESIS_QA_PHP='C:/Users/mrdeu/AppData/Local/Temp/genesis-remote-original-php-d346771545be4522b57891c16e4fbb14/php.exe'
$env:OPENSSL_CONF='C:/Users/mrdeu/AppData/Local/Temp/genesis-remote-original-php-d346771545be4522b57891c16e4fbb14/extras/ssl/openssl.cnf'
```

Остановка владельцем не является окончанием релиза или разрешением публикации
непроверенного кандидата.
## Latest continuation checkpoint (21 November, candidate code only)

After c90ef091, web/native membership preparation/coordinators/transports were
added, plus live private Stoicheion and common local Advice selection/products,
technical quota services/migrations130–131, native isolated Advice runtime,
new-root native cache/preference routing and explicit saved-operation retries.
See the new leading section of `security-336-implementation-pass.md`.

No QA/typecheck/lint/build/CI/push/deploy was run in this continuation. Public
metadata pin generation was authoring only. Do NOT increase accepted coverage
from9/20 or claim release readiness. Re-read git status before editing; do not
read/stage `demo-output/`. Do not spawn agents or run Daybreak. The next code
stage is real shared domain CRUD/source-to-index composition, membership/review
UI and policies/quotas/cross-scope operations, then backup/import/Drive,
external-copy consent, message-key lifecycle and native lifecycle/reminders/
invalidated-key recovery. All prior candidate code awaits consolidated QA.

Known implementation areas to revisit during that composition: rotation's
complete active-set verification must account for all locally confirmed newer
heads/chunks, not just the last signed retired manifest; source-to-scope trust
and multi-owner rotations need real UI approval. Advice/Timeline cache and
clock-boundary behavior and translated snapshot parity need consolidated QA.
Content-only backup must never replay these new issue/membership receipts.

# Continuation checkpoint: 22 November 2026

Message-key lifetimes were then strengthened: permanently retired native key
memory/repository publication, pinned owner/session/restore/custody gateway and
local-cell guards, and web operation admission across lock/hide/crypto/network
callbacks. Late same-UID unlocks cannot revive an earlier grant. Existing keys/
wire/history remain; owned crypto buffers are cleared and ambiguous shared-file
commit cleanup preserves ciphertext. New files: MessagingKeyMemory.kt and
app/e2ee/message-lifetime.ts. Native messaging SAF, complete draft/file staging
and exact-command recovery for the legacy shared UI remain unfinished. No QA or
compilation ran; coverage stays9/20. Details are in implementation-pass.

The latest input increment connects embedded native Aurora/Gno to real JS form/
repository capture, a local in-memory bridge mirror and a nonce-bound asynchronous
freeze/read barrier. NativeMigrationMemory supports prepared renderer reads
without holding its monitor across await. Whole-attempt cleanup thaws the view;
the persistent fence still controls writes. Native Aurora HTTP/session/restore
lifetimes are pinned. New file: NativeEmbeddedMigrationCapture.kt. This code is
uncompiled and unaccepted. Shared advanced forms and the other pending categories
remain unfinished; do not raise coverage above9/20.

Native content-backup SAF custody was subsequently rewritten around an exact
job/attempt and scope/generation binding, resumed two-minute picker admission,
five-minute cancellable foreground file access and streamed encrypted readback.
No automatic provider write resumes from disk; explicit unlocked retry rotates
the picker identity. Import/retry/cancel acknowledge the exact saved job, and
background clears UI keys/plaintext. New source files: NativeBackupFileAccess.kt
and PrivateBackupFileActivity.kt. No compilation or QA ran; coverage remains9/20.

Streamed cancellation and pause/drain code now follows the recovery checkpoint.
The two real migration screens can pause and await the prior attempt before retry;
pause preserves pending signed packets and never grants legacy write authority.
Controllers/core retain a state4 cancellation receipt and reverify the directory
before fence release. Remote-cancel UI, archived state4 restart/history and the
unstarted/corrupt-journal distinction remain unfinished. See the leading section
of implementation-pass. This is uncompiled code; accepted coverage remains9/20.

Latest code continuation adds shared request-keyed recovery SAF and device
credential hosts, ten-minute generated-material custody, two-minute system-trip
admission, generation-bound saved receipts and complete file readback. Session/
restore epochs and UI lifetimes are bound; active background IO closes descriptors.
Native unlock pins its HTTP generation and publishes/adopts the account without
tying subsequent use to a disposed UI request. Details and limitations are in the
leading recovery-lifetimes section of `security-336-implementation-pass.md`.
This code is uncompiled and untested; accepted coverage remains9/20. Continue
remaining infrastructure, including streamed cancellation and content-backup SAF,
before consolidated acceptance. No security publication or rollout activation.

Continue code first, then consolidated acceptance/repairs, then release. The new
scope-setup/editor-source/product-controller increment is documented at the top
of `security-336-implementation-pass.md`; it is not compiled or accepted. Actual
setup/resume screens, complete native mounted input, streamed cancellation and
revoked-device replacement still need implementation. The original prompt is
unchanged. Accepted coverage remains 9/20. Do not read/stage `demo-output/`.

## Separate public release and migration UX continuation

The urgent public release is now live: main
`c29b76e33cc42160616b2df6f5eca61af94f6c63`, Source checks44962824697 success,
Deploy44965877713 success. Live acceptance passed98 localized documents, two
legacy Russian links and84 sitemap URLs. API health/privacyModel2, Google
provider and anonymous session passed; APK149 URL/size/ETag and the complete
Android update manifest are unchanged. Live public EN desktop and RU mobile
screenshots were saved; temporary browser overrides were reset and the owned
local QA server stopped. Personal Google sign-in, real payments and private
security code were not tested in this website-only acceptance. Paddle checkout
was not activated. The new accepted storefront must remain in later3.3.6 work.

The urgent website-only changes are in `paddle-web-20261122`, PR42, head
`503267a7f171e1038f82d636037698029803334c`. They must publish first and contain
no new E2EE/security source. Preserve their accepted public storefront and `/ru/`
when later integrating main into this security branch. Website CI (including
its unchanged native debug check) is not acceptance of this security candidate.

The accepted public source from main `c29b76e33cc42160616b2df6f5eca61af94f6c63`
has since been merged locally into this branch. Public routes/copy/footer are
preserved, alongside the private security/recovery/runtime code. This combined
branch is still uncompiled, untested and unpushed; do not publish it with the
urgent website-only release.

The current local UX code adds the shared14-language setup/resume gate and real
static `web/main.tsx` composition, with owner-bound vault suppression and product
remount after verified cutover. Native system-credential return uses one-shot,
owner/view/attempt-bound, memory-only recovery material with an elapsed-time
validity limit, foreground guards, cancellation and disposal. See the leading
section of `security-336-implementation-pass.md` for guarantees and limitations.

This increment remains uncompiled and untested. Do not increase9/20 acceptance
or activate pilot/floors/cutover. Remaining code includes full native captures,
SAF generation/lifecycle custody, streamed cancellation, revoked-device recovery,
shared domain composition/authorization and the other pending items above.

### Native input continuation while public CI runs

Added dream journal/editor and all sleep/mood/abstinence forms to native
in-memory capture. Preserve raw input, original typed records/revisions and UI
state as inert personal.local-work history. Mounted loading/saving/voice,
spelling and slider activity must settle; detached originals do not execute.
Owner comes from the authenticated UID plus an exact hashed-scope match, and
sleep/mood repository/form state is keyed to that account lifetime.

Code review/diff hygiene only; no private security tests/builds/CI ran. Coverage
remains9/20. Consolidated acceptance needs account switches/disposal, raw invalid
input, pending voice/spelling, save/loading races, slider interruption and
SOURCE_NOT_SETTLED retry/cancel UX. Embedded Aurora/Gno/shared advanced forms,
SAF custody and streamed cancellation remain unfinished.

Stoicheion restoration journey/cycle inputs are now registered too: raw
intention/action/reflection, choices, source cards/seed and original habit
workspace are preserved as history. Owner binding follows the actual habit
repository scope, with account-keyed repository lifetime. No private tests or
compilation ran for this continuation; accepted coverage is still9/20.

