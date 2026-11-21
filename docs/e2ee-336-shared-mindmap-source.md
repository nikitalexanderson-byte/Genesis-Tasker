# Общие интеллект-карты: граница серверного чтения

21 ноября 2026. Серверный reader и исправление существующего write/source
fence. Это ещё не `project.mindmaps`/`space.mindmaps` adapters: coverage9/20,
production3.3.5/149, floors0/pilot/cutover off сохраняются. Web/native capture
session пока принимает прежние10 personal actions; новый action не подключён
к приложению и не означает готовую миграцию общих карт.

`legacy-shared-mindmaps` проходит обычный signed E2EE read dispatch. Live ACL
конкретного ресурса, owner account, current device/checkpoint/security epoch,
lease/migration/fence/sourceHash проверяются в одной SQLite writer transaction.
Personal scope, обычный читатель, чужой или истёкший lease не дают export rights.
Здесь нет чтения файлов, поэтому personal filesystem gate не используется;
прежние personal actions по-прежнему проходят его.

Read grants заданы отдельно от консервативного OR-based source inventory:

- Project читает только строки с точным исходным project_id. Space читает
  space-owned строки с явным null project_id; тела дочерних проектов не выдаются.
- Каждая версия сохраняет своё исходное владение, независимо от нынешней карты.
  Receipt связан с ТОЧНОЙ revision, а null означает пространство. Его нельзя
  подменить текущим project через COALESCE.
- Deletions требуют сохранённый scope sidecar. Отсутствующая или конфликтующая
  lineage, неизвестный conversion source и обнаруженные разные owners без
  исходной revision дают явный REVIEW_REQUIRED до чтения content.
- Conversion привязан к source map, а destination project/task остаются inert
  references. Они не разрешают читать ни source другого проекта, ни destination
  body. Неоднозначная conversion history сохраняется и блокирует экспорт.

Reader выдаёт все retained versions, без UI-предела20. Страницы ограничены128
строками/8MiB, declared inventory —10000 строк. Точные старые stored content и
opened OLD originalJson передаются вместе: BOM/whitespace/private fields не
проецируются через новый JSON object. Глобальный server key не выдаётся.
Недоступное старое шифрование даёт fixed error; raw originals не изменяются.

## Два дефекта, воспроизведённых при внутреннем review

Первый непринятый draft отбирал conversion по destination project. RED02
показал чужой source-map reference и отсутствие собственных space conversions.
Исправленный reader использует проверенную source lineage. Это дефект grant
для metadata; тест не доказывает утечку map body или эксплуатацию production.

Отдельный RED04 воспроизвёл настоящий пробел существующего v3 fence: UPDATE
receipt старой версии перенесённой карты допускался при активном lease исходного
проекта. Destination-only conversion fence имел аналогичный пробел. Deny/hash
inventory теперь учитывает exact old revision и все retained source owners;
расширение НЕ используется как разрешение читать тела.

Marker `e2ee-fence-v4` атомарно переустанавливает существующие persistent
триггеры при следующей штатной инициализации. Старые markers/история/данные
сохраняются; rollback БД не выполняется. Изменение source-token computation
может потребовать повторного reconciliation старого attempt вместо его
продвижения с прежним hash. Flags миграции в production остаются выключенными.

## Проверка и пределы

`runtime/shared-map-conversion-red-02` и `shared-map-fence-red-04` сохраняют
исходные отказы тестов. Green05 прошёл6 связанных серверных наборов. Затем
`runtime/shared-fence-full-06/results.json` подтвердил все25 E2EE PHP suites,
0 failures, на actual свежей SQLite schema через изолированный backend runner.
Новый shared suite имеет338 cumulative assertions, из которых228 принадлежат
включённому базовому store suite; это не338 новых сценариев.
Incremental07 дополнительно проверяет подписанные wrong fence/sourceHash/
migrationId в обоих scopes:344 cumulative assertions (228 базовых), PASS.

Проверены signed dispatch, project/space/null/moved lineage, неподписанная смена
offset, outsider, expiry, неизвестные sidecars/receipts/conversions и отказ до
corrupt-body opening. Generated25 больших versions проходят несколькими
страницами с более12MiB originalJson, без изменения legacy inventory hash.
Persistent guards запрещают UPDATE обоих retained-original случаев; после
expiry изменение такого receipt меняет sourceHash. Старые v1/v3 markers и
stale trigger проходят реальный upgrade доv4. Full JS2058/2058 и static web build
также PASS; личные устройства и production не затрагивались.

Это PHP/store acceptance, не browser/native HTTP integration нового action,
подключение источников, полноценная recovery/custody или продуктовая приёмка.
Консервативная проверка metadata всего содержащего пространства может блокировать
экспорт из-за неоднозначной старой lineage другого ресурса. Записи сохраняются;
нельзя обходить такой отказ фильтром и объявлять пустую/полную историю. Полная
категория требует client adapters, local originals, bounded common reader и
сведения всех сохранённых attempts. Полный release gate остаётся открытым.
