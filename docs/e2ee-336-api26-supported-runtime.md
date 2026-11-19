# Совместимый WebView на отдельном QA Android8/API26

19 ноября2026. Это собственный disposable AVD, не обновление личного устройства
и не поставляемый пользователю WebView. Minimum Chromium111 в product guard и
packaged build target сохранён. Старый Google API26 AVD с provider69 по-прежнему
имеет только GuardOnly acceptance; его прежние результаты не переименовываются.

## Проверенное происхождение среды

AVD `GenesisSecurity336_API26_AOSP`, serial `emulator-5594`, использует официальный
SDK image `system-images;android-26;default;x86_64`, revision1. Изменяется только
его отдельная writable system copy; оригинальный SDK image не редактируется.

AOSP WebView113.0.5672.136/minSdk24/x86_64+x86 получен из pinned official source:
https://android.googlesource.com/platform/external/chromium-webview/+/b44f390d379bc993866c918ecc7697e364632d2e/prebuilt/x86_64/webview.apk?format=TEXT

Original blob SHA1 `6d34d2b2fdf13664caa6a6519695455e96704041`, APK SHA256
`8e8b2eed6c71f9f4def2395f92683dce42071109795e5b4cad3d82a0fa367f48`.
Его original signing certificate отличается от stock API26 provider. Только
для этого собственного AOSP AVD APK переподписан публичной AOSP development
testkey из official `platform/build/android-8.0.0_r1/target/product/security/`.
Это не release key GENESIS. Cert SHA256
`a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc`.
QA APK SHA256
`affea26eeeb595348b456e363f9cca8e3f22954046274bc3985ed280d4755777`.
Все2090 runtime/resource ZIP entries byte-identical official APK; отличаются
только signature/META-INF entries и signing block.

Default SDK AOSP26 image имеет пустой WebView provider list. Собственный static
RRO `org.genesis.qa.webviewoverlay`, hasCode=false, содержит единственный resource
config с `com.android.webview`, availableByDefault=true/isFallback=false. Он лежит
в собственном AVD `/system/vendor/overlay/GenesisQaWebViewOverlay.apk` и подписан
той же публичной development testkey. Overlay SHA256
`f0b0646abd1790b82005460a2f27a3a6aa23e4a8ea4f0aaafca5d6a6abe18933`.
SELinux не выключен; только созданным QA directory/file присвоен system_file
context для early idmap. Ни source reconciliation, ни product runtime guard
этот resource overlay не меняет.

Dynamic overlay не успел изменить early provider list; первый static variant
ошибочно объявлял единственный default provider fallback и вызвал system-server
refusal. Исправлен только QA config, failure log сохранён. После reboot реальный
`dumpsys webviewupdate` подтверждает current/preferred113.0.5672.136, valid package,
installed/enabled for all users,2/2 finished relros. Это подтверждает готовность
runtime; каждый product source всё равно проходит собственный version guard.

Evidence под `output/release-3.3.6/runtime/`:
`api26-aosp-supported-provider-03.json`, `...supported-webview-03.txt`,
`...static-overlay-03.txt`, `api26-aosp-runtime-identity-01.json`,
`api26-aosp-system-overlay-attempt-02-crash.txt`.

## Приёмка source

Runner допускает только exact task-owned AVD name/API26/current selected provider
не ниже actual contract minimum. Первая попытка остановилась до device cases:
default local PHP directory оказался неполным. Для повторения распакован pinned
официальный PHP8.4.27 из `windows.php.net/downloads/releases/archives/` с тем же
SHA256 `dbae154a0a89791f36c3d48e68bae797878333e7d6cb5721e74617de59b63ab7`;
используется явный GENESIS_QA_PHP только в этом QA process. Runtime/ключи/APK
в ignored output; они не являются новыми product dependencies.

Повтор `security336-reminders-source-api26-supported-02`:22/22 PASS,
failures/skips0,15 instrumentation groups. Восемь reminders source/guard/bootstrap
cases прошли actual packaged JS, включая history>16MiB/stream/backpressure,
strict duplicate parser, old-grant inertness, new-root readback и account changes.
Дополнительно прошли1 Physis source regression с потерей старого Keystore,
11 importer и2 task reminder cases. Main/test APK и input hash совпадают с
проверенным archives operation build02; source inputs во время прогона не менялись.

Точный parsed report:
`output/qa/security336-reminders-source-api26-supported-02/results.json`.
Это acceptance выбранных синтетических источников в instrumented QA package,
не full authenticated product/всех9 sources, не максимальная совокупность данных,
не проверка любого OEM WebView и не выпуск. Stock provider69 negative/fallback
evidence сохраняется отдельно. Enrollment/normal E2EE/recovery/прямые signed
upgrades/остальные категории/48 сценариев/14 языков/independent crypto review
остаются обязательными.

Дополнение: backup whole-job/operations/reset и actual SAF/journal flows также
приняты на этом provider:16 cases, см. `e2ee-336-archives-native-jobs.md`. Initial
два UI cases заблокировало собственное system error window stock statementservice:
его receiver нарушает Android8 background-start policy после APK installation.
Crash log/screenshot сохранены; закрыто только наблюдаемое окно, без изменения
verifier/permissions/AppOps. Это не приёмка системного deep-link verification.
Optional maintenance flag строго проверяет exact own AVD ДО install/reset.
