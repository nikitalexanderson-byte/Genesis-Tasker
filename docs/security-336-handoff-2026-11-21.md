# GENESIS 3.3.6 — передача работы в новый чат

## 22 ноября: semantic resolution locked project preparation (кандидат)

После d682118c добавлен resource-create-resolve: под тем же SQLite writer lock
возвращает прежнюю preparation или сохраняет permanent semantic cancellation
receipt для original resource-create-prepare. Late original/renewed request с
тем же semantic payload больше не создаёт проект. Проект/область/история не
удаляются; отмена строго проверяет форму original topology, bootstrap authority
и текущий personal device, но не требует прежних anchors быть текущими.

Web/native journals сохраняют hashes/fixed resolver до IO и проверяют весь
result. Только cancelled допускает новые intent/resource/scope IDs с независимым
будущим root; coordinates сохраняются до нового input journal. Рестарт дописывает
тот же child. Полный input сохраняется, consent/anchors не переносятся. Pending
скрывает старую попытку только после проверки durable replacement. Recovery UI
имеет явный resolve action с14-language explanation; waiters переносят только
promise результата, не keys/secrets/input. После started обзор показывает IDs/
roles из encrypted review без зависимости от доступа к прежнему space context.
Content-only export сохраняет resolution hashes/receipt/lineage как inert data,
не bootstrap packets. Retained service custody понимает resolver originals.

Это исходники, без compiler/typecheck/lint/tests/build/CI/push/deploy/device/Play.
Coverage9/20, floors0/cutover off, GENESIS_DEPLOY_ANDROID=false и production
3.3.5/149/Paddle-сайт сохранены. Следующий большой участок: normal invitation
acceptance/member editing/device approval и all-owner membership/rotation UI.
Далее advanced shared/form attribution/automation/bulk/cross-scope, typed restore,
revoked replacement/background и interrupted-source/divergence review. Общий
кодовый этап продолжается; QA только после всего кода. demo-output/ не читать/
stage, субагенты/Daybreak запрещены.

## 22 ноября: обычное создание private project подключено (кандидат)

После eb87df2b добавлены web/native encrypted project input journals и composers
реально pinned/decrypted space/parent/category/status anchors. Обычные create
buttons теперь сохраняют полный input до IO, открывают явный participant/role
review, отдельно сохраняют consent и выполняют fixed preparation → migration →
actual product baseline → immutable root/status revision2 transaction → readback.
Обычный private project result читается до complete. Account pending/resume
перечисляет space и project, content-only archives включают оба типа input.
Общие copy/roles/default status titles добавлены на14 языках. Это routing review,
не device approval: ни preview, ни кнопка согласия сами не выдают keys/capsules.

Space/project preparation дополнительно разрешает потерянный response даже
если scope-setup journal уже complete после directory read: повторяется тот же
semantic service intent, receipt сверяется с exact bootstrap command hash.
Завершение space creation также перенесено после actual normal result read.

Код ещё НЕ компилировался/не тестировался. Coverage9/20 не повышен. Следующий
кодовый участок: semantic resolution/cancellation locked project preparation
после started=true, с сохранением original intent/packet, permanent tombstone
против поздних retries и явным новым review перед новой попыткой. Не retarget
старый bootstrap/ID. Затем остальные normal membership/invitation/device/rotation,
advanced parity/automation/bulk/cross-scope, typed restore/revoked replacement,
background и interrupted-source/divergence review. Не запускать общую QA до
завершения всего кода. Production3.3.5/149/Paddle-сайт сохранены, floors0/cutover
off/GENESIS_DEPLOY_ANDROID=false; никаких push/deploy/device/Play действий.
Субагенты/Daybreak запрещены, чужой demo-output/ не читать/stage.

## 22 ноября: reserved chaos-status source positions

После26070b3d при source inspection composition найден блокер старых/новых
project baseline: оба shared-domain readers запрещали position -2/-1 существующих
system chaos statuses. Внесён узкий typed reader: только exact chaos-open/done:
resourceId, project binding, is_chaos1, соответствующие is_done и positions.
Обычные positions остаются nonnegative integers; flags0/1 проверяются явно.
Это code-only fix, не QA. Следующий большой кодовый участок всё ещё project
creation journals + independently verified anchors + normal UI, как ниже.

Прочитано для следующего шага (не начинать заново): WebPrivateAccount имеет
scopeSummaries/contentScopes/shared/sharedRecords; shared-web-live.ts open()
ищет exact resource в E2eeSharedTrust.list(), вызывает trust.open(scopeId), затем
account.sharedRecords. E2eeSharedRecords даёт product.index/read, get(kind,id),
sourceTable и actual normal product writer. Space creation journal — образец в
private-resource-create.ts; composition в cloud-sync.ts completeCurrentPrivateSpaceCreation.
Native normal createSharedProject сейчас всё ещё sharedCall→legacy JSON API:
AuthController.kt около1436. Web createSharedProject около2865. Project UI
подключать только после encrypted pre-network input/preview/explicit review.

## 22 ноября: read-only project preview и реальные scope-client ports

После8836bb1c added signed personal-owner project-create-preview + реальные
web/native E2eeScopeClient.readProjectCreationPreview. Server inspect выделен
из verify: preview не создаёт placeholders/receipts/membership/scope/capability.
Actual prepare заново проверяет exact reviewedMembers и только после сравнения
материализует FK/capability. Client ports проверяют cp личной области, resource,
shape, same-scope anchors и неизменность selection. Контракты теперь отдельно
читают selection и proposal topology. Подчёркнуто: response reviewedMembers —
предложение routing, не согласие пользователя; UI должен хранить отдельный review.
Уточнены metadata2 ограничения task-list/inbox category, совпадающие в3 клиентах.

