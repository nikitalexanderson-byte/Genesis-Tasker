# Реальный источник Авроры для миграции3.3.6

18 ноября2026. Подготовка, без production activation. Это второй реальный
web source adapter после workspace, а не подтверждение полного private coverage.

`PersonalAuroraSource` читает все сохранённые ветки текущего владельца, включая
неоткрытые редакторы и старые неизменяемые запросы одного writer. Снимок содержит
точные legacy storage bytes, старый ключ, поколение и обязательное состояние
открытого репозитория. Чтение не вызывает drain/ACK и не создаёт replacement key.
Factory в cloud-sync связана с владельцем, сессией и mounted capture callback.

Только после коммита защищённого снимка координатор передаёт owner/scope,
migration ID, fence, source token и новое поколение. `legacy-aurora` подписывается
обычным device key через существующий `/e2ee/v1/read`; web и Android transport
сверяют checkpoint/revision и состояние unlocked capability после ответа.

Backend под тем же SQLite writer проверяет personal owner/resource, trusted
device, текущий directory, live lease, fence и неизменность legacy source.
Выбираются только фактический `aurora_workspaces` и содержимое принадлежащих
владельцу `future_modeling_results`. Orders, payment authority, identity и tokens
не выбираются. Сервер открывает только историческую server-readable обёртку,
проверяет исходный result hash и передаёт точный solution JSON. Внутренняя старая
account-key обёртка открывается на клиенте. Это старый серверу известный ключ;
новый E2EE root этот маршрут никогда не получает. Отсутствующий ключ не создаётся.

Общий legacy personal helper сохраняет прежний контракт workspace. Групповой
owner не может читать личную Аврору через project ACL. Ограничения:10000 results,
16MiB combined response, текущий writer/source lease. Reads после activation,
чужой scope, изменившийся источник и некорректные envelopes блокируются.

Клиент использует настоящие Aurora codecs, validator, трёхстороннее сведение,
проверку prepared solutions/forecast hashes. Последняя ветка каждого writer
участвует в live document. Удалённая на сервере запись не восстанавливается из
устаревшего кеша. Все предыдущие pending/base, кеш и mounted copy сохраняются
в отдельной переносимой истории. Неполученные сервером inline results также
становятся отдельными объектами под новым root. HTTP metadata, старые raw keys
и payment authority в переносимое содержимое не включаются.

Конфликты одного session, непризнанные исторические форматы results, rollback
revision, несовпадающее поколение/restore и изменившийся предыдущий attempt
останавливают перенос для review. Они не объявляются пустыми источниками.

Проверено в изолированных synthetic fixtures:

- 47/47 JS: реальный Aurora adapter + migration coordinator. Интеграционный тест
  проверяет durable vault snapshot до source IO, отсутствие plaintext/key в
  сериализованном vault/server, открытие результата и старых веток обычным
  `E2eeScopeClient` под новым root; остальные registry paths в нём synthetic.
- Общая JS-регрессия1442/1442 без skips на этом инкременте:
  `runtime/frontend-aurora-source-full-01.log`.
- Native `E2eeMigrationTest`:8/8 JVM,0 skips/failures/errors;
  `runtime/native-aurora-transport-01.log`.
- PHP/SQLite4/4 suites: legacy-aurora, legacy-workspace, migration-transport,
  shared-store; `runtime/backend-aurora-final-02/`. Aurora suite содержит303
  cumulative assertions с workspace regression. Статические web/native vectors
  дают8 реально подписанных packets: pagination accepted, stale legacy source
  requests rejected. Shared owner read дополнительно запрещён.
- Typecheck, changed-file lint и web build PASS:
  `aurora-source-typecheck-final.log`, `aurora-source-lint-final.log`,
  `web-aurora-source-01.log`. Логи в `output/release-3.3.6/runtime/`.

Остаются native Aurora capture/reconciliation adapter, product enrollment/unlock,
migration/editor routing, review UI для конфликтов источников, остальные реальные
paths, clean-client recovery, direct upgrades,48 сценариев и внешний crypto
review. Native transport сам по себе не означает готовую native migration.
Production3.3.5/149, floors0, cutover off и выключенный Android deploy сохраняются.
