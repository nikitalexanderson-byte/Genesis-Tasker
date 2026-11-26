# Awaited planning session и обязательный capture

21 ноября 2026. Web и native capture/session прошли отдельную компонентную
приёмку. Coverage9/20, production3.3.5/149 и release gates сохраняются.

`withStreamedPlanning` держит предоставленный product fence один раз за весь
job; Android дополнительно использует существующий coordinator Mutex. Вложенные
callbacks работают через private locked core. Публичные prepare/reserve методы
изнутри этого fence не вызываются. Продукт ещё должен объединить этот fence
со всеми mounted editors/local writers и полным реестром настоящих источников.

Legacy reads всех10 actions и page/fragment вариантов получают session port.
Веб `authenticatedMigrationTransport` передаёт настоящий HTTP observation в
`e2eeRequest` и объединяет внешний/session AbortSignal. Product capture требует
реальные IndexedDB record/device-key providers. В Android `AuthController`
передаёт observation в существующий `AuthSessionClient.e2ee`; concrete session
требует `UnlockedE2eeDevice`. Scope/directory/account generation guards остаются
на существующем authenticated пути. Без session legacy transport отказывает до
HTTP; bounded ciphertext readback сохраняет свой отдельный контракт.

Для каждого legacy read:

1. Под текущим source/lease/directory guard строится точный signed packet.
2. Registration и packet резервируются CAS до observation.prepare/HTTP.
3. Настоящий HTTP-клиент сохраняет исходные entity bytes до UTF8/JSON обработки.
4. Complete original повторно проходит полный authenticated body EOF/hash.
5. Exact completion reference закрепляется в ownership CAS и читается обратно.
6. Производный ответ выдаётся после этого binding. При ошибке HTTP/JSON полный
   оригинал тоже закрепляется; сам отказ сохраняется как результат операции.

Local ownership wire2 явно хранит `completion:null` либо exact
`id/manifestHash/rawHash/size`; wire1 остаётся строгим прежним reader. Metadata
reference требует отдельной проверки body. Complete оригинал с потерянным
подтверждением binding проверяется целиком при cold reopen, затем закрепляется
CAS; missing/partial registration сохраняется unbound. Исходные ciphertext rows
не переписываются ради восстановления binding.

Private current-state cell меняется только после точного собственного CAS и
readback serial/hash. Raw state3 reference/hash сохраняют независимый pin.
После собственной reservation следующий запрос использует новый cell, а чужая
замена активного состояния отказывает. Checked history живёт в одном fence;
между страницами проверяется metadata/catalogue, полные original EOF проверяются
на границах job. Старый source-only reader продолжает отказывать на неизвестных
roles/content-plan journals; prefix ignore-list не добавлен.

Сессия отзывает escaped ports, запоминает caught failures и дожидается всех
pending HTTP/crypto children перед освобождением exclusion. Native использует
собственный дочерний coroutine scope и cancellation guards в provider writes.
Результат session — immutable technical references. State4 по-прежнему имеет
phase preparing/planned false; content-plan adoption/run/upload/activation
требуют следующей отдельной композиции.

## Проверка отказов внутри request port

Внутренний review нашёл промежуточную ошибку: directory header check и public
page preflight выполнялись снаружи tracked operation. Если consumer перехватывал
их отказ, session могла вернуть success. Сохранены два JS RED (`Missing expected
rejection`). Оба validation этапа перенесены внутрь tracked port. Теперь такие
caught failures блокируют session; полный отказавший HTTP original сохраняется,
а invalid page не создаёт запроса/original. Native получает тот же checked port.

Web приёмка текущего кода:

- Full JS2058/2058,0 failure/skip; owned TSC04/scoped ESLint04 PASS.
- Chromium15715/15 через actual authenticated browser client и IndexedDB.
  Все10 actions/11 request forms зарезервированы и prepared до fetch; host SHA256
  проверяет полные raw bytes, включая generated2MiB response, BOM и whitespace.
- Проверены cold actual device unlock без перезаписи ciphertext, revoked port,
  отсутствие legacy HTTP без session, полные retained HTTP409/JSON refusals и
  caught directory/page failures. Immutable receipt проверяется отдельно.
- Console: один ожидаемый resource409 тестового HTTP-error сценария,0 warnings;
  это не console0. Все account/source/lease/server данные synthetic loopback.
