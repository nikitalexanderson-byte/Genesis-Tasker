# Архивы: локальный web capture и owner exclusion обычного native резервирования

19 ноября2026. Это следующий инкремент `personal.archives`, **не десятый готовый
source adapter**. Native archive inventory/fragment collector, strict nested
reconciliation и полный content-only restore ещё нужны. Pilot/cutover/floors и
production остаются выключенными/прежними.

## Web source input

Read-only inventory собирает точные owner-scoped safety/held/history/generation/
old-device-key entries, включая отсутствие обязательного key и неизвестные
исторические форматы. Сначала сохраняются оригинальные строки: malformed JSON
и duplicate names нельзя отбросить обычным JSON.parse до protected capture.
Memory-only safety после quota failure также входит в snapshot.

Actual BackupPanel регистрирует committed состояние, selected File, key input,
decoded payload, selection/mode, conflict choices, preview plan/stage и точный
uncertain operationId. Навигация сохраняет detached copies в памяти этой сессии;
logout очищает registry и memorySafety. Нового plaintext disk cache нет. До
сохранения protected source неизвестный parser/recovery/UI prompt не вызывается.

Чтение selected File локальное; сохраняются все байты, имя/type/size/lastModified.
До24MiB файл,48MiB capture и1000 forms; недоступное/большое/изменившееся состояние
явно отказывает. При await проверяются session identity/revision, account guard,
начатые операции и прежние File/state/storage/memory references. Owned byte buffer
очищается и на ошибках. Double click не запускает вторую операцию до React commit.
Capture не может пройти между завершением async action и commit нового UI result.
Detached uncertain form сохраняется явно unsettled для будущего обязательного review.

Key input и прежняя device key запись находятся **только в source input**. Полный
coordinator обязан зашифровать его новым device root ДО private source IO. Этот
primitive не возвращает executable/import/activation authority и не разрешает
помещать key input в будущие remote/local output objects. Future reconciliation
должен открыть поддерживаемые nested formats, сохранить все варианты и убрать
старые ключи из output. Locked/corrupt/future не становятся empty/complete.

## Проверено

- Capture/backup regression24/24; full JS1719/1719 после regenerated signed fixture.
  `output/release-3.3.6/runtime/archives-local-capture-js-01.log` и
  `archives-local-capture-full-js-02.log`.
- Types01/02 PASS; scoped lint01 PASS. Broad app/public/tests/scripts lint03:
  0 errors/4 прежних img warnings; root lint/demo-output не запускались.
- Static web build02 PASS:98 public HTML/14 languages, exact dictionaries,
  280 gallery images и offline precache. Это не новая semantic приёмка всего UI.
- Actual Chromium157/React/WebCrypto/IndexedDB/File:14/14 assertions PASS,
  console errors/warnings0. Выбран файл, выполнены check/decrypt и preview, форма
  unmounted, затем snapshot записан в реальный encrypted device vault. Fixture
  удалила прежние источники; cold unlock вернул точные import/preview/history и
  memory-only safety. Restore/download не выполнялись. CSP connect-src none.

Browser evidence: `output/playwright/security336-archives-capture/results-01.json`,
`before-detach.png`, `after-cold-unlock.png`. Bundle SHA256:
`fb9f8fa801df26930e12148baa99d2f2bb941bcf1d6e381e78f555064e86c9d2`.
Browser/server являются собственными loopback fixtures с синтетическими данными.
Полные protected source coordinator/archives reconciliation, native selected-file
capture и product lifecycle этим локальным прогоном не подтверждены.

## Native normal operations: проверенное exclusion отдельных операций

BackupNativeStore удерживает owner permit через local capture, crypto, вложенные
HTTP, generation receipts и safety writes. BackupSafetyStore захватывает текущую
Room/DataStore state и выполняет protect/reset/accept под тем же permit. Nested
protect/recovery не запрашивает новый mutex за ожидающей migration. Submitted
JSON фиксируется до await; reset не принимает generation до durable safety и
сверки pending preferences. Gateway фиксирует session generation и account epoch,
в том числе при выходе и повторном входе в тот же UID.

Explicit reset намеренно переживает собственный quiesce/retirement transport,
но сохраняет прежнюю account activation binding. Incoming bootstrap передаёт
собственную verified owner guard, а не текущий UI scope как authority.

Это exclusion отдельных native operations. Полный многовызовный Backup WebView
job и его mounted/detached source capture требуют дальнейшей интеграции; наличие
этой защиты не увеличивает source coverage9/20.

Native build01 SUCCESS22m2s: full JVM1209 total/1201 passed/8 прежних opt-in HTTP
skipped/0 failed. После финальной проверки oversize seal и исправления двух test
fixtures выполнен build02 SUCCESS20m41s: focused backup JVM21/21 и lint0 errors/
206 прежних warnings/8 hints. Это не повтор всех1209 JVM после последних правок.
Первые instrumentation отказы были ошибками fixtures: JUnit method вернул Boolean
вместо void, SAF guard ссылался на прежний QA package. Исправлены explicit Unit
и exact `BuildConfig.DEBUG && packageName == ru.genesis.calendar.qa1103.debug`;
production scope и криптография не ослаблены.

Actual API34:10/10 PASS, failures/skips0. Шесть новых owner-fence cases проверяют
ожидание принятого HTTP/receipt, frozen submitted JSON, отсутствие nested deadlock,
preparing/active запрет всех backup entrypoints без IO/prune/reset, смену аккаунта
с повторным входом в тот же UID и oversize refusal до old-key IO. Дополнительно
прошли2 reconciliation cases,1 SAF и1 actual journal-choice flow.
`output/qa/security336-archives-operations-api34-02/results.json`.

Final input hash:
`FA9A83D977FCC93A621982BF76726B3B550ECA50C794A03BADF9C5420AFE682B`.
Main APK SHA256:
`09AAF288C8611C17F4C09A78FC5B64B1549594FC53E8C43183486C227DBA0A40`;
test APK:
`19F59FD9B23B27F9354B69B3AC2AB09AB71EE9190382231DF884A0A1DADED5EF`.
Identity/JVM/lint: `runtime/archives-local-capture-native-identity-02.json`,
`...native-jvm-01.json`, `...native-jvm-02.json`, `...native-lint-02.xml`
под `output/release-3.3.6/`. Native selected-file/forms capture, full archive
reconciliation/recovery и общий product acceptance остаются незавершёнными.
Личные устройства, Play и production не затронуты.