**Продолжать с project creation journals + actual UI**: оба encrypted input до IO,
независимо pinned/decrypted space/parent/category/status anchor composition,
read-only preview → explicit durable review → fixed signed preparation/receipt →
project migration + actual baseline → intended private root и localized statuses
с readback → complete/normal result. Подключить обычные web/native create buttons
и account pending/resume. Existing private-space journal/controller — рабочий
образец кандидата, не надо заново исследовать весь migration engine.
Подробности: security-336-private-resource-creation.md. Все предыдущие ограничения/
остаток сохраняются, no tests/compiler/lint/build/CI/push/release/device, coverage9/20.

## 22 ноября: signed fresh-project server preparation (кандидат)

После95e140a5 добавлена project-ветка resource-create-prepare:
GenesisE2eeProjectCreation проверяет current space/parent/category/status anchors,
metadata2 ancestor topology, create/write permissions, отсутствие цикла/inbox/
archive и exact sorted reviewed inherited members. Capability привязана к PDO/
transaction и потребляется после fresh inheritance. Существующий factory
сохраняет feature/space-owner quotas/creator owner/defaults; теперь получает
только технические placeholders. Scoped restricted inheritance не переиндексирует
и не изменяет старые проекты/назначения. Это routing rows, не device/capsule trust.
Rows + independent bootstrap + semantic receipt атомарны. Project receipt содержит
topologyHash, placement, exact statuses{id,isDone,isChaos}, reviewedMembers иcp1.

Fencev8 разрешает exact rows ещё для shared_space_project_categories. Current
private category/status heads создают недостающие FK placeholder rows без
вывода title/colour/order. Старые строки сохраняются и проверяются по lineage.
Web/native project-create-contract / E2eeProjectCreationContract и service custody
теперь явно понимают новый payload; bootstrap keys/authority всё ещё проверяются.

**Точный следующий код**: read-only recipient/topology preview пока отсутствует;
нужны обе durable private-project creation journals, независимая проверка anchors
и явный review до подготовки, fixed payload/receipt, migration + actual product
baseline, private intended root и localized status values с readback, normal
create/resume buttons/account pending list. Не переподключать обычный project
create к plaintext API после personal cutover. Space journal уже работает как
кандидат; его нужно расширить/сочинить project counterpart, сохраняя original input.
Документ и точная форма серверного payload:
security-336-private-resource-creation.md, server/src/e2ee-project-create.php.

Никаких compiler/typecheck/lint/tests/build/CI/push/release/device actions;
coverage9/20, floors0/cutover off/GENESIS_DEPLOY_ANDROID=false.3.3.5/149/Paddle-сайт
сохранены. Остальной большой кодовый остаток ниже остаётся. Не читать/stage чужой
demo-output/, не использовать субагентов/Daybreak.

## 22 ноября: foundation fresh project topology / exact row capability

После07dd5e35 добавлены совпадающие web/native/API project metadata2
(space/parent/category/board/kind/layout/inbox/archive) и сравнение с decrypted
body. Старый metadata1 project header явно читается как история без topology
authority, старые originals/jobs не выбрасываются. Persistent fencev7 разрешает
только exact full before/after row capability для shared_projects/statuses через
отдельный connection-local WeakMap, в transaction и с finally cleanup; SQL
callback не запрашивает БД и не принимает boolean request bypass. Четыре ACL
таблицы/полный membership rotation protocol не расширены и не ослаблены.

В actual normal root commit теперь подключён e2ee-project-topology.php:
синхронизация только signed technical category/board/layout/archive, private
category/status heads, parent access/restore quota; односторонняя смена parent/
kind/inbox запрещена. Live topology reader требует exact undeleted metadata2
root + active product bootstrap + совпадающий SQL tuple, без legacy fallback.
Это foundation; factory/signed preparation/inheritance и обе обычные кнопки
создания projects ЕЩЁ не подключены. Точный следующий участок и ограничения:
security-336-private-resource-creation.md. Нужны all-scope parent operation и
оставшиеся delete/restore quota/trash lifecycle semantics. Остальной остаток ниже.
Код не компилировался/не тестировался; coverage9/20,3.3.5/149/Paddle/floors0/
cutover off/GENESIS_DEPLOY_ANDROID=false сохранены. demo-output/ чужой, не читать/
stage. Субагенты/Daybreak запрещены.

## 22 ноября: lost-start cancellation и постоянная отмена attempt (кандидат)

После06103b46 добавлен новый code-only блок: schema135 permanent cancellation
tuples и SQL lease guards, signed migration-cancel-start с полным original
подписанным start, атомарное разрешение/operation tombstone и отмена только
matching lease. Новые start/resume не оживляют отменённый migrationId, обычный
expired lease сохраняет renewal. Shadow objects/прежние receipts сохранены.

В реальных web/native cancel flows raw state + fixed resolver сохраняются до
IO. Timeout/process death повторяет тот же packet; только полностью проверенный
результат позволяет clear live pending. Оба пакета остаются типизированной
защищённой уликой startCancellation в прежних1/2/4 journals. Узкий старый
cancelled/no-lease/start-pending допускает только custody/resolution, не restart/
run/barrier release. После resolution перепроверяется ownership graph, затем
existing controller требует fresh preparing directory. Active/другая текущая
миграция сохраняет границу.

