# 3.3.6: незакрытые системные критерии приёмки

## Остаток до выпуска

- Подтвердить полный путь сохранения, переноса и чтения для 11 источников
  из 20. В личных данных остаются локальные черновики и архивы. В общих
  проектах остаются содержимое, вложения, карты, автоматизации, история и
  локальные черновики. В пространствах остаются содержимое, карты и
  локальные черновики. Для них уже есть код и частичные доказательства.
- Завершить применимые системные сценарии. Для текущей смены роли осталось
  подтвердить согласия владельцев, применение и чтение с новой ролью после
  повторного входа. Для поддерживаемого обновления 149 → 150 нужны релизная
  подпись и проверка сохранности данных и очередей на устройстве.
- Провести итоговое ревью точно проверенного кандидата. После приёмки
  выполнить согласованные отдельные публикации сайта/API и Android APK.

## Фоновые запросы во время согласования роли

- Веб-клиент приостанавливает автоматическое обновление доски, списков задач
  и входящих на время согласования. После закрытия окна обновление
  возобновляется. Для входящих используется тот же последовательный механизм
  чтения с задержкой при ошибках, что и для доски.
- Целевые проверки прошли 43/43, полный веб-набор — 2241/2241. TypeScript, ESLint и статическая сборка
  прошли. На отдельной копии сборки `combined-main1125-poll-root` прошли
  четыре проверки запуска, две проверки входа в управление участниками и
  очистка окружения. Проверки входящих Business прошли 11/11 на той же сборке.
- `security336-membership94-1125` подтвердил 12 проверок, включая перенос
  проекта и пространства, чтение задачи и открытие плана. Экран согласий
  владельцев не открылся за 20 минут. В это время повторялись ответы 429.
  Сборка совпала по SHA-256 до и после. Службы остановлены, диагностическое
  состояние принадлежит синтетическому прогону. Проверка новой сборки идёт
  в `security336-membership95-1125`.

## Проверки кандидата 25 ноября

- Чтение общих записей сверяет хеш, ревизию и поколение того же конверта,
  который затем расшифровывает клиент. Для кэша проверенных версий введён ключ
  `product-read-v2:`. Целевые веб-проверки прошли 67/67, проверки ролей и
  планирования запросов — 27/27.
- Прогон `security336-shared-records92-1125` прошёл 14/14 на сборке с картами.
  После повторного входа открылись комментарий, отключённое правило и названия
  карт проекта и пространства. SHA-256 сборки совпал до и после, временное
  окружение очищено. История карт и версии рабочих процессов остаются открытыми.
- Локальная ветка объединена с опубликованным `main` (`052ff3df`, Deploy
  `45531724570`) в `8298ab27`. Кандидат сохраняет USD/Paddle и RUB/ЮKassa с
  текущего сайта. Серверные проверки обоих каналов прошли в локальной среде.
- Android 3.3.6/150 пересобран после исправления ожидания 429 с тестовым идентификатором
  `ru.genesis.calendar.qa1103.debug`. Выполнено 1456 JVM-тестов из 1464,
  оставшиеся 8 пропущены по правилам набора. Ошибок и падений нет. Подпись APK
  проверена. SHA-256 APK
  `e032162f046a21f6df7f18e9de571d07a91602ea3f8d4f14ec0b46f5f5a1281f`.
- После объединения выполнен веб-набор 2239/2239 и аудит 14 языков.
  После правки `#pricing` повторно прошли TypeScript, целевой ESLint и
  статическая сборка. В `combined-main1125-pricing-final` проверены открытие
  страницы тарифов до входа и открытие окна тарифов после входа. Переключение
  на USD показывает Paddle на 360, 390, 768 и 1440 px в обеих темах. Запросов
  создания заказа не было. Восемь снимков сохранены вместе с результатом.
