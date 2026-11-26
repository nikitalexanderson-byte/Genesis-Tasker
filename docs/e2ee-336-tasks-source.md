# Personal tasks: подписанный read-only migration source

Продолжение19 ноября: реальные web/native adapters и их source/new-root acceptance
описаны в `e2ee-336-tasks-client-source.md`. Актуальный real-source coverage5/20;
это не product activation или публикация3.3.6. Ниже сохранён исходный срез
server/transport этапа и обнаруженные тогда client boundaries.

19 ноября2026. Это серверная часть следующей категории, не готовый web/native
adapter и не product activation. Реальных source категорий по-прежнему4/20.
Production3.3.5/149, floors0, pilot/cutover off, Android deploy false.

`legacy-tasks` проходит тот же signed-command/device/owner/security epoch/
checkpoint gate и writer transaction, что предыдущие источники. Read разрешён
только current personal owner/resource и действующему migration lease с точным
migrationId/fence/sourceHash. Чужой аккаунт/shared scope/revoked device/подмена
подписи/истёкший lease/отмена не получают источник. Проверка sourceHash и сами
SELECT выполняются под одним SQLite writer lock.

## Точный охват

- Все task content columns, включая Gregorian/sacred date carriers, recurrence,
  completion/reminder data, project/category references, tags и old Google IDs.
- Deletions и actor-owned dependency references без join к чужому task content.
- Зашифрованные recovered task records и их tombstones с revision/IV/ciphertext.
- Exact creation state strings и creation-target history, включая прежние
  provider/recovery operation identities и attempted marker.

Все7 таблиц ограничены user_id=current actor. Имена SQL tables/columns/order
заданы литералами. User identity, sessions, provider tokens, billing/ACL не
выбираются. Nullable integers остаются null. Raw JSON/state/IV/ciphertext не
нормализуются и не перезаписываются. Read не вызывает ordinary task bootstrap,
Google/Yandex requests, восстановления/создания задач, drain/acknowledgement
очередей или очистки receipts.

Прежние external-operation identities — private history, **не разрешение
исполнить внешний запрос после import**. Будущий client adapter должен сохранить
происхождение/состояние и отдельный consent boundary для внешних copies.
Старый server-known key возвращается только когда recovered ciphertext его
требует. Нового root/DEK сервер не получает. Missing/corrupt old key останавливает
read; client-mode key остаётся только на клиенте. При отсутствии ciphertext даже
имеющийся старый account key не включается в ответ.

Общий предел10000 rows/16MiB encoded JSON даёт явный отказ вместо урезанной
истории. Это не поддержка streaming большой истории; large-source recovery
ещё требуется в общей приёмке.

## Проверки

Isolated PHP/SQLite fixtures, не production data:

- `runtime/backend-tasks-source-01/`:9/9 suites PASS. Task source, Advice,
  Aurora, Stoicheion, legacy/signed transports, schema, shared/store regressions.
- После расширения именно task tests:
  `runtime/backend-tasks-source-02/`:1/1 suite PASS. Exact actual-schema columns,
  nullable recurrence/reminder fields, deletion/link/recovered/creation history,
  отсутствие foreign content, key minimization, malformed/missing key, empty
  account without key creation, all7 write fences, signed lease/device denial,
  expiry/source mutation,10000+ rows и oversized Unicode JSON.
- Повторный read идемпотентен. SourceHash и исходные rows неизменны; допустимо
  только штатное technical no-op при захвате writer transaction.
- Оба actual signed ports теперь имеют `legacyTasks` с exact owner/scope/
  migrationId/fence/sourceHash и current checkpoint/device checks. Web39/39
  migration tests, scoped lint/typecheck/web build PASS. Native main compilation
  и8/8 migration JVM PASS,0 failures/errors/skips:
  `runtime/native-tasks-transport-jvm-01.log` (5m45s).
- Итоговый полный JS regression1492/1492 PASS:
  `runtime/frontend-tasks-transport-final-full-02.log`.
- Обновлённые fixtures созданы actual Web Crypto и JCA ports, а не ручной
  подстановкой signature. PHP проверил14 packets обеих платформ и отказал всем
  устаревшим source tokens: `runtime/backend-tasks-transport-03/`,6/6 suites PASS.
  Authenticated HTTP с real task source/reconciliation этим не подтверждён.
- `runtime/tasks-source-i18n-audit-01.log`: полный автоматический catalogue/native
  consistency audit14 языков PASS. Это не смысловая приёмка будущего UI recovery.

Web/native capture, task conflict rules,
offline outbox/tombstones, detached recurrence, new-root readback, clean recovery,
external-copy consent и полный product routing обязательны до учёта категории
как реализованного source adapter. Никакой production миграции или публикации
этим инкрементом не выполнялось.

## Обнаруженные обязательные client boundaries следующего шага

`cloud-sync.ts::readPending` не является безопасным source reader: он переносит
старый unscoped key в текущий owner и при malformed JSON возвращает пустой список.
`writePending` ограничивает историю последними2000 entries. Migration capture
должен читать exact raw owner keys/mounted state без этих writers и без
разрешения provenance по изменяемому last-user cache. Unscoped legacy bytes
требуют отдельного protected retention/review, а не присвоения текущему owner.

Native `CloudTaskSync.flush` использует прежние внешние Google routes, включая
uncertain creation receipts и acknowledgement после HTTP. Task source capture
не должен вызывать flush, обычный bootstrap или recovery helpers. Нужны whole
operation fences перед decrypt/IO/ack, native row revision/deleted/outbox capture,
все raw originals, conflict/deletion review и отдельное согласие на будущую
external copy. `server/src/personal-task-creation.php` сопоставляет operation
markers с уже авторизованным Google list; его исторические receipts не заменяют
это разрешение и не должны автоматически запускать новый POST при import.