Подробности/обязательные будущие races: security-336-retained-migration-history.md.
Код ещё не компилировался/не тестировался; coverage9/20. Общий кодовый этап,
fresh project/member/device/automation/restore/background и changed-prefix/domain
divergence review остаются.3.3.5/149 и Paddle-сайт сохранены, floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false. Push/deploy/CI/build/device не запускались.

## 22 ноября: возобновление прерванного local source-stage (кандидат)

Web/native теперь аутентифицируют все записанные prefix parts отдельно от
логического EOF, открывают прежний journal с исходным actor/target/CAS serial и
повторно сверяют producer со всеми сохранёнными байтами, включая complete paths.
После совпавшего prefix дописываются только новые immutable parts; сохранённый
короткий хвост нельзя расширить или заменить. Account-wide ownership proof
признаёт эту точную quarantine-роль, не пропуская неизвестные remnant cells.
В reconciliation/publication по-прежнему входят только полностью завершённые
paths/manifests с transactional catalogue CAS. Последний resumed journal
используется повторно без ещё одной полной копии.

Документ: security-336-retained-migration-history.md. Это только код; общие
QA/compiler/typecheck/lint/build/CI ещё не запускались, coverage9/20.
Changed-source prefix/divergence review и ambiguous legacy cancel ещё требуют
реализации, как и большой остаток fresh project/member/device/automation/restore/
background ниже.3.3.5/149 и Paddle-сайт сохранены; никаких push/deploy/device
действий. Не читать/stage чужой demo-output/.

## 22 ноября: normal native Messenger journal (кандидат кода)

После3d411176 добавлен `data/MessengerJournal.kt` и подключён к обычному native
MessengerRepository/Screen: owner/conversation/kind binding, stable draft token,
durable edit target/base revision, explicit legacy draft/pending readers,
строгое receipt/readback, done/recovery markers до cleanup и сохранённые inert
originals. DELETE не очищает независимый текущий черновик. Explicit copy recovery
требует fresh existing-create/advanced-CAS proof, а не любого409. UI write/send
больше не используют необвязанный delayed draft callback.
Документ: `security-336-native-messenger-journal.md`. Код не компилировался и не
тестировался; coverage9/20, общая приёмка только после завершения кода.

Следующий участок — interrupted source-stage capture/legacy-cancel/divergence
review; остальной большой остаток ниже остаётся, особенно fresh project
topology/inheritance, membership/device/invitation UI, automation/bulk/cross-scope,
typed restore/revoked replacement/background. Никаких push/deploy/CI/build/device
действий.3.3.5/149 и Paddle-сайт сохранены. demo-output/ не читать/stage.

## 22 ноября: native shared-message файлы переведены на новый handoff

После6e88a5b9 добавлен непроверенный код реального native MessagingScreen:
protected intake/output selection до picker, transient URI-only handoff над
vault gate, свежий repository после unlock, строгие conversation/draft/key pins,
source/part hashes до chunk IO, same-source/nonce/ciphertext resume, сохранение
оригиналов и displaced drafts, явные defer/restore/copy UI и14-language copy.
Сохранение файла проверяет исходный message seq/revision/file и использует общий
bounded prefix/readback writer. Archive/message input/message output разделены
purpose; старые прямые plaintext provider callbacks удалены из этого экрана.
Описание и реальные границы: `security-336-native-message-attachments.md`.

Ещё остаются normal Messenger durable edit/exact-command recovery и детали
старого shared-message conflict recovery, а также общий прежний остаток:
fresh project topology/inheritance, membership/invitation/device UI, advanced
parity/automation/bulk/cross-scope, typed restore/revoked replacement, background
и interrupted-stage/legacy-cancel/divergence. Общий кодовый этап продолжается;
QA/compiler/lint/build/CI не запускались. Coverage9/20, floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false; production3.3.5/149 и Paddle-сайт сохранены.
Субагенты/Daybreak запрещены, demo-output/ чужой — не читать и не stage.

## 22 ноября: fresh-space create/resume подключён (непроверенный код)

После shared controllers2c1d3ba2 добавлена реальная web/native композиция обычной
кнопки create space: encrypted input до IO, независимый recovery dialog,
space+inbox transitions, actual product baselines, immutable private initial
root/revision2 с readback, фиксированные pending invitation IDs/receipts/readback.
Незавершённые creation inputs перечисляются/возобновляются в account security.
Приглашение не создаёт membership, device approval или key capsule; обычные
member/invitation/device-review UI ещё требуют композиции. Подробности обновлены
в `security-336-private-resource-creation.md` и implementation-pass.

Далее: fresh project topology/inheritance и нормальная membership/invitation
композиция; также остаются advanced parity/automation/bulk/cross-scope, typed
restore, revoked-device replacement, native attachments/background и источники
с interrupted-stage/legacy-cancel/divergence. QA/compiler/lint/build/CI пока не
запускались по порядку владельца; coverage9/20.3.3.5/149 и Paddle-сайт сохранены,
floors0/cutover off/GENESIS_DEPLOY_ANDROID=false. Не читать/stage demo-output/.

## 22 ноября: shared controllers подключены, далее полный create flow

Поверх223891fb добавлен кандидатный код web/native shared owner transitions:
повторное использование открытого owner device, active personal deny barrier
без ослабления при отмене child scope, полный matching source registry,
технический signed inventory старых ресурсов, recovery-signed shared setup,
реальные recovery/stop/cancel UI и private product bootstrap/readback.
Описание: `security-336-shared-migration-controllers.md`. Coverage всё ещё9/20;
compiler/typecheck/lint/tests/build/CI не запускались по порядку владельца.