- Миграция 141 добавила служебную таблицу `billing_paddle_checkout`.
  В классификации 3.3.6 она относится к платёжным данным. Тест схемы
  подтвердил 239 таблиц, ограждение записи в 106 приватных таблицах и отказ
  при неизвестной таблице или колонке. Повторный серверный набор прошёл
  158/158, HTTP-набор — 402/402. В запуске объединённого веб-клиента прошли
  четыре проверки старта и две проверки управления участниками.
- Повтор веб-набора обнаружил нестабильную фикстуру Physis. Подстановка `A`
  могла оставить зашифрованный текст прежним. Фикстура теперь всегда меняет
  первый символ. Целевые проверки Physis прошли 21/21.
- Прогон смены роли `security336-membership93-1125` завершился 12 PASS и 1 FAIL.
  После выбора роли и открытия плана запрос `membership-graph` получил 429
  с `Retry-After` в 538 секунд. Диалог завершил подготовку общей ошибкой.
  Обновление каталога сборки во время прогона нарушило его привязку к одному
  артефакту. Службы тестового окружения остановлены, диагностическое состояние
  сохранено под маркером синтетического прогона.
- Веб-клиент и Android обрабатывают `Retry-After` для двух операций чтения,
  `membership-graph` и `membership-state`. При ожидании проверяются сессия и
  открытый контекст. Повтор отправляет тот же запрос. Операции изменения прав
  сохраняют собственный протокол. Целевые проверки прошли 67/67. Новый прогон
  `security336-membership94-1125` использует отдельную копию статической сборки.
  После этих правок прошли 2240/2240 веб-тестов, TypeScript, целевой ESLint
  и статическая сборка.

Системная приёмка остаётся на 9/20 источников. Согласие владельцев, применение
и повторное чтение после смены роли ждут подтверждения в новом прогоне.
Открыты также подписанное обновление с 3.3.5/149 и итоговое ревью кандидата.

## Актуальный срез89,24 ноября

Все20source paths подключены; formal accepted9/20 остаётся прежним до сведения
предметных evidence. Files79 принял14/14, включая normal task attachment
1331200bytes и PNG byte-exact. Backup80 принял13/13,6sections/46entries/
483340bytes, wrong-key deny, inert import/cold history/current task preserved.
Это дополняет06/31/32 в исторической таблице и не заменяет все lifecycle cases.

Owner review82 завершился12PASS/1FAIL с actual E2EE_ROUTE_FORBIDDEN.89 исправляет
web/native allowlist graph+9atomic routes. Rich85 завершился12PASS/1FAIL после
Comment tab, с visible REFRESH_REQUIRED и actual429.89 добавляет encrypted
immutable body cache после fresh signed/authorized index; данные не объявлены
потерянными, целые33/34/48 не закрыты. Новые full90/91 RUNNING; старый83 bundle
в82/85 unchanged. Подробности: security-336-shared-snapshot-cache.md.

Web89 scope49/49+scheduling9/9 и affected HTTP17/17 PASS; types/lint/build PASS.
Native89 ещё выполняется. Это component evidence, не whole20/48/final review
и не signed149→150. Gate/floors/deployAndroid off и production149 сохраняются.

## Актуальные уточнения73–75,24 ноября

Это дополнение заменяет устаревшие формулировки «writers ещё не подключены»
и «остальные11 sources ещё нужны» в исторической таблице ниже. Все20 paths
подключены; приёмка их полного содержимого и lifecycle остаётся открытой.

