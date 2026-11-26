# Потоковая миграция: подготовка и владение исходниками

21 ноября 2026. Отдельная компонентная приёмка завершена;
не является полной state4 migration, новым source adapter или выпуском.
Coverage остаётся 9/20. Production 3.3.5/149, floors0, pilot/cutover off.

`prepareStreamedPlanning` требует настоящее разблокированное устройство:
`UnlockedWebDevice` / `UnlockedE2eeDevice`, его vault и owner из проверенного
directory. Проверяются долговечность ключей, полный реестр, исходные source
bytes/EOF, прежняя история и неизменность metadata. В одной транзакции сохраняются
точные raw state3 bytes, state4 ownership и CAS каталога источников. Только
после этого разрешены source discovery и подписанный migration-start.

State4 хранит attempt ID, исходный serial/hash, проверенный public signer и
security epoch. Существующий state3 reader не ослаблен: он по-прежнему
отвергает подставленный lease/plan/receipt. Для холодного повторного чтения
только корневой metadata ID отображается на точную сохранённую state3 запись;
перед каждым открытием сверяются реальные state4 serial/hash, saved-copy
serial/hash, scope, actor, source refs, ancestors и directory checkpoint.
Original/history/plan discovery передаются без фильтрации префиксов.

`reserveStreamedRemoteOriginal` аутентифицирует подпись запроса ключом
из проверенного roster и связывает actor/target/migration/source/fence/generation/
directory/security epoch. До `observation.prepare` сохраняются полная подпись
и inert registration. Предыдущие отсутствующие, частичные и завершённые
резервации не теряются. Неизвестная capture требует явного разбора; metadata
descriptor никогда не считается доказательством response body или EOF.

Сохранённые pending/resuming packets повторяются точно. Transport получает
отдельный snapshot. Guard проверяется и после сетевого ожидания, до применения
receipt и записи; ответ на устаревшую операцию не продвигает её состояние.
Холодное продолжение повторяет исходный подписанный запрос. Source-changed
не заменяется новым hash и не стирает сохранённые оригиналы.

`run`, aggregate planning, upload, adoption контентного плана, cancel/restart
и activation для state4 остаются закрыты. Этот компонент нельзя использовать
как готовый product route в обход обязательного preflight всех настоящих
reconcilers, общей admission, capture factories и recovery/custody.

Проверки текущего инкремента:

- web: provisioned device, исходный state3, потерянные acknowledgements,
  committed process interruption, quotas, ключи, чужие signer/bindings,
  partial originals, retirement до/после сети и immutable transport packet;
- общий публичный synthetic vector: canonical bytes/hash и подпись одинаковы
  в JS/JCA; структура сама по себе не является проверкой signer;
- native: предусмотрены JVM validator cases и actual Keystore/SQLite холодные
  journeys на owned API26/API34;
- browser: отдельный loopback harness с actual IndexedDB/provisioned device,
  крупным источником, signed synthetic HTTP lease и реальными lost-ack retries.

Полный JS: 2015/2015, 0 failure/skip. Chromium157 с настоящими WebCrypto,
IndexedDB, persisted device unlock и loopback fetch:15/15, console0. Браузерный
lease-сервер синтетический; это не production HTTP/backend-приёмка.
Scoped ESLint и owned TSC прошли. `build:web` прошёл:98 HTML/14 языков,
280 иллюстраций галереи, исходные disclosures и offline precache сохранены.

Native build прошёл за12м38с. Полный JVM:1394 PASS,0 failure,8 существующих
opt-in HTTP skips (не отмечены как PASS); новые5 ownership cases прошли.
API26/API34: каждый15/15 (8 новых planning,6 remote-original,1 directory/key
audit),0 failure/skip. Только отдельный QA package; temporary credentials двух
owned AVD возвращены в NONE. Это холодное переоткрытие persisted device/SQLite
и моделирование потери acknowledgement, не настоящий OS process kill, полный
account recovery, physical/OEM или real server acceptance.

Frozen native input:
`461430165B3B9DD529CFF427B5E90846AF2CBB19E6DDFE395B0250FB68B5CAFE`.
Main APK:
`B766BFC1B89719BCDEFF31DE83F878E0C9789389D4DA1D2C83C29A29C6178BA3`.
Test APK:
`63CD78072B53F4370ABADD952E20FB17EAAE27B0DA39E2F300574191F4EEF68B`.
Lint12м20с:0 errors/208 warnings/8 hints, XML побайтно равен предыдущему
registration baseline; новых issue/file pairs и увеличений counts нет.
После device/lint/web-build source и APK identities сверены повторно.
Исходный security prompt неизменён.

Итог: `runtime/streamed-ownership-final-identity-01.json`, отдельные full-JS,
types/lint, native build/unit/identity/lint-delta, browser02 JSON/console,
web-build logs и `output/qa/security336-streamed-ownership-api{26,34}-01/`.
Черновые failures сохранены: web01/02 исправлялись до этого инкремента;
web04 ожидал mutable packet, тогда как переданный snapshot уже read-only,
исправлена проверка ожидаемого TypeError. Types05 нашёл только тип domain list
нового browser harness; types06 прошёл после явного выбора поддерживаемых
domains. Browser01 — неверный синтаксис CLI-команды чтения результата;
сам harness завершился PASS, результат сохранён через eval в02.

Остаток интеграции: обязательные HTTP capture factories, provider-wide admission,
полный mixed history/custody и recovery, content-plan publication/state4 run,
11 реальных categories, normal writers/unlock, ACL+rotation, files/Drive и
системная/языковая приёмка. По последнему решению владельца upgrade matrix
начинается с 3.3.5/149; APK более ранних версий не проверяются.