Следующий кодовый участок — композиция сохранённого fresh-space intent со
space+inbox transition, private initial values, адресатами и create/resume UI;
затем project topology/inheritance, domain parity, automation/bulk/cross-scope,
typed restore, revoked-device replacement, native message files/background и
оставшиеся source-stage/cancel/divergence cases. Полная приёмка, исправления,
точное итоговое внутреннее крипторевью и раздельные выпуски ещё впереди.
Не читать/stage demo-output/, не использовать субагентов/Daybreak. Production
3.3.5/149 и принятая Paddle-витрина сохранены, floors0/cutover off и
GENESIS_DEPLOY_ANDROID=false. Разрешение полного выпуска уже есть.

## Следующий участок: общие migration controllers и создание ресурсов

Retained-history код сохранён локальным коммитом **9990d744** (32 files,1841
insertions). Проверки по порядку владельца ещё не запускались, coverage9/20.
Затем добавлен новый кандидатный код подготовки свежего private space:
`server/src/e2ee-resource-create.php`, web/native `E2eePrivateResourceCreation`,
новый signed service `resource-create-prepare`, транзакционная композиция
существующих shared-space factory/bootstrap и проверка этой роли в обоих custody
readers. Исходный prompt SHA256 по-прежнему
5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338.

Новый код пока не является работающим create UI: он сохраняет полный input
зашифрованно до сети и атомарно создаёт только технические space/inbox/status
rows и preparing scope, без передачи названия/описания/обложки/приглашений.
Реальные shared migration controllers, обе миграции space+inbox, private initial
values, участники и project topology — следующая конкретная реализация.
Подробный разбор уже существующих функций, persistent SQL fences и допустимого
направления: **security-336-private-resource-creation.md**. Не повторять поиск
с нуля и не пытаться обойти active-space fence обычным legacy-create.

No tests/compiler/lint/build/CI/push/release/device actions. Floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false;3.3.5/149 и Paddle-сайт сохранены. Не использовать
субагентов/Daybreak; не читать/не stage чужой demo-output/. Разрешение на полный
раздельный выпуск уже дано, внешний аудитор не нужен; итоговый внутренний review
точного финального кандидата остаётся после всего кода, QA и исправлений.

## Продолжение22 ноября: retained ownership и повтор перехода

Поверх HEAD485acdfd добавлен новый непроверенный код web/native: общий реестр
владельцев и ролей всех областей, полное чтение legacy v1/v2 plans, state4/5
preparation/adoption и control packets, настоящая retained source history,
подтверждаемая подготовка после отмены, явная проверка обычных product outboxes.
При замене обычного завершённого job сохраняется его исходный header; при renewal
Aurora сохраняется прежний packet. Оба content-only exporters теперь включают
читаемые пользовательские значения прежних планов как inert history.

Подробности: `security-336-retained-migration-history.md`. Это НЕ compilation/QA,
НЕ финальное крипторевью и НЕ приёмка релиза. Coverage9/20;3.3.5/149 и принятый
Paddle-сайт сохранены; floors0/cutover off/GENESIS_DEPLOY_ANDROID=false. Чужой
demo-output/ не читать/не stage. Тесты/compiler/lint/build/CI/push не запускались.

Точный остаток этого блока: legitimate incomplete source-stage capture пока
удерживает барьер; unresolved legacy start/no-lease cancellation требует явного
разрешения; divergent previous/current domain snapshots требуют review workflow.
Не обходить это префиксным фильтром, удалением originals или пустой подстановкой.
На общем QA проверить новую web/native композицию и стоимость повторного полного
чтения графа. Typed restore/revoked-device replacement ещё не реализованы этим
экспортом. Следующий кодовый участок — создание новых закрытых shared resources,
затем shared migration controllers и остальная parity/automation/background работа.

Историческое «cancelled state4 вообще не поддерживается» в нижних срезах заменено
этим новым кандидатным кодом и перечисленными конкретными ограничениями. Общая
приёмка всех 48 сценариев/14 языков/размеров/тем/API26+/149 upgrade, исправления,
точное внутреннее крипторевью и уже разрешённые раздельные выпуски ещё впереди.

## Кодовое продолжение22 ноября — поверх исторических срезов

Локальная ветка `codex/security-336`, кодовый HEAD `4f4bfd5f`. Добавлены пять
кандидатных коммитов после `4a87de8e`: `e8c581a8` (личные Drive-копии web/API/
Android), `66582ed1` (явная проверяемая отмена перехода в обоих интерфейсах),
`c933e9f0` (transient SAF для независимого ключа сообщений), `434c919e` (web
выгрузка текущих/исторических файлов), `4f4bfd5f` (native выбор назначения,
повторное разблокирование и проверенная выгрузка выбранных версий).
Все изменения сохранены локально. `demo-output/` чужой: не читать и не stage.
Новые security-коммиты не отправлялись и не публиковались.

Это **не проверенный релиз**: по порядку владельца общий тестовый этап ещё не
начинался; compiler/typecheck/lint/tests/build/CI не запускались. Coverage остаётся
9/20. Drive rollout выключен, действующая3.3.5/149 и принятая Paddle-витрина
`c29b76e33cc42160616b2df6f5eca61af94f6c63` сохранены. Floors0/cutover off,
GENESIS_DEPLOY_ANDROID=false. Оригинальный prompt по-прежнему имеет SHA256
`5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338`.

Новые документы: `security-336-drive-backups.md`,
`security-336-native-message-key-files.md`, `security-336-content-file-output.md`.
Новые секции общего журнала находятся сверху в implementation-pass.

Точный следующий кодовый остаток:

