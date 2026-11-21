# GENESIS 3.3.6 — передача работы в новый чат

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

Continue code first, then consolidated acceptance/repairs, then release. The new
scope-setup/editor-source/product-controller increment is documented at the top
of `security-336-implementation-pass.md`; it is not compiled or accepted. Actual
setup/resume screens, complete native mounted input, streamed cancellation and
revoked-device replacement still need implementation. The original prompt is
unchanged. Accepted coverage remains 9/20. Do not read/stage `demo-output/`.

## Separate public release and migration UX continuation

The urgent website-only changes are in `paddle-web-20261122`, PR42, head
`503267a7f171e1038f82d636037698029803334c`. They must publish first and contain
no new E2EE/security source. Preserve their accepted public storefront and `/ru/`
when later integrating main into this security branch. Website CI (including
its unchanged native debug check) is not acceptance of this security candidate.

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

