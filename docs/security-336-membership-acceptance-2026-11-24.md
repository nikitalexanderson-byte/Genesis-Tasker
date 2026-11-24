# Общие проекты: приёмка изменения участников 24 ноября

## Mounted60 и staggered read63

60 FAIL12PASS/1FAIL,2notRepeated. Исправленный role selector используется;
personal и3shared ACTIVE, normal task/legacy-deny readback PASS. После выбора
guest parent остаётся busy, review не появился за20min; final AX не содержит
visible error или private review. Ownership cleanup PASS, immutable54 hash до/
после df8d904f…d2b05c9. Это уже не повтор прежней exact-label ошибки54.

Последующий отдельный RED63 показывает2 fresh observations вместо1, когда
второй widget приходит во время незавершённого context IO. SharedLiveModel
теперь допускает coalescing только до settlement той же snapshot promise;
mutation немедленно отделяет дальнейшие reads. Settled snapshot не кэшируется.
GREEN9/9 scheduling (3 новых staggered cases), tsc/scoped lint/build:web PASS.
Это конкретная correction, но не доказанный итоговый repair всего mounted60;
owner review/apply, новый участник/history и full20/48 ещё открыты.

## Mounted54: exact selector failure

Mounted54 ended FAIL after personal and three shared scopes became ACTIVE and
normal task/legacy-deny readback passed. The final AX snapshot actually contains
both members and their workspace role selects. The exact getByLabel query does
not match a label wrapping this select/options; the replacement getByRole with
the observed combobox name does. Minimal actual-browser structure diagnosis:
old matches0, role matches1, runtime/membership54-selector-diagnosis59.json.
All three normal role lookups now use that accessible control. This is a QA
selector correction, not a membership/ACL bypass. Actual Retry-After windows and
600-request limits remain. Bundle54 hashdf8d904f…d2b05c9 stayed unchanged;
cleanup PASS. Owner consent/final apply still need their actual UI result.

Исходная база7287ac54. Это дополнительная предметная приёмка, не итоговое
крипторевью и не завершение полных сценариев33/34 или выпуска3.3.6.

## Исправленный дефект истории ключей

`genesisE2eeEpochKeys` учитывал bootstrap и rotate, но пропускал
rotate-membership. После изменения участников сервер терял соответствие
эпохи и keyId. Это нарушало полноту проверок выдачи истории новому устройству
и допускало повторное использование такого keyId следующей ротацией.
Теперь обе разновидности ротации входят в один проверяемый журнал эпох.
Web Directory и native E2eeDirectory уже поддерживали rotate-membership;
их код и принятые APK не изменены этим исправлением сервера.

Сохранён RED: output/release-3.3.6/membership-atomic45-1124-red02/
logs/e2ee-membership-atomic.log, E2EE_MEMBERSHIP_EPOCH_HISTORY_MISSING.
GREEN: membership-atomic45-1124-history02/results.json, PASS, cleanup PASS.
Новый backend suite исполнил39 собственных assertions, плюс260 prerequisites
e2ee-store. Проверены реальные SQLite migrations/triggers, P256 signatures,
staging/cancel/lost-ACK replay, три owner rotation под одним writer,
откат ACL/эпох/devices/events/retired manifests после отказа последней ротации,
отказ неполного closure/поддельной подписи, immutable receipt/page readback,
отказ удалённому участнику и сохранность прежних opaque objects для владельца.
Отдельно проверены отказ reuse текущего и уже retired membership keyId,
обязательная выдача исторических эпох1/2 и принятие полного набора grants
новому доверенному устройству. Это CLI/server lifecycle; opaque случайные
capsules/bodies не являются доказательством клиентской расшифровки или UI.

Первоначальные отказы45/02/03 и history01 вызваны setup/assertions тестового
окружения (missing shared include, неверное имя таблицы, ожидания404/count/
directory revision). Они сохранены; в PASS не переименованы. Единственное
изменение production — добавление rotate-membership в историю эпох.
Регрессия e2ee-shared-store также PASS в membership-atomic45-1124-green.

## Планировщик, wire и локальный lifecycle

tests/e2ee-membership-planner.test.mjs:15/15 PASS. Production TS/PHP planners
и codecs независимо сверены по полным результатам и hashes. Проверены role/
remove, последний guest, inherited grants/exclusions, category permissions,
space/Inbox, invitation admission, required ACL suffix, cycle/duplicate/hash
отказы, owner-transfer refusal. Wide fixture содержит210 scopes и208 grants,
с двумя grant pages: усечения после200 нет. Private category title не попадает
в технический wire. Этот тест сам по себе не применяет изменения.

tests/e2ee-membership-staging.test.mjs:6/6 PASS, настоящий production
MembershipAtomicStager с CAS/durable-port моделью и ECDSA packets. После
потерянного ACK/холодного создания модели используются те же подписанные
оригиналы. Частичная local save, missing/substituted pages, смена session и
foreign owner не вызывают transport. Cancel fence сохраняется до подтверждения;
изменение caller inputs не меняет сохранённый план. Local ports здесь in-memory;
этот bounded тест не выдаётся за encrypted IDB/Android process-death приёмку.