- Cancelled state4 пока нельзя безопасно передать в новый state3/source history:
  `prepareStagedLocked` и старый source-only reader его намеренно отвергают.
  Нужны полный аутентифицированный граф прежних владельцев/ролей оригиналов и
  планов и их чтение с EOF, включая все scopes. Не исправлять фильтром префиксов,
  ignore-list, удалением оригиналов или трактовкой отсутствующего/corrupt journal
  как «не начинали». UI отмены использует существующий signed cancel и оставляет
  барьер при любой неясности; полноценный restart этим не реализован.
- Полная shared domain/advanced parity, создание новых закрытых spaces/projects,
  membership/inheritance/roles/quotas и multi-owner rotation. Существующий server
  bootstrap требует уже существующий управляемый resource; нельзя вернуть
  plaintext legacy-create как обход после personal cutover. Общие контроллеры
  перехода и межобластная история требуют завершения до активации.
- Client automation/series, bulk/cross-scope transactions, advanced shared input
  attribution, typed normal-repository content restore, revoked-device replacement
  с сохранением originals и remaining reminder/background/deep-link paths.
- Native message attachment pickers/plaintext callbacks и полное durable staging
  черновиков/файлов, exact-command recovery старого shared-message UI. Новый
  NativeUserFileOutput уже даёт bounded cancellable prefix/readback writer, но
  эти пути пока к нему не подключены. Transient key-file handoff не является
  durable draft/file queue.

Известная адаптация тестового API для будущего общего этапа: из
MessagingRepository удалён старый raw `writeBackup`; существующие JVM случаи
MessagingRepositoryTest около190/204/214 ещё ссылаются на него. Перенести их на
фактическую новую handoff-приёмку с сохранением live-entitlement/late callback/
owner/lifecycle assertions. Не выдавать старые PASS за этот код.

После всего кода: общая приёмка и исправления (48 исходных сценариев,14 языков,
web размеры/темы, API26+,3.3.5/149 upgrade/recovery/concurrency/process death),
затем внутреннее крипторевью точного финального кандидата и уже разрешённый
штатный раздельный web/API и подписанный APK выпуск. Внешнее человеческое
заключение больше не требуется; не запрашивать разрешение выпуска повторно.

## Последнее уточнение21 ноября — приоритет над историческими gates

Владелец сообщил, что внешнего заключения нет, и поручил: «сделай ты этот ревью
и перепиши md что ты сам все перепроверишь в конце». Финальное крипторевью
выполняет этот же исполнитель после кода, общей приёмки и исправлений. Отдельный
внешний аудитор больше не является gate этого выпуска; не просить его повторно.
Результат называется внутренним AI review. План: `security-336-final-review.md`.
Все остальные проверки и границы выпуска сохраняются; исходный prompt не менять.

В последнем продолжении созданы локальные WIP-checkpoints ac386416 и6f3d2d2b:
recovery Keystore без замены прежнего контейнера, common shared advanced records,
fingerprint/baseline UI, exact completion review, signed history, реальные
encrypted task files и private queries. Всё ещё НЕ компилировалось/не тестировалось.
Новый uncommitted `app/e2ee/content-archive.ts` начинает local content-only capture
и inert import; полного backup/restore/Drive и native/UI composition пока нет.
Текущий git diff и ведущие разделы implementation-pass имеют приоритет ниже.

## Состояние по прямому указанию владельца

**Актуальное продолжение:** владелец возобновил работу в чате «Продолжить выпуск
3.3.6» и после короткой паузы снова поручил продолжать до выпуска. Полный исходный
промпт остаётся обязательным. Сначала весь новый код инфраструктуры и его реальная
композиция; только затем общий QA, корректировки и последующие release-этапы.
Тесты/сборки/публикации в новом проходе ещё не запускались. Историческая остановка
ниже не является текущим состоянием.

В новом проходе добавлен **непроверенный** код async feature-document driver,
web/native Авроры и immutable paid-result references, web ФЮЗИС, private prefs,
profile metadata cache и renewal enrollment. Добавляется инфраструктура общих
entity transactions/proposals/attestations с signed business intents и pinned
group trust. Новые файлы/миграции128/129 ещё не прошли compilation/QA. Все эти
изменения не повышают accepted coverage9/20. Текущий diff и журнал
`security-336-implementation-pass.md` имеют приоритет над историческим списком
«где остановились» ниже. Чужой `demo-output/` по-прежнему не читать/не stage.

Последнее согласованное правило работы: **сначала завершить весь код, затем
общий прогон проверок, затем исправления и проверка исправлений**. После каждого
helper не запускать полный QA, typecheck, сборку или повторные проверки старых APK.
В этом проходе таких запусков не было. Новые результаты PASS не заявлялись.

## Где работать

- Checkout: `C:/Users/mrdeu/.codex/work/genesis-tasker-20261108/public-candidate`.
- Единственный репозиторий: `nikitalexanderson-byte/Genesis-Tasker`, remote `publish`.
- Рабочая ветка: `codex/security-336`. Не переключать занятую копию.
- Источник требований: `docs/security-336-implementation-prompt.md`.
  SHA256: `5540A407041626A2ED9263F7C97DCDF6B90985375CC0E78063F7BDD2A384B338`.
- Полный текущий журнал: `docs/security-336-implementation-pass.md`.
- Общий релиз: `docs/release-3.3.6.md`, категории: `docs/e2ee-336-data-paths.md`.
- Старый OneDrive checkout, `calendar-genesis` и архив не использовать для разработки.
- **Не читать, не изменять и не stage `demo-output/`**. Это чужой untracked каталог.
- Не создавать субагентов и не запускать Daybreak в этом продолжении.

