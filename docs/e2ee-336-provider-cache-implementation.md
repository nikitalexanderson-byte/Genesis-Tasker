# Provider cache: exact inventory and task reconciliation

19 ноября2026. Продолжение `e2ee-336-provider-cache.md` и server owner gate.

`e2ee-provider-cache.php` читает authoritative primary/linked SQL account list,
проверяет только вычисленные owner paths и существующие mutexes. Чужие файлы не
перечисляются. Read не создаёт directory/cache locks, не вызывает Google, refresh,
cleanup, acknowledgement или helpers с нормализацией/побочными записями. Owner
exclusive permit предшествует SQLite; file flock неблокирующий. Directory/file
symlinks, неизвестный retention entry и недоступный файл дают отказ.

Приватный HMAC source token теперь включает exact ciphertext bytes, отсутствие
или наличие каждого current/retained cache, authoritative accounts и grant
binding. Эти bytes проверяются на start/read/resume/final commit. Re-encryption
одинакового содержимого тоже меняет token. Изменение после verified manifest
не позволяет commit и сохраняет shadow/originals. Token не является root или
правом доступа к provider; отдельные hashes plaintext/token не экспортируются.

Signed `legacy-tasks` возвращает content projection: items, list names, timestamps
и warning history. Fingerprint, syncToken, Google identity rows и credentials
не возвращаются. Сохранены исходные JSON-структуры content; duplicate decoded
names, malformed ciphertext/key/JSON, unknown fields и превышение16MiB дают
явный отказ без empty fallback. Server source hash budget128MiB; single file
до32MiB ciphertext. Это bounded refusal, не streaming large-history acceptance.

Ordinary cache теперь тоже отказывает при corruption до callback. Перед сбросом
из-за другого grant сохраняет exact ciphertext в0700 owner-derived retention
directory,0600 file. Имена retention — SHA-256 ciphertext, не plaintext. Атомарная
запись предшествует замене current. После crash неизвестный .tmp не игнорируется
миграцией. Никакого автоматического retirement. Явный legacy provider cleanup
удаляет current и retained copy под тем же file mutex; новый cutover deletion
lifecycle/retention maintenance ещё необходимо завершить до activation.

Web/native общий source требует явный current primary slot и не пропускает
retained linked slot без authoritative current inventory. Сохраняет исторические
items/lists/settings внутри encrypted history. Current provider tasks получают
прежнюю account-ID decoration из реального producer; одинаковый raw provider ID
двух accounts не схлопывается. Conflicts и tombstones используют task review,
не приоритет timestamp. Новые object IDs — случайные UUID, index зашифрован.

Historical grant и retained generation требуют нового решения для каждого exact
source (`include`/`retain-only`). Оба варианта сохраняют private history. Без review
source останавливается. Web factory имеет явный port; product review UI/native
review flow ещё не подключены. Обычное new-root чтение отключает legacy external
sync/create flags и требует нового внешнего согласия; оно не вызывает provider.

Фактические проверки в `output/release-3.3.6/runtime/`:

- `provider-cache-source-01/`: 3 PASS/1 FAIL, новая fixture не подключала Google
  constants; исправлено. `source-02/`:3/3 PASS; `source-03/`:7/7 PASS.
- Source suite: real signed read, exact current/linked/foreign isolation, actual
  schema, отсутствие tokens/cursors, duplicate escaped names, corrupt/missing
  files, grant/owner/presence/ciphertext changes, SQL+file contention, process
  termination, failed final commit, retention and explicit cleanup.
- `provider-cache-js-02.log`:62/62 source/coordinator/migration tests PASS.
- `provider-cache-full-js-03.log`:1515/1515 full JS PASS.
- `provider-cache-typecheck-final-02.log`, `provider-cache-lint-01.log`,
  `provider-cache-web-build-02.log`: PASS.
- Actual Chromium157: `provider-cache-browser-report-01.log`16/16 PASS,
  `provider-cache-browser-console-01.log`0 errors/warnings. Screenshot:
  `output/playwright/provider-cache-source-336.png`. WebCrypto/IndexedDB,
  persist-before-IO, original queues, lock/reopen/new-root read and list history.
- QA main/test APK packaged; native JVM source6/6 +policy1/1 PASS.
  `native-provider-cache-build-01.log` also runs lint; completion is recorded
  separately once that task exits, not inferred from APK packaging.
- API34 `native-provider-cache-api34-01.log`45/45 PASS; API35
  `native-provider-cache-api35-01.log`45/45 PASS. Real Room/Keystore/new-root reads,
  file-only content/list history, no key bridge, historical-review denial, original
  queues preserved; regression4 earlier categories, transport and task sync.
- `provider-cache-api-final-05/`:402/402 loopback HTTP cases PASS.
- `provider-cache-full-backend-04/`: complete backend regression running;
  final result is recorded separately. Earlier146/1 log and fixed Web Push4/4
  evidence remain in `e2ee-336-personal-server-io.md`.

No production account/config/DB or personal device was used. Synthetic responses
in browser/native are not live Google/Paddle acceptance. API26 success with a
compatible WebView provider, hostile/partial server storage recovery, real large
histories, history review UI and whole-product routing remain unverified here.
There are still5/20 real adapters; this closes the newly discovered task source
gap in code, not the15 other categories or full lifecycle/recovery/upgrades/
shared/backup/48 scenarios/14-language security UI/independent crypto review.
Android3.3.5/149, floors0, cutover off and GENESIS_DEPLOY_ANDROID=false remain.