| Сценарии | Фактический новый объём и границы |
| --- | --- |
| 05,07,17,19,22–27 | Mounted42 принимает personal migration/legacy storage retirement/cold recovery13/13. Messenger62 принимает nonempty encrypted drafts/history, pending retry и отсутствие отправки при migration5/5. Это не полный20-path verdict. |
| 06,31,32 | Content74 на immutable72 принял13 начальных checks: local archive download, independent decryption, wrong-key deny, history-only import и cold history с сохранением текущей edited task. Shared multi-chunk file/photo stage ещё выполняется. |
| 12,33,34 | SQLite/client50 и admission70 отдельно принимают atomic3-root rotation, revoked-reader refusal, explicit recipient/device/history consent и cold epochs1/2. Реальный owner-review/apply UI73 ещё выполняется; CLI не заменяет его. |
| 35 | Secret-peer59 принимает actual React/WebCrypto/IDB warning, stale-code removal, encrypted draft/cold pin, original history, exact lost-ACK retry и cold PATCH:5 functional +112 layout checks. Native58 принимает2 peer-pin repository cases в focused8 JVM. Chat replies modeled; real two-party enrollment этим не проверялся. |
| 47 | Все26 E2EE copy-каталогов смыслово прочитаны; три PT/ZH correction включены в native73. Это не вся product/legal/update copy и не полная визуальная приёмка. |
| 48 | Native37 controller и retained UI40/41/57 имеют отдельные source bindings; основную миграцию не повторять. Compiled root72 впервые принимает actual membership renderer2/2, но не owner approval. Shared-records75-02 добавляет nonempty comments,4 map versions, disabled automation и2 workflow versions; normal cold readback пока RUNNING. |

Shared-records75-01 остановился до fixture из-за404 прежнего PHP download URL;
не продуктовый PASS.75-02 использует прежний проверенный PHP8.4.27 executable,
startup4/4 и compiled root2/2, тот же неизменяемый bundle72. Seed через обычные
legacy APIs принят; limits/floors/production не менялись. Input hashes находятся
в runtime/shared-records75-02-input-identity.json. Formal source acceptance9/20
сохраняется до сведения предметных доказательств; signed149→150, final internal
exact-candidate review и выпуск ещё не завершены.

## Дополнение70/71,24 ноября

Новый nonmember проходит настоящие signed invitation/recipient consent,
atomic owner admission с3 rotations и точным receipt retry, отдельный device
challenge/approval/history grant и cold чтение epochs1/2: admission70-03 PASS5/5.
Это CLI/SQLite/WebCrypto + encrypted in-memory vault, без owner-review UI/HTTP;
не подмена прежнего enrollment уже существующего участника и не whole34 PASS.

Завершена совокупная смысловая вычитка всех26 E2EE copy-каталогов; уточнены
три PT/ZH подписи. i18n:audit PASS. Остальные product/legal/update строки и
полная визуальная приёмка остаются отдельным объёмом сценариев47/48.

Readonly queue71 имеет собственные RED/GREEN3/3 и types/lint/build:web PASS;
текущий mounted64 идёт на более раннем immutable63. Exact f330 CI оба SUCCESS
2229/2229 JS и Android job; последующую71 он не проверяет. Formal9/20 не повышен,
signed149→150 и финальное whole-candidate review по-прежнему обязательны.

## Текущий код и проверка24 ноября

Старая таблица ниже — историческая карта системной приёмки20 ноября, а не
перечень кода, который следует писать заново. Текущие web/native factories
подключают все20 обязательных paths через registerIntegrated:11personal,
6project,3space. Полнота проверяется до snapshot/lease, пустая замена отсутствующего
адаптера запрещена. Cloud-sync createCompleteMigrationSourceRegistry и native
AuthController.e2eeCompleteSources содержат действующую композицию.

Это подтверждает подключение кода, но не повышает формальное9/20 по сумме unit
tests. Для полного системного заключения ещё нужны сводные evidence каждой
категории,48scenario coverage, signed149→150 и exact-candidate crypto review.

Membership clients50-05 добавляет6/6 real store/crypto checks: атомарные3 rotations,
revoked read/write deny, future root isolation, epochs1/2 у первого trusted device
существующего участника и cold owner reader. Это CLI + encrypted in-memory
storage; owner-consent/invitation UI и полные33/34 не закрывает. Точная граница и
отчёты — security-336-membership-acceptance-2026-11-24.md.
Девять прежних personal adapter приёмок не заменяют populated shared/archives/
local-work lifecycle. Уже реализованные writers/capture/restore не переделывать
по старым строкам без конкретного воспроизводимого дефекта.

