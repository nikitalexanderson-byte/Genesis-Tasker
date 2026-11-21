# GENESIS 3.3.6 — передача работы в новый чат

## Состояние по прямому указанию владельца

21 ноября 2026 владелец попросил **остановить работу**, чтобы решить другие
проблемы, и продолжить в новом чате. Работа приостановлена. Этот файл сохраняет
контекст, а не поручает запускать фоновые задачи. Возобновлять после нового
указания владельца.

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