## Git и публикация

Последний pushed commit: `e93b23d0f46ebf91a807fb29810ecb3aba4e93d1`.
Локально сохранены WIP-коммиты, которые не проверены и не отправлены:

1. `f80a6eb5` — все source factories, архивы и streamed migration.
2. `ddaa43e3` — foreground vault и personal product repositories.
3. `19a24bab` — явный offline unlock, lifecycle и queue acknowledgements.
4. `cbd1cef9` — web/native diary, device-only drafts, chunked device documents.
5. Следующий локальный WIP-чекпоинт с текстом
   `compose native maps and reviewed conflict intent before consolidated QA`
   сохраняет остальные изменения и этот handoff; точный hash — в `git log`.

Owned manifests лежат в `output/release-3.3.6/runtime/`:
`implementation-pass-owned-paths.txt`, `product-pass-owned-paths.txt`,
`diary-pass-owned-paths.txt`, `maps-feature-pass-owned-paths.txt`.
Коммиты создавались с разовым `-c core.hooksPath=.../product-pass-no-hooks`,
чтобы соблюдать перенос проверок на конец прохода. Глобальные hooks не отключались.
Использовать explicit owned paths, не включать чужие файлы.

**Production остаётся 3.3.5/149. Accepted coverage остаётся 9/20.** Наличие
кандидатного кода источников и новых редакторов не означает приёмку 20/20.

До полной приёмки: `GENESIS_DEPLOY_ANDROID=false`, update floors0,
pilot/cutover выключены. Сохранять package, сертификат и данные. Поддерживаемый
upgrade QA — только **3.3.5 → 3.3.6**; APK раньше3.3.5 владелец исключил,
но schema migrations не удалять. После готовности владелец уже разрешил отдельные
штатные web/API Deploy и публикацию подписанного APK на сайте. Google Play,
личные устройства и треки не менять. Hostinger — только
`/home/u531952483/domains/genesiscalendar.com`.

## Что уже реализовано в кандидатном коде

Подробности прежних проходов есть в implementation-pass. Ключевые точки:

- Явный61-table source catalogue, реальные attachment bytes, fixed server
  allowlist, signed read grants, captured HTTP originals, staged source capture,
  streamed plan adoption/CAS и migration journal protocol5 на обоих клиентах.
- Web/native foreground account capability; Google identity отдельно от vault.
  Независимый secret, recovery-kit enrollment, pin и signed directory, явный
  offline unlock, lifecycle locking. Нет возврата к legacy key после ошибок.
- `personal-product-live-v1` соединяет private workspace/tasks/tombstones;
  native task/project/list/habit/tracker repositories используют новые readers/
  writers. Старые Google projections не исполняются от private task writes.
- Web personal mindmaps и теперь native `NativePrivateMindmaps` работают через
  `personal-mindmaps-live-v1`. Native seed открывает проверенные migrated image
  attachments. Views и новые conversion drafts сохраняются новым локальным root.
  Старые conversion receipts остаются history-only.
- Web/native diary используют `personal-diary-live-v1`. Device-only notes/drafts/
  promotion tickets находятся в отдельном хранилище без network/flush capability.
  Sync off сначала сохраняет локальные копии, затем tombstones активного remote
  содержимого. Включение sync явно сохраняет новые upload IDs до отправки и
  сохраняет источник до подтверждения. Это не обещание физического удаления
  исторического серверного ciphertext.
- Новый локальный device-document формат: manifest, digest,256KiB chunks,
  bounded64MiB, атомарный root/slot CAS. Фиксированные слоты ограничивают рост
  при повторных сохранениях; чтение чужой новой ревизии даёт явный conflict.
- Native diary/dream saved forms ссылаются на new-root draft. Черновики могут
  сохранять ещё пустое тело. Shared14-language notice объясняет отсутствие
  device-only истории на новом устройстве. Повреждение существующей истории
  не трактуется как её отсутствие.
- Read-only private services для dream clock/voice entitlement не принимают
  содержимое, ключи или настройки дневника и не открывают legacy diary endpoint.
- Product reads восстанавливают потерянное подтверждение по точной квитанции,
  не отправляя несохранённую операцию. Неизменившийся acknowledged GET больше
  не добавляет снимок в editor history на каждом poll.
- Последний проход добавляет durable `review` intent в обе editor queues:
  explicit conflict decision сохраняется до cancel/replace сети; старая версия
  и old packet identity сохраняются. Web fork/native adoption сохраняют
  расходящиеся карты как копии. Stale review должен требовать нового решения.
- `app/e2ee/feature-document.ts` сохраняет baseline первой pending правки;
  `app/stoicheion-restoration-storage.ts` подключён к реальному migrated seed.

Весь новый большой проход **не компилировался и не тестировался**. Возможны
TS/Kotlin/JS/PHP ошибки. Предыдущие primitive/custody PASS не относятся к нему.

## Где остановились и что делать после возобновления

Остановились на чтении Aurora workspace/native bridge. Изменений Aurora host,
paid results и native bridge ещё нет. Aurora `validateDocument` — **async**;
generic feature driver пока принимает sync validator. Сначала корректно
адаптировать driver/port и подробную domain validation, не передавать Promise
как документ. Подготовленные результаты сейчас содержат legacy iv/ciphertext;
для active private account нужен настоящий new-root result/reference flow с
сохранением проверок billing/issued-result immutability. Не пропускать оплату
и не открывать legacy result endpoints для обхода cutover.

Остаток реализации до общего QA:

- Aurora, оставшиеся stoicheion draw paths, Physis, advice и private preferences:
  реальные editor/repository entrypoints web/native и полная domain validation.