Последний новый блок: encrypted legacy browser originals/key retirement,
focused19/19 и actual mounted web42 PASS13/13 (включая cold/offline/clean recovery).
Full JS41:2182/2184,2PHP prerequisites; affected suites повторены11/11 с прежним
PHP. Native41: fresh1453JVM,1445PASS/0failures/8 existing opt-in skips; assembled
QA APK95995C54…982D8C, sourceBEA956EA…230308. Прежний controller37/PIN/UI40,
API26/API34 и restore evidence сохраняет собственные source/artifact bindings.
Новый UI41 PASS4/4 на retained37 без повторной миграции/очистки данных; exact
current backend после просмотренного6-file payment patch указан отдельно.
Ни один старый failed/skipped не переименован вPASS.

Операционные подробности: security-336-handoff-2026-11-24.md и
security-336-legacy-storage-retirement.md. Production website7964526b/Deploy
45373264770 — отдельная принятая публикация без security3.3.6 и с APK149.

## Историческая системная матрица

Последнее решение владельца21 ноября: итоговое крипторевью выполняет сам
исполнитель после завершения кода, общей приёмки и исправлений. Отдельное
внешнее заключение больше не является gate выпуска/активации. Результат остаётся
внутренним AI review; прежние scoped-проверки не заменяют проверку финального
diff. Критерии всех применимых системных сценариев ниже сохраняются.

Срез20 ноября2026. Нумерация соответствует исходным48 сценариям в сохранённом
аудите17 ноября. Это карта оставшейся приёмки, **не список пройденных тестов**.
Частные доказательства подробно записаны в `release-3.3.6.md` и документах ниже.
Полного выпуска3.3.6, включения pilot/cutover или обновления основной установки нет.

Уточнение владельца21 ноября: APK до3.3.5 не поддерживаются и отдельно
не проверяются. Релизная матрица обновления начинается с3.3.5/149. Исходные
номера28/29 сохранены для связи с аудитом; отменённый объём не отмечен как PASS.

21 ноября добавлен отдельный adversarial internal crypto review:
`security-336-internal-crypto-review.md`. Шесть классов boundary/lifecycle дефектов
исправлены с сохранёнными RED и exact platform evidence. Это review тем же
AI-разработчиком, не независимое человеческое заключение; ни один полный
системный сценарий этой таблицы не закрывается его суммарными test counts.

«Частично» означает наличие проверенных компонентов, но отсутствие полной
системной приёмки во всём требуемом охвате. «Не выполнено» означает, что нужное
испытание новой версии ещё не проводилось. Ни одна строка здесь не закрыта
общим количеством unit-тестов, проверкой schema inventory или девятью source
adapters. У финального результата каждой строки должны быть commit/artifact,
конкретный сценарий, платформа, evidence и явно указанные ограничения.