- Node coordinator/model и coroutine/native tests имеют отдельный scope; число
  таких тестов не означает настоящие20 source categories или product recovery.

Evidence: `runtime/session-integration-js-full-02.log`,
`session-integration-browser-green-03.json`, `session-integration-types-04.log`,
`session-integration-eslint-04.log`, `session-integration-validation-{red,green}-01.log`.
После чистки только смешанных line endings/лишних EOF lines full JS снова
2058/2058 (`session-shared-js-full-03.log`), owned TSC05/scoped ESLint05 PASS.
Current `build:web`02 PASS:98 HTML/14 языков,280 gallery images, disclosures,
13 точных UI dictionaries и offline precache сохранены. Новый UI copy не добавлен;
эта сборка не заменяет полную14-language semantic/visual приёмку релиза.
Первый native build остановлен до исправления validation; его APK/JVM/lint
не принимаются. Build02/input03 завершился с тремя ошибками новых JVM tests:
`Deferred.await` добавляет stack-trace recovery copy исключения. Тесты требовали
тождество верхнего объекта. Исправление допускает только исходный объект либо
копию того же класса/сообщения с ТОЧНО исходным объектом в cause; сравнения
одних сообщений недостаточно. Сам код session ради этой проверки не менялся.
Failed unit XML/summary сохранены в `session-integration-native-{session,unit}-red-02`.

Принятый native input04:
`EDD7D47CFEA407BC943B8946E7320F61B23E32DF4DF108DAB888C0589641B3C2`.
Build03 SUCCESS4m34s; полный JVM1407 PASS,0 failure,8 прежних opt-in HTTP skips
(1415 total/246 suites; итоговый unit status BLOCKED, не1415 PASS).
Main QA APK:
`A07D22426EC4119C1CE5F986CA0C34B79DDCA3C41B55AD0D23B6325F8CCD987F`.
Test QA APK:
`788BB61DE18616920309923DCF195F4ED109150F6B8D03269DD4FB749100965D`.

API26/API34 каждый32/32 PASS,0 failure/skip: provider8, planning13,
raw originals8, key audit1 и два scoped-retirement regressions. Новые planning
cases используют actual provisioned Keystore device, SQLite и `AuthSessionClient`,
но synthetic `HttpsURLConnection`: это не real TLS/backend/OAuth UI journey.
Проверены durable ownership всех10 actions/11 forms, ошибки HTTP/JSON, lost CAS
с cold repair, изменение completion metadata и caught validation failures.
Устройство открывается повторно в том же процессе; actual OS process kill этим
набором не проверялся. Main/test/source hashes сверены runner до и после IO.

Оба свежих runner-bound metadata artifacts прочитаны Node WebCrypto: canonical
wire2 hash, все11 signatures и independently generated bounded raw-byte hashes
совпали. Это interop synthetic metadata/bytes, не полноценное product recovery.
Временные PIN двух owned AVD возвращены в NONE. API26 использует наблюдаемый
Confirm Device Credential UI; API34 — system locksettings verify, не приёмка
продуктового credential dialog. Личные устройства не использовались.

Full native lint03 SUCCESS14m23s:0 errors/208 warnings/8 hints. По сравнению
с принятым provider-current02 нет новых issue/file pairs и увеличения counts.
Evidence: `runtime/session-integration-native-{input-04,built-03,unit-03}.json`,
`session-integration-native-lint-{03.log,03.xml,delta-03.json}`,
`session-integration-native-host-api{26,34}-01.json` и
`output/qa/security336-session-integration-api{26,34}-01/results.json`.

После указанной чистки native input05:
`9C754E8225082F936E16AA5500DCE608127A80CEB2BD602C4B0E6E5E78B4151C`.
Fresh Gradle refresh04 SUCCESS23s: оба APK ПОБАЙТНО идентичны принятому input04,
lint XML также идентичен. JVM/native cases повторно не объявляются новыми runs:
provider evidence input04 относится к тем же точным APK через этот проверенный
binding. `runtime/session-integration-native-refresh-04.json` сохраняет обе
identities; `session-integration-final-identity-01.json` — итоговый checkpoint.

Оставшаяся интеграция: mixed-provenance state4 content-plan/common reader,
authenticated original key custody/new-device recovery, bounded WebView inputs
и nested old key/AAD opening,11 реальных categories, обычные writers/recovery,
atomic shared ACL+rotation, files/Drive и полная приёмка3.3.5→3.3.6/14 языков.