- Setup/migration/resume UI и фактическая композиция существующих source factories
  с mounted/unmounted editor captures. Все local histories/variants должны быть
  доступны для явного восстановления; не выполнять старые actions/import receipts.
- Shared CRUD, атомарные multi-table операции, approvals/signatures, membership,
  роли и rotation, client automations и quotas. Generic snapshots сами по себе
  не заменяют shared business authorization.
- External-copy consent, content-only import/backup/Drive, independent message
  key lifecycle. Imports не восстанавливают sessions, entitlement, tokens или ACL.
- Native reminders/background/deep links и оставшиеся optimistic UI closures.
  Временный skip retired protected workspace при scheduling — не готовые reminders.
- Expired enrollment challenge renewal и invalidated/revoked native-key recovery
  с original custody. Не заменять старый bundle/root автоматически.
- Проверить coverage per-scope local draft attribution, shared map draft scope,
  historical/nested Physis epoch pins и архивные файлы. Locked epoch сохранять
  явным состоянием, не скрывать.
- Завершить conflict review и его UI для остальных aggregate documents; последние
  review/cancel/replace изменения требуют особенно внимательной проверки
  concurrency, process death и receipt recovery. История настоящих edits всё ещё
  ограничена1024 retained drafts: нужна честная стратегия роста/архивирования.

Затем один согласованный JS/PHP/browser/native/i18n/upgrade/crypto QA, исправления,
проверка исправлений и отдельные разрешённые releases. Наш крипторевью —
**внутренний AI review**, не независимое человеческое заключение.

## Прочие согласованные решения

- Языки: отдельный раздел только `/ru/`, остальные через переключатель/`?lang=`;
  один origin, новые DNS/поддомены не нужны. Android до входа показывает русский
  только при текущем положительном IP-определении РФ; после входа все14 языков.
- Paddle: прозрачный согласованный сценарий, реальные юридические роли,
  действующая ЮKassa. Не скрывать витрину/реквизиты ради модерации; checkout
  не включать без одобрения и технической/платёжной приёмки.
- Дизайн по снимкам и предыдущие изменения сохранять. При итоговом QA нужны
  обе схемы, web360/390/768/1440, Android и смысловая вычитка14 языков.
- Пост для Telegram с картинкой нужен **после настоящего выпуска**3.3.6.
  Отправка в Telegram не поручена.

## Для будущих проверок

Owned AVD: `emulator-5594` / `GenesisSecurity336_API26_AOSP`,
`emulator-5578` / `GenesisSecurity336_API34`. PIN должен оставаться NONE.
QA package: `ru.genesis.calendar.qa1103.debug`. Личные устройства не использовать.
SDK: `C:/Users/mrdeu/AppData/Local/Android/Sdk`.
JDK: `C:/Program Files/Android/Android Studio/jbr`.
Не запускать параллельные Gradle операции.

Для общего PHP/JS QA при возобновлении:

```powershell
$env:GENESIS_QA_PHP='C:/Users/mrdeu/AppData/Local/Temp/genesis-remote-original-php-d346771545be4522b57891c16e4fbb14/php.exe'
$env:OPENSSL_CONF='C:/Users/mrdeu/AppData/Local/Temp/genesis-remote-original-php-d346771545be4522b57891c16e4fbb14/extras/ssl/openssl.cnf'
```

Остановка владельцем не является окончанием релиза или разрешением публикации
непроверенного кандидата.
## Latest continuation checkpoint (21 November, candidate code only)

After c90ef091, web/native membership preparation/coordinators/transports were
added, plus live private Stoicheion and common local Advice selection/products,
technical quota services/migrations130–131, native isolated Advice runtime,
new-root native cache/preference routing and explicit saved-operation retries.
See the new leading section of `security-336-implementation-pass.md`.

No QA/typecheck/lint/build/CI/push/deploy was run in this continuation. Public
metadata pin generation was authoring only. Do NOT increase accepted coverage
from9/20 or claim release readiness. Re-read git status before editing; do not
read/stage `demo-output/`. Do not spawn agents or run Daybreak. The next code
stage is real shared domain CRUD/source-to-index composition, membership/review
UI and policies/quotas/cross-scope operations, then backup/import/Drive,
external-copy consent, message-key lifecycle and native lifecycle/reminders/
invalidated-key recovery. All prior candidate code awaits consolidated QA.

Known implementation areas to revisit during that composition: rotation's
complete active-set verification must account for all locally confirmed newer
heads/chunks, not just the last signed retired manifest; source-to-scope trust
and multi-owner rotations need real UI approval. Advice/Timeline cache and
clock-boundary behavior and translated snapshot parity need consolidated QA.
Content-only backup must never replay these new issue/membership receipts.

# Continuation checkpoint: 22 November 2026

Message-key lifetimes were then strengthened: permanently retired native key
memory/repository publication, pinned owner/session/restore/custody gateway and
local-cell guards, and web operation admission across lock/hide/crypto/network
callbacks. Late same-UID unlocks cannot revive an earlier grant. Existing keys/
wire/history remain; owned crypto buffers are cleared and ambiguous shared-file
commit cleanup preserves ciphertext. New files: MessagingKeyMemory.kt and
app/e2ee/message-lifetime.ts. Native messaging SAF, complete draft/file staging
and exact-command recovery for the legacy shared UI remain unfinished. No QA or
compilation ran; coverage stays9/20. Details are in implementation-pass.

