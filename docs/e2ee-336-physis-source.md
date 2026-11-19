# ФЮЗИС: полный источник для миграции 3.3.6

Реализация и приёмка источника 19 ноября. Адаптер остаётся вне активной legacy
синхронизации: наличие исходников не включает enrollment, pilot или cutover.
Все update floors остаются 0, `GENESIS_DEPLOY_ANDROID=false`, версия 3.3.5/149.

## Сохранение исходников

`PhysisMemoryStore.captureMigrationMemory()` не вызывает reload, bootstrap,
обычный экспорт, подтверждение очереди или ротацию. Один снимок сохраняет
оптимистические записи, подтверждённые envelopes, удаления, точные request IDs
и ciphertext повторов, cursor/generations, статус, оба ключа незавершённой
ротации, её точный body и результат/неопределённость. Чтение/запись или подготовка
импорта в работе запрещают захват. Изменение состояния во время асинхронного
экспорта старых ключей также останавливает захват.

Это значение содержит старые ключи и предназначено только для локального
журнала, защищённого новым root до чтения сервера. Оно не является remote content,
обычным backup payload или телеметрией. Mutable byte buffers очищаются; полное
стирание immutable strings, CryptoKey и внутренних копий платформы не обещается.

`migration-editors.tsx` регистрирует 44 читателя форм/видов в 12 исходных файлах.
Сохраняются формы питания, профиль, числовые строки до валидации, тренировки,
планирование, назначения, лекарства, приёмы, измерения, определения показателей,
настройки и подготовленные импорты. Замыкания создания/копирования отдельно
отдают свои сохранённые intent/record IDs. После unmount остаётся последний
снимок. Логин/пароль, recovery inputs, DOM nodes, Promise, функции действий,
анимация публичных иллюстраций и фильтры публичных справочных виджетов в него
не переносятся. Recovery для ещё не открытого импортируемого файла вводится снова.

Открытие/bootstrap/unlock, account wrapping и первая загрузка модели теперь
выполняются под одним owner permit. Первая reload заимствует тот же permit;
ожидающий exclusive migration не блокирует дочерний HTTP своего родителя.
После закрытия операции этот permit повторно использовать нельзя. Реальный
cloud/store/WebCrypto/LockManager VM проверяет весь этот порядок и поздний отказ.

Переход между разделами теперь сохраняет модель и detached формы в памяти
текущей сессии. Logout закрывает её и очищает память. Это не новый plaintext
cache на диске, не durable offline queue и не полный lifecycle нового vault.
Общий migration UI ещё должен заморозить синхронное редактирование до захвата;
счётчики операций/проверка стабильности не заменяют эту обязанность.

## Сервер и сведение

`PersonalPhysisSource` использует подписанные owner-only страницы всех четырёх
таблиц: owners, records, usedIds и receipts. Полнота страниц, lease/sourceHash,
поколение и checkpoint проверяются отдельно от схем строк. `vault_json`,
`envelope_json`, response receipts и расшифрованный текст проходят общий parser
с обнаружением повторяющихся декодированных имён полей до нормализации.

Account-v2 и независимый password/recovery-v1 открываются разными путями.
Захваченный уже разблокированный vault может использовать свой сохранённый DEK;
новый/отличающийся vault требует своей действительной authority. Заблокированный,
неподдерживаемый или повреждённый источник не считается пустым, даже если в нём
сейчас нет активных записей.

Проверяется соответствие decrypted record и ID, исходный продуктовый validator,
ревизии, последовательности, used IDs, tombstones, receipt hashes и точное тело
незавершённой ротации. Содержимое сохраняется без проекции необязательных полей.
Отсутствующая used-ID запись считается pruned deletion только при сохранённом
ненулевом `min_cursor`: штатный сервер меняет его в одной транзакции с очисткой
tombstones. Без этого свидетельства источник останавливается как повреждённый.
Regression сначала воспроизвёл ошибочное принятие, затем прошёл с исправлением;
retained rows/keys при отказе не меняются.
Неопределённые сохранения не запускаются снова. Различающиеся локальные варианты
и сервер требуют точного решения review; необранные варианты также остаются
в локальном recovery history под новым root.

Remote object IDs случайны и не раскрывают исходные UUID/даты/названия. В remote
content входят выбранные записи, индекс, удаления и техническая история cursor.
Точные старые запросы, исходные receipts/ciphertext, незавершённые формы и все
варианты остаются device-local с `execution: history-only`. Старые account/record
keys исключены из обоих output placements. Их защищённый source journal до
проверенного retirement сохраняется отдельно.

## Android

