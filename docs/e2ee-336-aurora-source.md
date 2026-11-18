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

## Реальный native source и общий headless engine

19 ноября2026. `E2eeNativeAuroraSource` теперь снимает фактические Room rows
Авроры, все writer journals, старый account key, cache, generation и mounted
состояние. Exact encrypted originals и переносимые расшифрованные copies сначала
сохраняются координатором в ciphertext-only SQLite vault под новым root. Чтение
не создаёт старый ключ, не выполняет ACK и не меняет legacy rows. Неизвестные kinds,
очереди, изменившиеся previous attempts и generation останавливают сведение.
Factory `AuthController.e2eeAuroraSource` проверяет account/session/UpdateGate;
фактический device/vault lifecycle и общий migration fence ещё обязан предоставить
будущий product coordinator.

`NativeAuroraSourceRuntime` запускает тот же `PersonalAuroraSource` validator и
merger в отдельном headless WebView с фиксированным packaged origin. Network,
DOM storage, database, file/content access отключены. Нет bridge-методов записи,
HTTP или доступа к vault. Старые ключи остаются в native; новые roots/device
private keys в engine вообще не передаются. Keyless port принимает только
captured envelopes и разрешённый purpose, открывает старую AEAD-обёртку native
JCA и очищает временные key bytes. Попытка передать raw key блокируется.

Bridge связан со свежим job/owner/scope; ввод/RPC/результат передаются упорядоченными
chunks по128KiB с ограничениями размера и числа запросов. Закрытие/отмена/таймаут
инвалидируют capability, останавливают и дожидаются операций, уничтожают WebView;
непринятые result bytes очищаются. Chromium111 compatibility проверяется до
создания WebView. Gradle отслеживает e2ee inputs общего packaged engine.

Проверено на этом native инкременте:

- QA APK/test APK и focused JVM PASS:5/5 `E2eeNativeAuroraSourceTest` и8/8
  `E2eeMigrationTest`, без failures/errors/skips; `native-aurora-source-build-01.log`.
- API34 real Room + AndroidKeyStore + packaged WebView:3/3 PASS;
  `native-aurora-source-api34-01.log`.40 валидных sessions,2 immutable writer
  snapshots; durable encrypted vault capture перед legacy IO; readback под новым
  root после очистки fixture old key bytes; конфликт writers блокирует completion;
  деактивация app account во время opening останавливает engine. Exact originals
  сохранены. Legacy server response в этих3 сценариях synthetic; signed server
  transport отдельно проверен предыдущими suites.
- 15/15 focused JS: реальный скомпилированный native entry и mock native window,
  multi-chunk input/RPC/results, чужие/reordered packets, AEAD failure, повторный
  start и закрытие при pending open; `aurora-native-runtime-node-02.log`.
- 1454/1454 full JS,0 skips; `frontend-native-aurora-source-full-final.log`.
- 2/2 API34 UI regressions: реальный offline reopen Авроры и SAF encrypted backup
  с latest native bundle; `native-aurora-source-ui-regression-final.log`.
- Typecheck/lint/web build PASS: `aurora-native-source-typecheck-02.log`,
  `aurora-native-runtime-lint-03.log`, `web-native-aurora-source-final.log`.

Все логи расположены в `output/release-3.3.6/runtime/`. API34 emulator использовал
отдельный QA package/debug signing и metadata3.3.5/149; личные устройства не менялись.
Эти проверки не являются полной product migration или direct upgrade acceptance.
Остаются product enrollment/unlock, migration/editor routing, source conflict UI,
остальные18 реальные paths, clean-client recovery, direct upgrades,48 сценариев
и независимый crypto review. Production3.3.5/149, floors0, cutover off и выключенный
Android deploy сохраняются.
