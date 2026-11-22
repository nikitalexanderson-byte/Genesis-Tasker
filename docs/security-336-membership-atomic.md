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

- Финальный atomic writer: полная сверка graph/root/ACL anchors и всех effects,
  product-bound packets, приглашений/Google projection revocations, затем owner
  rotations с manifest уже загруженного ciphertext, под одним lock.
- Immutable packet manifest, paged receipt/readback и durable client coordinator;
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
