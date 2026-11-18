# Реальный источник Стойхейона для3.3.6

19 ноября2026. Подготовка web/API/Android, без production activation.

`PersonalStoicheionSource` читает фактический owner-scoped журнал практик,
включая прежние immutable snapshots каждого writer. Снимок до сети содержит
точные storage bytes, legacy key, generation и обязательное mounted состояние.
Позже координатор сохраняет его под новым root; сам capture не выполняет ACK,
drain или запись в legacy. Неоткрытые writers также включаются. Guest draws без
owner attribution не присваиваются аккаунту; локальный reveal index выбирается
только по точному owner prefix. Индивидуальные черновики редактора практик в
общем draft store относятся к обязательному отдельному `personal.local-work`.

`RestorationRepository.captureMigrationState` снимает текущий document/base/revision
без сети. Доменный merger вынесен в чистый `stoicheion-restoration-merge.ts`:
headless source не импортирует session/HTTP/storage side effects репозитория.
При свёртке используются настоящие validators и трёхсторонний merger. Latest head
каждого writer участвует в итоговом document; прежние reflection/base/mounted
copies сохраняются как переносимая история. Подтверждённый tombstone не оживляется
из старой копии. Unknown/lossy формат, конфликт, rollback revision, pending reset
или изменившийся previous attempt блокируют complete и сохраняют originals.

`legacy-stoicheion` использует существующий подписанный `/e2ee/v1/read`. Под тем
же SQLite writer проверяются personal owner/resource, trusted current device,
directory checkpoint, live migration lease/fence и точный source token. Читаются
только owner rows шести реальных таблиц: workspace, daily/spread draws, spread
cards, timeline draws/sessions/windows. Сервер не вызывает обычные GET helpers:
они могут создавать session/reveal записи. Новый read не меняет содержимое.
До10000 исторических rows и16MiB суммарного ответа; сверх лимита явная ошибка.

Выбираются seed/card/revision/date/reflection/reveal-history content. Attempt
counts, unlimited/canReroll, live deadlines, subscription/payment/identity/tokens
не являются переносимой authority. Клиент нормализует также реальный native
draw cache и текущие display-only записи; derived allowances удаляются. Saved
spread cards проверяются на уникальность, допустимые IDs и связь с исходным
draw. Timeline windows должны ссылаться на нужную session и идти по порядку.
Пустой cards_json означает настоящий прежний deterministic deal, а не потерю
карт или новый случайный расклад. История не выдаёт право нового переброса.

Новые content objects в домене `stoicheion`:

- `personal-stoicheion-workspace-v1`: сведённые практики и tombstones.
- `personal-stoicheion-local-history-v1`: все original/base/mounted documents,
  если они существовали.
- `personal-stoicheion-draw-history-v1`: server/device draw и reveal history,
  без live quota/payment authority.

`E2eeNativeStoicheionSource` снимает реальные encrypted Room documents, exact
originals, generation, неизвестные pending kinds/queues и mounted state. Старый
account key при наличии остаётся native. `NativePersonalSourceRuntime` использует
общий packaged TypeScript engine для Aurora или Stoicheion. Выбор source задан
native caller, output domain/object IDs отдельно ограничены bridge. Foreign
selector/snapshot, raw keys или output другого домена не принимаются. Включённые
отдельные `NativeAuroraSourceRuntime`/`NativeStoicheionSourceRuntime` выбирают только
свой domain. Общие chunking, network/storage/file denial, job binding и
cancellation/drain сохраняются. Новые roots/private device keys не передаются.

Factory привязана к owner/session/UpdateGate. Полный unlocked device/vault
lifecycle, все editors/writers, registry и durable migration fence обязан дать
будущий product coordinator. Наличие source factory не включает миграцию.

## Приёмка инкремента

Focused web source/coordinator/native-entry suites:53/53 PASS;
`output/release-3.3.6/runtime/stoicheion-coordinator-js-01.log`. Интеграция с реальным
`E2eeMigration`, vault и обычным `E2eeScopeClient` проверяет durable snapshot
до source IO, отсутствие plaintext/legacy key в сериализованном storage/server,
чтение практик и старой reflection под новым root. Остальные registry paths в
этом тесте synthetic; он не заменяет whole-product acceptance.

PHP/SQLite5/5 suites PASS: actual new Stoicheion read, workspace/Aurora/shared-store
и cross-platform transport; `runtime/backend-stoicheion-source-final-03/`.
Проверены подписанные requests, точные whitelisted поля, owner/lease/signature/
revocation, повторное read без content mutations, отсутствующий key, пустой
source, oversized history и запрет personal read через shared owner ACL.
10 реальных signed web/native transport packets проходят серверную проверку:
pagination accepted, stale source tokens отвергаются. Первый запуск обнаружил
различие false/null у отсутствующего PDO row; исправлен product код, исходная
проверка empty/no-key оставлена. Логи в `output/release-3.3.6/`.

- QA APK/test APK и18/18 focused JVM PASS:5 Stoicheion source,5 Aurora source,
  8 migration.0 failures/errors/skips; `native-stoicheion-source-build-01.log`.
- API34 actual Room/AndroidKeyStore/packaged engine:6/6 PASS,3 новых Stoicheion и3
  Aurora regression; `native-stoicheion-source-api34-01.log`. Native source
  сохраняет40 реальных day records и практику с reflection. Snapshot сначала
  durable encrypted в SQLite vault; readback после очистки fixture old key bytes
  использует новый root. Конфликт practice edits и actual account deactivation
  блокируют completion; exact original Room ciphertexts совпали до/после.
- 2/2 real API34 UI regressions: offline Aurora reopen и SAF encrypted backup;
  `native-stoicheion-source-ui-regression-01.log`.
- 1466/1466 full JS,0 skips: `frontend-stoicheion-source-full-01.log`.
- Typecheck/lint/web build PASS: `stoicheion-source-typecheck-02.log`,
  `stoicheion-source-lint-01.log`, `web-stoicheion-source-01.log`.

Все runtime logs — `output/release-3.3.6/runtime/`. Instrumentation использует
synthetic legacy server response; настоящий signed PHP transport проверен
отдельно. Новый source headless и не меняет UI. Это отдельный QA package/debug
signing с metadata3.3.5/149, а не signed3.3.6 или direct upgrade acceptance;
личные устройства не изменялись.

Реальные adapters теперь реализованы для3/20 paths: workspace, Aurora и Stoicheion.
Product routing/lifecycle и source review UI ещё обязательны для каждого из них.
Остальные17 paths, clean-client recovery/direct upgrades,48 сценариев/14 языков
и независимый crypto review остаются условиями готовности. Production3.3.5/149,
GENESIS_DEPLOY_ANDROID=false, floors0 и cutover off сохраняются.