## Согласие владельца и финальный apply

Ещё9/9 focused JS PASS:6 owner-review/receipt и3 final-apply lifecycle.
Новый helper создаёт fresh recovery/device keys, настоящие HPKE root capsules,
подписанные bootstrap/migration/enrollment/membership chains. Проверены complete
parts, explicit fingerprint/roster, чужая authority/identity/ownership,
блокирующий private-effects adapter, сохранённый consent до выпуска нового root,
export после restart без новой ротации, stale review после observed commit.
Revoked device не открывает survivor capsule; survivor расшифровывает future
content. Immutable receipt не завершает операцию без обязательного readback;
его отказ можно повторить. Lost final ACK повторяет точный saved POST без
restaging; receipt с failed readback сохраняется и не исполняет commit заново.

Это production classes с реальной криптографией, но local CAS, transport и
normal-repository readback ports здесь model fixtures. Проверка root decryption
не выдаётся за чтение нормального task UI. Private-effects callback проверен как
обязательный blocking capability; полнота его product semantics требует своей
реальной populated приёмки. Начальные setup failures (prototype comparison/
неверное имя suite в harness) исправлены без изменения production guards.

Итого focused JS30/30 PASS. Нужны реальные membership owner-review/apply UI,
нормальное чтение истории новым участником и сводный20-path/48-scenario review.
Все activation/update floors остаются выключенными; APK149 сохраняется.

## Нативное окно браузера над редактором команды

PrivateMembershipGate открывался как div за уже открытым HTML dialog команды.
Одного z-index недостаточно: native modal исключает внешнюю область из ввода.
Теперь PrivateMembershipModal занимает browser top layer через showModal,
сохраняя родительский редактор и его состояние. Escape проходит существующий
guard закрытия; новый элемент не добавляет signer/ACL capability. Общие popup
width/height/border правила явно исключают внешний private-vault-gate, чтобы
полноэкранный барьер не сжимался в обычную карточку. Внутренний текст/checkbox
имеют отступы, а строка согласия сохраняет44px цель нажатия.

Компонентная browser приёмка49:8/8 PASS (360/390/768/1440 × light/dark),
output/playwright/security336-membership-modal49-final/results.json.
Использованы реальные PrivateMembershipModal/useDialogAccessibility/editor
fence и CSS собранного продукта; нет аккаунта, keys или auth-success mocks.
Проверены настоящий :modal, полный viewport без горизонтального overflow,
клик по checkbox, Close/Escape и байтово сохранённый input родительского :modal.
Вручную просмотрены360light и1440dark. Это bounded layer/focus проверка,
не весь crypto consent lifecycle. Build:web/typecheck PASS; scoped lint0errors
с3 прежними hook warnings в Gate. Финальный detector49:[] findings.

Ранние47 проверки кликов не засчитываются за визуальную приёмку обеих тем:
fixture сначала имел неверные имена themes. Правильная theme/cascade проверка
выявила конфликт generic popup !important;49 использует настоящие standart/
standart-dark, полный viewport и соответствующий theme background. Первичная
fixture46 без unlocked account корректно fail-closed до открытия формы и не
является RED доказательством modal бага; соответствующие отчёты сохранены.

Полный mounted membership run46-02 на immutable41 ещё выполняется отдельно:
реальные owner+recipient legacy ACL, personal transfer, project/Inbox/space,
нормальный task/team UI и explicit owner consents. Никакие budgets не повышались
и rate rows не сбрасывались; actual600-request/600s windows занимают время.
Его результат пока не принят. Новый focused49 идёт на полностью скопированном
immutable web49; прежние offline/clean recovery проверки42 не повторяются и
явно перечислены в notRepeated. Остальные действия выполняются в живом продукте.
Premature48 остановлен только в owned synthetic API, runner cleanup PASS;
его before/after bundle hashes различались, приёмкой он не является.

## Межклиентское чтение и отзыв — реальное хранилище

`scripts/qa/membership-clients.mjs` с CLI-only owned adapter
`membership-client-store.php` проверяет production PHP/SQLite store и настоящие
WebCrypto/P256/HPKE scope clients. Результат50-05: **6/6 PASS**, cleanup PASS,
`output/qa/security336-membership-clients50-1124-05/results.json`.

- Текущий участник открывает старое содержимое production scope reader.
- Атомарно меняются три scope; тот же подписанный commit возвращает прежний
  receipt, подтверждения ротаций проверяются клиентом по directory chain.
- После отзыва сервер отказывает в refresh, двух signed reads и старой signed
  put; локальный сохранённый draft не отправляется без нового refresh.
- Старый recipient отсутствует среди новых capsules; его настоящий receiving
  key не открывает ни одну future-root capsule оставшихся устройств.
- Первое trusted device другого, уже состоящего в workspace участника получает
  явно выданный history grant и расшифровывает содержимое epochs1/2.
- Владелец закрывает device vault и повторно открывает сохранённый encrypted
  bundle; новый scope client читает обе эпохи.