The latest input increment connects embedded native Aurora/Gno to real JS form/
repository capture, a local in-memory bridge mirror and a nonce-bound asynchronous
freeze/read barrier. NativeMigrationMemory supports prepared renderer reads
without holding its monitor across await. Whole-attempt cleanup thaws the view;
the persistent fence still controls writes. Native Aurora HTTP/session/restore
lifetimes are pinned. New file: NativeEmbeddedMigrationCapture.kt. This code is
uncompiled and unaccepted. Shared advanced forms and the other pending categories
remain unfinished; do not raise coverage above9/20.

Native content-backup SAF custody was subsequently rewritten around an exact
job/attempt and scope/generation binding, resumed two-minute picker admission,
five-minute cancellable foreground file access and streamed encrypted readback.
No automatic provider write resumes from disk; explicit unlocked retry rotates
the picker identity. Import/retry/cancel acknowledge the exact saved job, and
background clears UI keys/plaintext. New source files: NativeBackupFileAccess.kt
and PrivateBackupFileActivity.kt. No compilation or QA ran; coverage remains9/20.

Streamed cancellation and pause/drain code now follows the recovery checkpoint.
The two real migration screens can pause and await the prior attempt before retry;
pause preserves pending signed packets and never grants legacy write authority.
Controllers/core retain a state4 cancellation receipt and reverify the directory
before fence release. Remote-cancel UI, archived state4 restart/history and the
unstarted/corrupt-journal distinction remain unfinished. See the leading section
of implementation-pass. This is uncompiled code; accepted coverage remains9/20.

Latest code continuation adds shared request-keyed recovery SAF and device
credential hosts, ten-minute generated-material custody, two-minute system-trip
admission, generation-bound saved receipts and complete file readback. Session/
restore epochs and UI lifetimes are bound; active background IO closes descriptors.
Native unlock pins its HTTP generation and publishes/adopts the account without
tying subsequent use to a disposed UI request. Details and limitations are in the
leading recovery-lifetimes section of `security-336-implementation-pass.md`.
This code is uncompiled and untested; accepted coverage remains9/20. Continue
remaining infrastructure, including streamed cancellation and content-backup SAF,
before consolidated acceptance. No security publication or rollout activation.

Continue code first, then consolidated acceptance/repairs, then release. The new
scope-setup/editor-source/product-controller increment is documented at the top
of `security-336-implementation-pass.md`; it is not compiled or accepted. Actual
setup/resume screens, complete native mounted input, streamed cancellation and
revoked-device replacement still need implementation. The original prompt is
unchanged. Accepted coverage remains 9/20. Do not read/stage `demo-output/`.

## Separate public release and migration UX continuation

The urgent public release is now live: main
`c29b76e33cc42160616b2df6f5eca61af94f6c63`, Source checks44962824697 success,
Deploy44965877713 success. Live acceptance passed98 localized documents, two
legacy Russian links and84 sitemap URLs. API health/privacyModel2, Google
provider and anonymous session passed; APK149 URL/size/ETag and the complete
Android update manifest are unchanged. Live public EN desktop and RU mobile
screenshots were saved; temporary browser overrides were reset and the owned
local QA server stopped. Personal Google sign-in, real payments and private
security code were not tested in this website-only acceptance. Paddle checkout
was not activated. The new accepted storefront must remain in later3.3.6 work.

The urgent website-only changes are in `paddle-web-20261122`, PR42, head
`503267a7f171e1038f82d636037698029803334c`. They must publish first and contain
no new E2EE/security source. Preserve their accepted public storefront and `/ru/`
when later integrating main into this security branch. Website CI (including
its unchanged native debug check) is not acceptance of this security candidate.

The accepted public source from main `c29b76e33cc42160616b2df6f5eca61af94f6c63`
has since been merged locally into this branch. Public routes/copy/footer are
preserved, alongside the private security/recovery/runtime code. This combined
branch is still uncompiled, untested and unpushed; do not publish it with the
urgent website-only release.

The current local UX code adds the shared14-language setup/resume gate and real
static `web/main.tsx` composition, with owner-bound vault suppression and product
remount after verified cutover. Native system-credential return uses one-shot,
owner/view/attempt-bound, memory-only recovery material with an elapsed-time
validity limit, foreground guards, cancellation and disposal. See the leading
section of `security-336-implementation-pass.md` for guarantees and limitations.

This increment remains uncompiled and untested. Do not increase9/20 acceptance
or activate pilot/floors/cutover. Remaining code includes full native captures,
SAF generation/lifecycle custody, streamed cancellation, revoked-device recovery,
shared domain composition/authorization and the other pending items above.

### Native input continuation while public CI runs

Added dream journal/editor and all sleep/mood/abstinence forms to native
in-memory capture. Preserve raw input, original typed records/revisions and UI
state as inert personal.local-work history. Mounted loading/saving/voice,
spelling and slider activity must settle; detached originals do not execute.
Owner comes from the authenticated UID plus an exact hashed-scope match, and
sleep/mood repository/form state is keyed to that account lifetime.

Code review/diff hygiene only; no private security tests/builds/CI ran. Coverage
remains9/20. Consolidated acceptance needs account switches/disposal, raw invalid
input, pending voice/spelling, save/loading races, slider interruption and
SOURCE_NOT_SETTLED retry/cancel UX. Embedded Aurora/Gno/shared advanced forms,
SAF custody and streamed cancellation remain unfinished.

Stoicheion restoration journey/cycle inputs are now registered too: raw
intention/action/reflection, choices, source cards/seed and original habit
workspace are preserved as history. Owner binding follows the actual habit
repository scope, with account-keyed repository lifetime. No private tests or
compilation ran for this continuation; accepted coverage is still9/20.

