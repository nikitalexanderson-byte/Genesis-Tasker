# Membership atomic v2 — кодовый этап

После 31f967ed добавлены общий TS-контракт страниц, согласованный PHP-кодек,
неизменяемое серверное хранение manifest/pages и постоянные cancellation tombstones.
Веб-транспорт и оба native HTTP-адаптера получили begin/page/status/cancel.
Общий pure runtime Android умеет собрать тот же manifest из проверенного snapshot
и сверяет review fingerprint; ключи, дисковое хранилище и сеть этому каналу не даны.

Каждая страница имеет индекс, тип, полный count и SHA-256 от established canonical
encoding. SQL ACL fields остаются name/value records с точными UTF8 bytes.
До 200 элементов/512 KiB на страницу; adaptive paging не отбрасывает остаток.
Manifest связывает actor, intent, space, review fingerprint, полный sorted scope set
и упорядоченные ссылки на страницы. Plan/change/batch hashes разделены.

Staging требует подписи текущего owner device активного personal scope, точного
payload/action, directory checkpoint и security epoch. Запись страницы не меняет
ACL, не применяет product command и не принимает чужой root как доверенный.
Идемпотентный повтор допускает только прежний hash; другой content того же индекса
отклоняется. Status читает только страницы hash/count, до 200 за запрос.

Cancel сериализуется тем же SQLite writer lock, что и final применение. Tombstone
может быть записан до begin, чтобы поздний begin/page не восстановил отменённый
intent. Изменённый plan hash не может занять тот же actor/intent. Оригиналы страниц
при отмене не удаляются. Завершённая операция должна возвращать прежний receipt,
а не объявляться отменённой после применения.

## Текущее состояние кода

Добавлен исходниковый server atomic writer и migration138 с immutable paged
receipts. Manifest теперь также содержит operation header и paged grants; старый
plan без operation final apply отклоняет, ничего не достраивает и не переподписывает.
PHP независимо собирает текущий graph/root/ACL snapshot, сверяет review fingerprint
и рассчитывает normal role/remove/grants/category effects по matching pure rules.
Все ACL/effects/anchors и полное замыкание scopes должны совпасть с планом. Под
одним writer выполняются точные product-bound commits, ACL, отзывы приглашений/
старых Google projection links и owner rotations; ошибка откатывает всю операцию.
Подписанный foreign writer может передать bound product packet как relayed
operation; его фактический user/device остаётся в product proof/receipt. Это
требует полного v2 review и verified client attribution, которые ещё нужно
подключить. Retained packet readers принимают подтверждённого pinned writer;
они не выполняют его packet. Legacy audit/automation/notification mutation helpers не
вызываются; role events сохранены в подписанном manifest, normal private history
и readback должны быть подключены на клиенте.

Lost-response commit возвращает только прежний outcome при точном commit request
hash и ещё действующем personal owner device. Новое применение требует свежие
anchors. Отдельные read-only receipt/page routes возвращают сохранённый результат,
не применяют и не renew исходную операцию. Этот код не запускался; server planner
parity, full rollback, multi-owner relay, lost response и все native/web paths
ещё предстоит принять. Snapshot/native/local-record bounds всё ещё явные; их
нельзя выдавать за завершённый streaming очень больших graphs.

Добавлен account-scoped durable stager web/native: полный manifest и отдельные
immutable local pages сохраняются и читаются обратно до первого HTTP. Каждый
staging request получает один сохранённый signed packet; unknown outcome не
порождает новую подпись или новый план. Перед следующим запросом перечитывается
cancelRequested. Cancel сохраняет намерение до HTTP, точный cancelled outcome
фиксируется локально; committed/неожиданный результат требует отдельного review.
Закрытие account/session отзывает capability. Новые typed custody readers
сверяют header/page/request связи и подпись по историческому pinned personal
directory, сохраняя interrupted ready=false страницы как inert originals.
Старые membership packets остаются отдельным v1 форматом.

Добавлен packet-page coordinator на web/native,
immutable packet manifest в migration137 и storage-only seal endpoint. Полные
local packet pages сохраняются/readback до HTTP; bind collector проверяет exact
plan hash, все scope rotations и declared product operations/anchors. Сервер
перед seal заново читает все plan/packet pages по одной, сверяет индексы/count/
hashes и закрывает insert новых страниц триггером. Retry сохраняет исходный
packet. Retained custody читает также packet manifests/pages, проверяет full
binding и подписи по существующим pinned history; foreign owner не превращается
в доверенную authority из одного paste. Ни seal, ни custody команды не применяют.

Клиентский stager выполняет **staging/cancel/seal/preview**; отдельный durable
apply coordinator и normal readback adapters описаны ниже. V2 owner review и
normal UI ещё требуют подключения.
Native codec/stager написан как
matching Kotlin implementation общего wire/local формата; differential acceptance
ещё предстоит. Pure atomic planner по-прежнему использует общий runtime. Новые
control outboxes не добавлены в content-only export и не исполняются при restore.

Web/native получили строгие matching receipt/page codecs, отдельные apply/read
authorization actions и HTTP routes.
Server preview применяет только verified ACL rows внутри временного writer,
возвращает bounded страницы с user/device/role и всегда rollback. Клиенты
сверяют полное отсутствие пропусков индексов, hashes и исходные anchors; такая
страница сама не выдаёт trust/pin или согласие владельца. Native/web custody
также понимает точный saved preview request.