| № | Исходный сценарий | Состояние и конкретный остаток |
| --- | --- | --- |
| 01 | JS шифрует, Kotlin читает, и наоборот | Частично: общие vectors/readers проверены; нужны все product adapters и реальные upgrade/recovery journeys |
| 02 | Изменены ciphertext/tag/nonce | Частично: envelope/source отказы проверены; нужен весь контент и продуктовые ошибки без потери данных |
| 03 | Подменены owner/domain/object/epoch/schema | Частично: общий контракт проверен; нужны все реальные shared/personal маршруты |
| 04 | Неизвестный suite, неверный base64, переполнение | Частично: bounded parsers проверены; остаются large-data и полный набор feature inputs |
| 05 | Retry и crash до/после записи | Частично: immutable queues/receipts/coordinator проверены; все product writers ещё не подключены |
| 06 | Обрезаны/переставлены chunks, подменён manifest | Частично: file primitive и часть source output проверены; действующие вложения/загрузки ещё нужны |
| 07 | Сервер получил DB/config нового поколения | Не выполнено во всём продукте: все11 оставшихся sources и нормальные записи должны перейти в новый формат |
| 08 | Google-вход на новом устройстве | Частично: независимость crypto authority реализована; нужна полная login/unlock UX-приёмка |
| 09 | Подмена public key при QR enrollment | Частично: challenge/signature contract проверен; нужен реальный product enrollment и сравнение fingerprint |
| 10 | Replay истёкшего challenge или чужой аккаунт | Частично: контракт/серверные проверки есть; нужен полный UI/session journey |
| 11 | Отозванное устройство | Частично: directory/capsules/signatures проверены; нужны все фоновые и обычные product writers |
| 12 | Новая эпоха после отзыва | Частично: независимые roots/capsules проверены; остаётся атомарная интеграция ACL+rotation и feature content |
| 13 | Recovery на чистом устройстве | Частично: независимый recovery primitive и source readback есть; полного восстановления аккаунта со всеми данными нет |
| 14 | Только admin account recovery | Частично: identity отделена от ключей в контракте; нужна product-проверка отсутствия доступа к содержимому |
| 15 | Неверный recovery secret или пароль | Частично: crypto/source ошибки сохраняют исходники; нужны все пользовательские recovery/import paths |
| 16 | Потеря всех ключей | Частично: key-loss отказы/retained snapshots проверены; нужна полная понятная UX без пустого replacement vault |
| 17 | Кража browser storage при lock | Частично: новое encrypted storage проверено; действующий legacy product ещё не переведён целиком |
| 18 | Reload, новая вкладка, stale service worker | Частично: реальные worker/two-tab/fence cases есть; остаются общий product routing и uncontrolled/restored pages |
| 19 | Смена аккаунта/logout с pending data | Частично: owner permits, ряд источников и отказ от E2EE body user/CSRF до session/profile adoption проверены на actual web/native HTTP; остальные writers/drafts ещё подключаются |
| 20 | Инвалидирование Android Keystore | Частично: actual alias-loss/refusal/retained-key cases есть; полного recovery всех категорий нет |
| 21 | Crash reports, логи, clipboard, temp files | Частично: redaction/ограниченные ports есть; нужен системный canary-прогон финального кандидата |
| 22 | Backup перед первым sync | Частично: девять реальных captures и coordinator проверены; archive web input отдельно прошёл actual File/React/IDB cold readback. Остальные11 полных sources и весь product lifecycle mounted/unmounted drafts обязательны |
| 23 | Обрыв на каждом шаге миграции | Частично: state-machine, same-actor mixed history и отдельная encrypted remote-original quarantine через actual web/native HTTP проверены; остаются обязательная capture factory, authenticated custody, полная state4/source/plan публикация, все feature paths, process death и clean restart |
| 24 | Две параллельные миграции | Частично: lease/fence/CAS проверены; полный многоклиентский product-переход ещё нужен |
| 25 | Legacy write во время финального commit | Частично: SQLite/HTTP/SW/owner barriers, полный native backup job и web backup whole-job проверены отдельно; все остальные local/normal/background writers и общая продуктовая приёмка ещё не завершены |
| 26 | Legacy write после activation | Частично: persistent deny и API policy проверены; product activation отключена, полный routing не принят |
| 27 | Старый offline outbox после удаления | Частично: task/diary/map reconciliation cases есть; все очереди и прямые обновления ещё нужны |
| 28 | Прямое3.3.4 →3.3.6 | Исключено владельцем21 ноября: отдельные APK до3.3.5 не поддерживаются и не проверяются |
| 29 | Поддерживаемая3.3.5/149 →3.3.6 | Не выполнено: нужен конечный signed APK3.3.6 и проверка данных, подписи, очередей и доставки при обновлении с3.3.5/149 |
| 30 | Два устройства и web редактируют одни данные | Частично: scoped queues/merge проверены; полного пути всех категорий на трёх клиентах нет |
| 31 | Импорт старого архива | Частично: backup/parser и некоторые журналы есть; нужен новый общий content-only import/restore |
| 32 | Чужой архив с premium/ACL | Частично: отдельная authority и ограничения есть; нужна новая полная import/restore-приёмка |
| 33 | Групповой проект, отзыв участника | Частично: signed role/rotation contract есть; атомарный ACL+rotation и реальные shared adapters не закончены |
| 34 | Новый участник проекта получает историю | Частично: historical grants проверены; нужен реальный shared UX с принятой политикой истории |
| 35 | Смена ключа собеседника | Не выполнено для финального3.3.6: существующие message keys/history сохраняются; нужны предупреждение/проверка и regression journey |
| 36 | Сервер выдаёт старый snapshot | Частично: pinned checkpoints/retired heads проверены; нужен весь product recovery/sync |
| 37 | Новое устройство без checkpoint | Частично: ограничение antirollback документировано; нужна соответствующая trust/recovery UX-приёмка |
| 38 | Play cancellation/back/error | Частично: bridge3.3.5/UpdateGate проверен; нужна приёмка финальной доставляемой версии в разрешённом канале |
| 39 | Play process death/reboot/resume | Частично: bridge/state handling есть; реальный финальный канал3.3.6 ещё не принят |
| 40 | Rollout ещё не дошёл до установки | Частично: policy/delivery guard есть;3.3.6 ещё не доставлена, update floors остаются0 |
| 41 | Нет сети/места/Play, expired login | Частично: bridge/refusal/emergency path есть; полный новый vault/recovery UX ещё нужен |
| 42 | Разные certificates сайта-APK и Play | Не выполнено для финального3.3.6: нужен реальный release artifact/lineage и проверка совместимости без reinstall |
| 43 | Widget/deep link/worker обходят Activity | Частично: bridge/transport/persistent fences есть; все реальные writers ещё требуют проверки |
| 44 | Подделан номер приложения в API | Частично: signature/epoch/protocol contract есть; полная active-scope route-приёмка ещё обязательна |
| 45 | Восстановление системного backup | Частично: внешняя защита system backup подготовлена/проверялась отдельно; нужен restore финального нового поколения без downgrade |
| 46 | Google export, spelling, AI | Частично: границы классифицированы; полная новая consent/external-copy интеграция ещё нужна |
| 47 | 14 языков, особенно английский | Частично: catalogue/design проверки есть; смысловая приёмка новой security/recovery/privacy UX ещё не закончена |
| 48 | Web360/390/768/1440, обе схемы; API26+ | Частично: согласованный дизайн и source cases проверялись; финальный полный product journey всех security flows ещё нужен |

