# Точный ownership локальных content plans

21 ноября 2026. Реализация текущего state4 связывает bounded content-plan writer
с настоящим coordinator/source CAS. Native input04 прошёл выбранные device
группы, browser personal PASS; project/space и full native lint проверяются.
Это ещё не system acceptance3.3.6:
coverage9/20,3.3.5/149 production, run/upload/activation и rollout gates сохраняются.

## Граница реализации

`planStreamedContent` удерживает один whole-job fence. Новый attempt получает
точную durable reservation ДО первой записи journal. Local ownership wire3
сохраняет original state3/hash/serial, source catalogue, actor/target, signed
directory/checkpoint и source/lease существующего state4; reservation дополнительно
закрепляет plan context, fence/generation, ordered complete original references
и nullable final manifest reference. Это новая локальная версия ownership,
не новый crypto suite, envelope или writer protocol. Wire1/2 readers сохраняются.

Builder получает revocable source-history и raw-original read ports, sequential
record output. Каждый local path и каждый owned remote original должен пройти
настоящий EOF. Late/caught IO errors остаются sticky, незавершённые операции
дожидаются завершения до освобождения fence, escaped ports отзываются. Весь
account/file не собирается в массив plaintext или ciphertext.

Standalone complete marker остаётся inert. После полного bounded readback
точный manifest reference закрепляется вторым coordinator CAS и читается обратно.
Проверяются исходные metadata/catalogue, original bodies, current actor и durable
keys. Подготовленный plan не переводит `phase` в uploading, не устанавливает
`planned=true` и не открывает прежний aggregate run.
Его lease/source binding описывает захваченный input, а не новое доказательство
текущего состояния сервера. Перед будущим upload/activation всё ещё обязательны
signed renewal, актуальный source token/directory и reconciliation при изменении.

## Сбои и составные источники

Сохранённые reservations различают missing, writing и complete. Потерянный
final binding может быть восстановлен только из полного manifest с точным
context/source/actor, inventory, signatures и record digests. Если exact complete
binding уже существует для того же полного набора originals, cold retry читает
его; builder не запускается повторно. Неполный attempt сохраняется; повтор
получает новый ID. Ни одна проигравшая попытка не удаляется.

Reader проверяет и учитывает реальные journals/manifests/outbox/local rows.
Прерванный файл может не иметь последнего manifest с отдельным file key: его
pending suffix имеет authenticated outer vault и проверенную signature envelope,
но НЕ plaintext completeness. Он остаётся inert material, а не новым content
source. Все завершённые logical records дополнительно проходят полный readback.

Для текущего state4 source-history получает явную проверку точных reserved roles;
global metadata/output locators сверяются с ownership до открытия соответствующих
plan bodies. Неизвестный journal, неправильная роль или journal-free output
отказывают. Нового пустого-prefix read API нет. Старый v1/v2/v3 source-only reader
по умолчанию по-прежнему отвергает content plans и network-touched history.
Старые cancelled network plans, process-role collector и authenticated original
key recovery ещё должны войти в полную общую композицию; этот increment их
не объявляет завершёнными.

Usage содержит все retained attempt rows и growing metadata. Actual physical
ciphertext/count/quota admission остаётся обязательным на IndexedDB/SQLite
provider boundary; callback builder не может её заменить.

## Дополнительные исправления и web evidence

Внутренний regression воспроизвёл existing defect долгой session: renewal
передавал замороженный `snapshotE2eeValue` в изменяющую state machine. После
первой response истёкший lease приводил к `Cannot assign ... resuming`.
Исправлено созданием собственной mutable technical copy; signed durable renewal,
current-cell CAS и предыдущие bindings сохраняются. RED/green:
`runtime/content-provenance-session-renewal-{red,green}-01.log`.

Новый runtime import coordinator→content-plan выявил цикл через source registry
в CommonJS fixture loader. Inventory import переведён на существующий независимый
`private-paths.ts`. Failed full01 сохранён, stale owned Aurora test process
остановлен после подтверждения старого цикла. Приёмкой служит новый full02,
а не незавершённый/ошибочный full01.

