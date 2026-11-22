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

Cancel сериализуется тем же SQLite writer lock, что и будущее применение. Tombstone
может быть записан до begin, чтобы поздний begin/page не восстановил отменённый
intent. Изменённый plan hash не может занять тот же actor/intent. Оригиналы страниц
при отмене не удаляются. Завершённая операция должна возвращать прежний receipt,
а не объявляться отменённой после применения.

## Ещё не подключено

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
требует matching client custody/attribution и полного v2 review, которые ещё
нужно подключить. Legacy audit/automation/notification mutation helpers не
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

Следующий исходниковый проход добавляет packet-page coordinator на web/native,
immutable packet manifest в migration137 и storage-only seal endpoint. Полные
local packet pages сохраняются/readback до HTTP; bind collector проверяет exact
plan hash, все scope rotations и declared product operations/anchors. Сервер
перед seal заново читает все plan/packet pages по одной, сверяет индексы/count/
hashes и закрывает insert новых страниц триггером. Retry сохраняет исходный
packet. Retained custody читает также packet manifests/pages, проверяет full
binding и подписи по существующим pinned history; foreign owner не превращается
в доверенную authority из одного paste. Ни seal, ни custody команды не применяют.

Это пока **staging/cancel/seal**, без final apply, receipt/readback, v2 owner
review и normal role/invitation UI. Native codec/stager написан как
matching Kotlin implementation общего wire/local формата; differential acceptance
ещё предстоит. Pure atomic planner по-прежнему использует общий runtime. Новые
control outboxes не добавлены в content-only export и не исполняются при restore.

- Клиентские paged receipt/readback и полный durable apply coordinator;
  server writer/planner ещё не проверены.
  owner review/exchange полного v2 effects manifest и проверенная attribution.
- Обычные role/remove/grants/category/invitation UI и stale outcome/resolution.
- Потоковый capture очень больших graph/ACL input без ограничения общим размером
  одного native runtime input; существующий bounded runtime не считается такой
  реализацией и не должен молча отбрасывать строки.

Это source-only foundation. Compiler/lint/tests/build/CI для security-кода не
запускались. Coverage остаётся 9/20; normal membership не объявляется готовым.
Новый security-код не опубликован. Production 3.3.5/149, floors0/cutover off и
GENESIS_DEPLOY_ANDROID=false сохраняются. Срочный отдельный веб-кандидат #43
проверяется в sibling checkout без этих исходников.
