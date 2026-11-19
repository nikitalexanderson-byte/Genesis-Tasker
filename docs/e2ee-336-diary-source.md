# Diary: signed historical server source

19 ноября2026. `legacy-diary` читает все6 owner-scoped таблиц: notes (с exact
ciphertext/payload hash), real deletions и local-only privacy markers, settings/
command history, dream dates/timezones/preferences и advice references. Проверяет
текущие signed device/owner/lease/source token под owner gate +SQLite writer.
Обычные helpers с purge/settings/voice/quota/date side effects не вызываются.

Истёкший тариф и прежнее отключение sync не скрывают существующее содержимое от
его владельца. Old server-known key возвращается только при наличии note
ciphertext. Missing/corrupt key, expired/changed lease/source и resource limits
дают отказ без создания пустого key/cache, удаления источника или acknowledgement.
Исторические command hashes/advice references не являются live execution,
identity, entitlement, billing или ACL authority.

Web/native signed ports используют тот же owner/scope/device/session/checkpoint
контракт. Новые реальные WebCrypto/JCA packets включены в общую PHP fixture:
16 подписанных пакетов двух платформ проверяются сервером. Это ещё не полный
client capture/reconciliation adapter и не product diary routing.

Проверки в `output/release-3.3.6/runtime/`:

- `diary-source-server-01/`:6/6 PHP suites PASS.
- `diary-source-server-oversized-02/`: diary source PASS; actual-schema coverage,
  raw own/foreign ciphertext distinction, notes despite disabled legacy sync,
  tombstones, key minimization/corruption, all6 SQL write fences, no source changes,
  oversized Unicode и10000+ rows без truncation.
- `diary-transport-web-02.log`:40/40 migration JS PASS.
- `diary-transport-native-jvm-02.log`:8/8 migration JVM PASS, skipped0,
  errors0/failures0. Main/test fixture compilation successful5m21s.
- `diary-source-transport-final-03/`:7/7 PHP suites PASS, включая actual16
  web/native signed packets and provider/task/request-gate regressions.
- `diary-transport-lint-03.log`:PASS; typecheck completion is collected separately.

Обязательное продолжение: capture всех web cache/drafts/settings/mounted editors,
native chunk manifests/current/dangling documents и encrypted pending notes;
lossless reconciliation/readback/new-root recovery на обеих платформах.

При инвентаризации обнаружена дополнительная семантика: `local_only=1` означает
снятие серверной копии с сохранением локальной, а не настоящее удаление заметки.
Нельзя отправить такой текст/черновики/legacy ciphertext в cloud migration plan,
даже за новым шифрованием, без нового согласия. Нужен отдельный защищённый local
output plan и его crash/recovery acceptance. Этот контракт сейчас проектируется;
реализация на этом этапе не объявлялась готовой. Последующий protected local
output contract и его проверки реализованы в `e2ee-336-local-output.md`.
Новый adapter должен использовать отдельное local placement для этих данных.

Coverage остаётся5/20 real adapters. Production3.3.5/149, floors0, cutover off,
GENESIS_DEPLOY_ANDROID=false; остальных15 categories, full lifecycle/48 scenarios/
recovery/direct upgrades/14-language security UI и independent crypto review
этот signed source не заменяет.