В текущем Android нет native Physis editor/repository. Адаптер фиксирует этот
локальный состав явно и всё равно читает серверные таблицы; placeholder backup
`DEVICE_SOURCE_UNAVAILABLE` не используется как доказательство пустого vault.
Старый account key читается из реального owner-scoped Room/LocalCipher и сохраняется
в защищённом новом root snapshot для продолжения после последующей потери alias.

Перед isolated JS runtime native удаляет ключ из bridge input. JavaScript
проверяет исходный JSON и затем может запросить только открытие точного
захваченного vault и его конкретных envelopes. Kotlin держит reader и ключи,
независимый recovery остаётся native, capability закрывается по окончании или
смене аккаунта. Произвольных decrypt/storage/HTTP bridge методов не добавлено.

Вывод Physis передаётся частями 256 KiB с backpressure, проверкой порядка,
размеров, SHA-256 и allowlist domain/object ID. Это общий механизм локальной
передачи; plaintext hashes не попадают в HTTP migration packets.

## Проверки и пределы

Подтверждены 1628/1628 JS-тестов, focused Physis69/69, types, scoped ESLint, web build,
1194 passed / 8 прежних opt-in HTTP skipped / 0 failed JVM tests (217 suites),
включая 6 новых native source tests. Native build01 SUCCESS17m38s; после
дополнения барьера/bootstrap и проверки pruned IDs build02 SUCCESS2m32s. Финальная
коррекция synthetic fixture и build03 SUCCESS1m52s сохраняют main APK byte-identical
build02; изменился только test APK. Lint: 0 errors, 206 прежних warnings/8 hints,
в новых Physis source files findings0.

На API34 и35 — по7/7 instrumentation PASS без failures/skips: 6 сценариев нового
источника и один прежний полноценный Mindmaps source/readback на общем runtime.
Physis покрывает Room/Keystore, protected snapshot до source IO, account-v2,
независимый recovery-v1, alias loss до/после переноса, raw JSON duplicates,
смену аккаунта и локальную recovery history больше16MiB через streamed output
и новый root. Это source acceptance, не полный authenticated native coordinator
или уже включённый пользовательский lifecycle.

Первые device runs сохранили по4 PASS/2 FAIL: Android JSONObject.quote экранировал
`/` внутри случайного base64 DEK в synthetic account wrapper. Исторический web
format требует ровно46 plaintext bytes/62 ciphertext bytes, поэтому строгий
reader правильно отказывал. Fixture теперь строит точный quoted canonical base64
и проверяет46 bytes перед encrypt. Криптографический parser/допустимые форматы
не ослаблялись; итоговый main APK остался тем же. Все device tests повторены на
финальном test APK. Эмуляторы остановлены, личные устройства не затронуты.

Настоящий Chromium + React forms + WebCrypto + IndexedDB + подписанный coordinator:
`output/release-3.3.6/runtime/physis-source-browser-summary-03.json`, 29 assertions,
PASS. Закрытие формы сохраняет профиль и некорректную числовую строку; после
удаления исходной модели подготовленная миграция продолжает чтение, переживает
неизвестный исход commit и читает новую запись/локальные варианты после cold
unlock. Старый mutation не replayed. Скриншоты —
`output/playwright/physis-source-336/`.

Первая браузерная попытка ожидала сохранение `1,` после blur; действующий NumberField
корректно распознаёт её как 1 и нормализует. Приёмка исправлена на действительно
некорректный промежуточный `1,,`; поведение поля и assertions о сохранности не
ослаблялись. Первая сборка QA harness также потребовала явного NODE_ENV define.

Остальные evidence — `output/release-3.3.6/runtime/physis-source-*`:
focused-02, full-js-02, typecheck-08, lint-03/04, web-build-02,
native-build-01/02/03, native-jvm-summary-01, native-lint-summary-01,
native-instrumentation-summary-02, native-build-identity-03,
native-artifact-comparison-03 и browser-identity-03. Raw device results:
`output/qa/security336-physis-source-api34-02/` и `...api35-02/`.

Остаются общий product lifecycle/заморозка UI, security/review screens, восстановление
форм в обычной работе, все остальные обязательные sources, полный recovery/direct
upgrade набор, 48 сценариев, смысловая приёмка 14 языков и внешний crypto review.
API26 с Chromium69 ниже требуемого111 не подтверждает packaged-source acceptance;
native reader primitive на API26 проверен отдельно. Нужен совместимый provider
или проверенный fallback, а также приёмка максимальных совокупных размеров.
Локальный source snapshot ограничен 48 MiB, полный registry — 64 MiB с base64
overhead, суммарный migration budget — 128 MiB/10000 objects. Превышение запрещает
complete; оно не разрешает усекать исходник. Выпуск или активация не выполнялись.