Добавлены matching signed-origin/receipt verifiers: каждый rotation/product
packet сверяется с independently pinned directory frame и реальным user/device,
complete plan/packet hashes и следующим signed membership event. Hypothetical
approval не сохраняется как observed history. Receipt collector требует все
страницы, exact command/actor/revision/hash/checkpoint и обязательные callbacks
normal scope/product repository readback; partial response не даёт finish.
Это отдельный verifier без signer/POST/keys. Не считать наличие интерфейса
callback за прошедшую normal readback-проверку.

Добавлены durable apply coordinators и реальные foreground web/AuthController
adapters. Final consent имеет отдельный v2 fingerprint от planHash/batchHash и
сохраняется до первого final signer/POST. Signed requests и receipt pages имеют
immutable local records/readback. Unknown final outcome повторяет сохранённый
POST без повторного begin/staging уже committed плана; cancelRequested допускает
только read-only reconciliation. Receipt сохраняется до readback, complete —
после всех signed proofs, normal pinned root/index/decrypted product reads и
точного readback итоговых ACL. Закрытие account/session/foreground отзывает
capability; поздний ответ не создаёт новый intent. Retained readers понимают
apply/request/partial receipt originals, а complete evidence связывают с observed
signed membership frame и фактическим foreign writer. Они не исполняют outboxes.

Новые ordinary role/member UI и v2 owner full effects review пока не соединены
с этим path. Не принимать прежнее v1 review за новое согласие. ConfirmPrepared получает исходный signed bound packet и проверяет его hash
в normal signed index. При законном более новом head он запрашивает ровно исходную
историческую revision, проверяет её signed proofHash и immutable encrypted body
против сохранённого draft. Новый head не перезаписывается и не rebased. Итоговый
ACL всё ещё требует ожидаемое текущее состояние; поздние ACL-изменения должны
показываться как explicit divergence и пока требуют отдельного resolution. Код не компилировался и не
тестировался; эти модули не повышают accepted coverage.

## Остаток подключения

- Приёмка historical receipt readback при законном более новом head и semantic
  resolution поздних ACL-изменений; normal adapters, coordinator и server
  writer/planner ещё не проверены.
- Owner review/exchange полного v2 effects manifest и проверенная attribution.
- Обычные role/remove/grants/category/invitation UI и stale outcome/resolution.
- Потоковый capture очень больших graph/ACL input без ограничения общим размером
  одного native runtime input; существующий bounded runtime не считается такой
  реализацией и не должен молча отбрасывать строки.

Это source-only foundation. Compiler/lint/tests/build/CI для security-кода не
запускались. Coverage остаётся 9/20; normal membership не объявляется готовым.
Новый security-код не опубликован. Production 3.3.5/149, floors0/cutover off и
GENESIS_DEPLOY_ANDROID=false сохраняются. Срочный отдельный веб-кандидат #43
проверяется в sibling checkout без этих исходников.

## Постраничное owner review v2 (source-only)

Добавлены matching TS/Kotlin header/part codecs, полные effects collectors и
account/foreground encrypted owner stores. Header связывает все plan pages,
все preview recipient pages и все product packets; пропущенный suffix, duplicate
effect/entity, неполный scope set и v1 consent не дают approval. Подпись
сохранённого personal begin packet инициатора проверяется ключом его устройства
из независимо pinned shared directory; это не создаёт personal authority из paste.
User/device каждого получателя сверяются с текущим signed frame, actual product
writers — с signed bound commands. Для каждой owner scope отдельное согласие на
полный fingerprint и явный roster сохраняется/readback до root rotation; результат
сохраняется до export. Foreign approval paste сначала сохраняется unverified,
а verified relay требует подписи реального scope owner. Export после restart
возвращает исходный packet без повторной подписи или применения.

Web cloud-sync и Native AuthController получили foreground API; matching prepare
helpers собирают bounded exchange parts из durable stager. Typed retained custody
читает также partial owner inputs, а consent/verified evidence — все страницы
и independently saved directory histories. Исторический collector разрешён только
для read-only custody, без signer/writer/новых pins; foreground approval требует
текущих anchors. Новые control records не добавлены в content replay.

Обычные role/remove/grants/category/invitation UI и composer effects → private
product edits ещё должны соединить этот path. Это не завершённый membership E2E.
Very-wide/native/local-record bounds и поздние ACL divergence/resolution остаются.
Никаких security compiler/lint/tests/build/CI не запускалось. Coverage9/20.

## Ordinary composer и semantic private effects (source-only)

Web/native ordinary composer now сохраняет reviewed draft, читает полный normal
index и все затронутые domain versions, stage-ит все deterministic local batches
до upload, готовит immutable versions и полный plan/owner exchange. Owner consent
и final consent остаются отдельными действиями. Final packet assembly использует
exact saved owner approvals и повторную проверку их подписей.

productIndexHash полного verified business index добавлен в root snapshots и
новые anchors; PHP пересчитывает его до final apply под тем же writer lock.
Concurrent create/update/tombstone, включая новую назначенную задачу, требует
нового review. Старый original без hash читается inert, но не достраивается до
новой authority. Общий pure effects composer меняет только назначение, category
permissions и immutable private role-history; related/files сохраняются.

Mandatory owner adapter дополнительно открывает original и proposed encrypted
versions своей scope через реальные normal repositories и сравнивает их с точными
normal effects. Raw writer signature недостаточна. Native использует тот же pure
validator через existing isolated runtime, без ключей/HTTP в renderer.
Stable createdAt взят из исходного сохранённого intent и входит в owner request.
Normal event UI показывает actual writer из signed proof; logical initiator
остаётся отдельным полем. Source-only, без compiler/tests/CI; coverage9/20.