Full JS2072/2072,0 failures/skips,109.9s: `content-provenance-js-full-02.log`.
Исполнен тот же полный перечень `tests/*.test.mjs` и trace sanitizer с concurrency4;
изменено только число одновременно выполняемых suites. Новые cases проверяют
reservation-before-journal, точный original hash, cold read/reuse, lost completion
binding, retained partial retry, actual local/remote EOF, unknown output refusal,
capacity preflight и продление session lease. Synthetic registry/normalized
records не закрывают новые категории настоящего продукта.

Scoped ESLint03, owned core TSC04 и project TSC01 PASS. Project invocation
использует исходный tsconfig и исключает demo-output и generated build/output
directories. Отдельный standalone QA TSC03 без полного project declaration
context не прошёл и не считается приёмкой. Native build01/inputAA3A7019 отказал
на несовпадении positional consumer с optional Boolean аргументом existing
`withOriginal`; исправлен named `consume`, новый frozen input02 A3D8007B.
Failed01 не даёт JVM/APK acceptance. Итоговые
браузерные/native результаты и точные APK identities добавляются после проверки.

Native build02 выполнил JVM1413 PASS/0 failure/8 existing opt-in HTTP skips,
1421 total/247 suites (unit status BLOCKED). Затем compilation androidTest
отказала на test-only metadata export helper: nested Rig не видит outer hash.
Исправлен прямой JCA digest. Build03/input5CAC4552 SUCCESS1m31s; main APK
ПОБАЙТНО совпадает с build02, JVM task03 UP-TO-DATE. Это binding прежнего JVM
прогона к тем же product classes, а не второй новый JVM run. Новый test APK
собран отдельно. `content-provenance-native-{unit-02,refresh-03,built-03}.json`.

Первый device run input03 имел19 PASS/1 FAIL на КАЖДОМ API. Ошибка fixture:
он требовал сохранённый file chunk после65537bytes, хотя существующий v1 file
chunk —256KiB. Новый input04 A2381E7D использует `CHUNK_BYTES+1`; main APK
остаётся7AEE8744 побайтно прежним, test APK3E1BDDF5 собран build04 SUCCESS1m13s.
Теперь каждый API26/API34 проходит44 DISTINCT cases в трёх свежих credential
groups: planning02 20/20, storage01 16/16, history01 8/8,0 failures/skips.
Это составная приёмка одного exact main/test APK, не один монолитный44-case run.
Failed input03 runs сохранены. Updated focused JS prefix case также проходит;
полный JS2072 выше относится к исходному test input, product JS после него
не менялся. Старый64KiB prefix больше не выдаётся за persisted v1 file chunk.

Actual Chromium157/IndexedDB personal21/21 PASS. Plan содержит точные complete
raw hashes, cold reopen сохраняет ciphertext, failed prefix имеет настоящую
outbox chunk row, retry использует новый ID и сохраняет failed rows. Console:
один ожидаемый HTTP409 resource error,0 warnings; profile закрыт после PASS.
Это synthetic registry/loopback/authenticated client, не настоящий OAuth/
production backend или clean-device recovery. Project/space проверяются отдельно.

Native wire3 ownership/manifest прошли WebCrypto на API26 personal и API34 всех
трёх kind, включая независимо восстановленные host raw bytes. Изначальный host
assertDeepEqual неверно сравнивал ordinary context object и safe null-prototype
snapshot: исправлен только prototype-normalizing comparison, все поля остаются
строго проверенными. API26 project/space metadata были очищены очередным QA
pm clear до копирования; отдельный replay одного export case восстанавливает
эти synthetic artifacts. Это не новый distinct product case. Final evidence
и lint добавляются после завершения. Все credential groups возвращают PIN в NONE.

## Оставшиеся условия

Authenticated original-root custody без переноса прежнего private signing key,
чистое recovery, полный mixed history/process collector и bounded WebView input,
все11 оставшихся real sources, обычные writers/unlock/enrollment, atomic shared
ACL/independent-root rotation, files/Drive, signed3.3.5→3.3.6 и48 системных сценариев
с14-language semantic/visual acceptance остаются обязательными. Внутреннее AI
review не называется независимой человеческой экспертизой. Личные устройства,
Google Play и production этим increment не меняются.
