# Native Advice: текущая реализация и обязательные остатки

19 ноября2026. Реальный source adapter, не завершённая product activation.
Web source и оба signed ports — `e2ee-336-advice-web-source.md`. Реальные source
категории теперь4/20: workspace, Aurora, Stoicheion, Advice. Для всех остаются
product lifecycle/editor routing и полная приёмка. Production3.3.5/149,
floors0, cutover off, Android deploy false.

## Реализовано и проверено

- `E2eeNativeAdviceSource`: owner-scoped encrypted Room originals/plaintext,
  generation/pending state, mounted state и только воспроизводимые v1 lookups.
  Из current settings и v2 profile descriptors строятся точные SHA-256 tuples
  owner/language/raw-preferences. Неизвестные keys не присваиваются владельцу,
  не копируются в его root и блокируют reconciliation до private source IO.
- Native capture сохраняет raw original strings/ciphertexts до IO. Shared
  `advice-native-source.ts` нормализует actual v2 profiles/history, v1 responses,
  AdviceSnapshotStore cards/index/targets/delivered. Private metadata переносится
  отдельным encrypted object, rendered responses — через общий Advice validator.
  Live quota не переносится. Orphan index разрешён только при наличии точной
  карточки в signed legacy history; missing data блокирует completion.
- Shared headless entry использует `PublicAdviceCatalogues` с bounded public
  byte RPC. Native public provider разрешает только paths из APK edition pins,
  проверяет SHA/размер, не использует account client/cookies/device IDs.
  WebView остаётся network/storage/file-disabled, keys не получает. Callback
  произвольного HTTP отсутствует; Advice запрещает legacy-key `open` RPC.

Public native provider4/4 JVM +migration8/8 PASS:
`runtime/native-advice-public-reader-jvm-01.log`. Все actual edition bytes,
cookie-context denial/headers/redirect/size/integrity проверяются отдельно.
Shared native-entry/normalizer14/14 Node PASS:
`runtime/frontend-native-advice-normalized-runtime-03.log`. Итоговые full JS
1490/1490, typecheck, scoped lint (0 errors/4 existing img warnings) и web build
PASS: `runtime/frontend-native-advice-{source-full-06,typecheck-05,lint-06,build-04}.log`.
После timezone исправления итоговый full JS1492/1492, typecheck, web build PASS;
focused lint0 errors: `runtime/frontend-advice-timezone-{final-full-07,typecheck-06,build-05,lint-07}.log`.

Первая native source JVM сборка02 остановилась на ошибочном обращении к
ServerIdentity.advicePreferences. Правильное поле — accountSettings;
исправлено. Итоговый build03 PASS за9m33s: main/test QA APK и17/17 JVM
(source5, public provider4, migration8),0 failures/errors/skips.
`runtime/native-advice-source-build-03.log`. Все7 новых instrumentation cases
скомпилированы; static javap проверка нашла Boolean-return у overlap test,
исправлено на Unit до запуска JUnit. Test APK пересобран; lint04 PASS за12m05s,
0 errors/206 existing warnings/8 hints. Финальный06 main/test APK +lint PASS
за1m53s, новых lint errors нет: `native-advice-timezone-final-build-lint-06.log`.
Синтетические
tests не меняют metadata149/package/debug signing и не выполняются на личных
устройствах.

Actual Room +Keystore +packaged source runtime/new-root vault:

- API34 (до timezone-only исправления):7/7 новых Advice cases,23/23 предыдущих cache/gate/workspace/Aurora/
  Stoicheion cases и4/4 UI cases (Aurora3 +SAF archive1) PASS. Логи:
  `native-advice-source-api34-01.log`, `native-advice-source-regression-api34-01.log`,
  `native-advice-source-ui-regression-api34-01.log` в `runtime/`.
- Advice переносит current/history cache, точные known v1 bytes, snapshots,
  targets/delivered и mounted card. Проверены6 новых objects и15 public-byte RPC,
  неизменность всех исходных ciphertexts и чтение нового vault после удаления
  только fixture old alias. Persistent denial блокирует7 прямых store operations
  и scheduler fallback до key access. Late commit завершается до preparing;
  nested permit не ждёт за своим migration. A→B→A не оживляет старую операцию.