Отдельный обязательный этап — итоговое внутреннее криптографическое review самим
исполнителем на конечном commit/artifact после QA и исправлений; оно пока
не выполнено. План и доказательства: `security-336-final-review.md`.
Возможный запрос Play/личного устройства
не подразумевается общим разрешением web/API/APK Deploy; сначала завершаются
все независимые разрешённые работы и готовится конкретный проверяемый кандидат.

Основные группы доказательств: `e2ee-336-contract-adr.md`,
`e2ee-336-runtime-adr.md`, `e2ee-336-operation-fences.md`,
`e2ee-336-service-worker.md`, `e2ee-336-native-transactions.md`,
`e2ee-336-retained-native-old-keys.md`, `e2ee-336-native-source-stream.md`,
документы конкретных source adapters и `security-bridge-335-adr.md`.
Границы нового read-only coordinator increment и точная приёмка:
`e2ee-336-migration-history.md`; он не закрывает полный системный сценарий.

Строгий HTTP JSON до проекции native/web принят отдельным компонентом:
`e2ee-336-transport-json.md`. Full JS1956/1956, Chromium143/143, selected JVM235/235,
API26/API34 each3/3 actual-client cases плюс7/7 regressions на frozen input02.
Это не durable remote-original custody и не закрытие какого-либо полного
product-сценария выше. Сохраняются coverage9/20 и все условия активации.