Это CLI store integration с encrypted in-memory device storage, не HTTP rate/
session middleware, actual IndexedDB или owner-consent/invitation UI. Корневые
product bodies синтетические, не domain-editor acceptance. Новый участник не
проходит здесь приглашение/изменение ACL: проверено именно первое trusted device
у существующего участника. Поэтому полные сценарии33/34 этим не объявляются PASS.

Первые50-01..04 исправляли только fixture: попытку менять immutable signed packet,
неверный product objectId, доставку enrollment от другой session и ошибочное
предположение о типе openRoot (возвращает non-extractable CryptoKey). Последнее
заменено настоящим forwardRoot. Не менять эти production guards. Runtime50-04
после отказа fixture cleanup очищен отдельно с ownership marker/boundary checks;
остальные runtime убраны штатно. Личные данные/устройства не использовались.

Mounted46-02 завершился FAIL после успешного shared task readback. Отсутствовал
team editor до выбора роли, snapshot содержит E2EE_REFRESH_REQUIRED/
E2EE_DIRECTORY_CONFLICT и HTTP429. Никакого pointer input в review ещё не было.
Его cleanup PASS. QA openTeam теперь ждёт реальный roster перед fallback по
имени и использует существующий bounded Retry-After/cold unlock при отказе.
Focused49 по-прежнему идёт на immutable49, его результат нельзя приписывать
более поздней правке QA-файла: исходный qaSourceSha256 сохранён в отчёте.

## Все языки в окне согласования

Component53 на CSS immutable49: **112/112 PASS**, все14 языков ×360/390/768/1440
×standart/standart-dark, palette violet. Сами modal/focus/editor-fence компоненты продукта,
actual localized title/notice/planAck/keep; родительский synthetic dialog/draft.
Проверены top layer, полный viewport, отсутствие горизонтального overflow
снаружи и внутри карточки, ввод checkbox, Close/Escape и сохранённый родитель.
Scope: output/playwright/security336-membership-modal53-locales/results.json.
Вручную просмотрены de360dark, ja390light, en1440dark; наложений/обрезки нет.
Остальные изображения имеют автоматическую geometry/input проверку. Это один
начальный review state без account/keys/auth mock; не полный Gate lifecycle,
не font-scale1.3 и не все последующие формы owner/final review. Scoped lint PASS.
Hash bundle/entry и точные ограничения сохранены в input-identity.json; hash
bundle наблюдался после53 и ещё будет сопоставлен с mounted49 before/after.

## Обнаруженное ограничение directory/status и исправление54

Mounted49 завершился FAIL12PASS/1FAIL,2 прежних personal cases явно notRepeated.
Все3 shared scopes ACTIVE и normal task readback PASS; team editor не появился
до role selector. Cleanup PASS, pageErrors0. При actual429 наблюдались
E2EE_HTTP_ERROR/CORRUPT_FILE/REFRESH_REQUIRED. Сам CORRUPT_FILE не доказывает
повреждение ciphertext: файловый reader сводит в этот код и ошибки fetch.
Причина воспроизведена отдельно: нормальный signed read уже ожидал bounded
Retry-After, но status/directory не входили в этот путь. Directory429 сразу
сбрасывал refreshed-state и оставлял ожидающих читателей без verified channel.

RED54:3/3 targeted cases FAIL на прежнем коде; log scope-discovery54-red.log.
Теперь HTTP adapter классифицирует bounded actual429 для read/status/directory;
scope refresh и account scope discovery ждут через существующий retryE2eeRead.
Каждая пауза/новая попытка проверяют current account/device/lifecycle. Старые
authority/ACL не подставляются после неуспешного refresh, мутации не повторяются
этим механизмом. No budgets changed. GREEN54:65/65 affected scope/HTTP/retry
tests PASS плюс1/1 actual close-during-directory-rate case с неизменным vault.
Typecheck и scoped lint PASS, build:web PASS98HTML/280gallery/locales/precache.
Это web correction; native41 и whole membership результат им не подменяются.

QA waits owner/final review теперь допускают настоящее600s окно (bounded20min
на этап) и немедленно завершаются при visible membership error. Они не сбрасывают
план, intents, rate rows или ciphertext. QA openTeam ждёт реальный roster, как
описано выше. Новая mounted54 приёмка требуется на отдельно скопированном bundle.

Component53/immutable49 сравнение завершено: before49=after49=after53,
SHA2565af34101e8215d26cfdfabb1d063129b321fbf455e06cf6031160b8cc7df9506,
mounted49-comparison.json. Это доказывает неизменность UI bundle в53, но не
превращает FAIL49 в успешный membership journey.

После изменения normal reader новый real store/crypto прогон55 на dab6eb7a:
6/6 PASS, cleanup PASS. Тот же исходник QA50, но уже исправленный product scope
refresh. Output: output/qa/security336-membership-clients55-1124/, input-identity
подтверждает чистый production diff против dab6. Scope/ограничения прежние:
CLI/SQLite/HPKE и encrypted in-memory vault, не HTTP/IDB/owner-consent UI.