- API26/Chromium69:22/22 storage/fence cases, public timezone agreement1/1 и
  старый-provider UI1/1 PASS. Последний содержит84 состояния (14 языков ×2 схемы
  ×3 модуля), font1.3, zero IO и неизменный opaque source. Снимки:
  `runtime/advice-api26-runtime-screens/`, визуально просмотрены RU dark Aurora
  и EN light Backup. Это **не** успешная Advice migration на старом WebView:
  совместимый runtime требуется до его запуска. Логи: `native-advice-source-storage-api26-01.log`,
  `native-advice-runtime-fallback-api26-01.log`, `native-advice-timezone-api26-01.log`.
- API35/Chromium124: итоговые31/31 PASS (те же30 source/storage cases +public
  native Java/WebView winter/summer timezone agreement). Лог:
  `runtime/native-advice-source-api35-final-02.log`.

Положительный instrumentation source использует actual producers/Room/Keystore/
packaged engine/vault, но synthetic signed reply и small14-language catalogue
byte port. Он передаёт только fixture-owned v1 inventory, не доказывает полную
авторизованную AuthController factory/default global inventory acceptance.

## Найденный и исправленный runtime defect

Первый API35 прогон дал8 failures/30: общий module import падал с
INVALID_CALENDAR_TIME_ZONE до появления source bridge. Отдельный actual WebView
probe подтвердил Java GMT, WebView124 default `+00:00`, explicit UTC — UTC.
`calendar-context.ts` теперь канонизирует именно этот однозначный zero offset
и прежний GMT в UTC. Device timezone не меняется; MSK/nonzero shorthand и
malformed zones по-прежнему отклоняются. JS regression проверяет winter/summer
civil dates и observed default без подмены device setting. API35 повторён
полностью, все31 cases PASS. Первый failed log сохранён:
`native-advice-source-api35-01.log`; probe/environment —
`native-advice-timezone-api35-{01,environment-01}.log` в `runtime/`.

## Обязательно до включения

1. Native API26 с совместимым provider, actual WebView113 для нового Advice source,
   signed direct upgrade и clean-client recovery ещё не подтверждены. Успешный
   Chromium124/157 source test не заменяет эти состояния.
2. Whole-operation fences охватывают preferences, gateway, notification profile,
   background delivery и всех public read/write AdviceSnapshotStore. Offline
   fallback находится внутри того же owner permit; preparing/active denial не
   превращается в network failure. Смена owner даже A→B→A инвалидирует старую
   операцию и DailyAdviceCache через process-local epoch. Actual overlap/denial
   tests PASS, но полный product bootstrap/unlock/background lifecycle ещё нужен.
3. Owner permit теперь берётся до controller/scheduler locks, preference mutex
   освобождается до Scheduler.restore; вложенный HTTP/cache заимствует permit.
   У scheduler разные scheduleMutex и deliveryMutex: это не доказательство
   прежнего deadlock на одном mutex. Новый порядок предупреждает инверсию при
   добавлении общей owner serialization. Actual overlap test PASS на API26/34/35.
4. `CachedAccountEntry` (`account-entry` Room doc) содержит ещё одну private prefs
   copy вместе с identity/feature metadata. Personal local-work source обязан
   сохранить private часть без импорта identity/billing/ACL authority.
5. Unknown v1 hashes могут относиться к другой настройке/старому writer format
   либо другому account. Нельзя объявить их пустыми или обойти provenance ради
   успешной миграции. Нужен безопасный review/retention/recovery сценарий.
6. Native source/return16MiB и общий coordinator128MiB имеют разные пределы.
   Проверить большие истории и явное сохранение источников при отказе; не
   обходить лимит урезанием copies/переводов. Дальше при необходимости streaming.
7. Default HTTPS public reader ещё не проверен с опубликованными новыми assets.
   Provider JVM использует fake HTTPS connection; реальный Chromium HTTP проверен
   отдельно. Не выдавать это за native live TLS/E2E или independent crypto review.

Продуктовый bootstrap/unlock/complete-registry/editor routing, все остальные
категории, portable archives/Drive, backup schedule/restore drill,48 сценариев,
14-language security UI и независимый crypto review остаются обязательными.
