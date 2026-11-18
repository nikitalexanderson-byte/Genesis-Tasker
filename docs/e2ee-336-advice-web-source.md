# Реальный web Advice source: подготовка3.3.6

19 ноября2026. `PersonalAdviceSource` и authenticated factory в `cloud-sync.ts`
реализованы. Signed `legacy-advice` transport проверен на web/Android/PHP.
Это ещё не полный native content source или product bootstrap/editor routing;
подтверждённый общий coverage остаётся3/20 до native Advice acceptance.

Local capture не выполняет IO/изменений. Включает actual owner/generation marker,
mounted advice/settings, rendered copies/seen и сведения о неатрибутированном
legacy cache. Coordinator сначала защищает полный snapshot новым root.
Generation mismatch, неизвестный provenance, changed protected attempt или
неподдерживаемый/теряемый формат блокируют сведение с сохранением originals.

Под current device/lease/source token читаются пять raw preference fields,
daily pointer/selection, slots1–6 и7–9, view/dismiss timestamps и private metrics.
Нормализованный выбор сохраняется вместе с точными raw JSON originals.
Независимые mounted changes сводятся относительно base; конфликт одного поля
требует review. Старый permissive normalizer не может потерять неизвестный выбор
и выдать успешную default конфигурацию.

Historical entry сохраняет raw entry/selection JSON, private timestamps,
редакционную metadata и все14 точных переводов его version. Ранее реально
показанный текст локальной копии сохраняется отдельно. Missing edition не
вызывает нового draw. Remote day objects имеют случайные UUID; дата/advice ID
не входят в открытый object ID/AAD. Связь даты с UUID хранится в encrypted index
в той же persist-before-upload shadow plan. Live quota/next permission из кеша
не импортируются. Identity, tokens, ACL и subscription здесь отсутствуют.

Factory использует реальный account guard и source generation. Public files
читаются с того же origin без Cookie/Referer/selected ID в URL, после protected
snapshot. Обычные publication helpers не вызываются. Полный coordinator ещё
должен зарегистрировать все экраны/источники продукта.

## Фактически выполнено

-7 source Node cases PASS: exact choices/text/history,14-language references,
 masked quota, independent/conflicting edits, owner/lease/generation, malformed
 formats, missing edition, provenance/history review и authenticated capture
 без IO. Source factory проверен с настоящим cloud account session guard.
- Actual adapter прошёл durable coordinator → shadow upload/readback → normal
 `E2eeScopeClient` под новым root. Сохранены выбор, UUID index, переводы и previous
 rendered text; canary не появляется в ciphertext stores/server objects. Другие
 registry paths в этом fixture synthetic: это не whole-product acceptance.
- Финальный полный JS1482/1482, web build и typecheck PASS после замены date IDs
 на UUID index. Отдельно46/46 source/coordinator checks PASS. Closure narrowing
 error исправлен локальной typed reference; focused lint также PASS.
- Native8/8 migration JVM PASS, включая Advice signatures/scope binding.
 PHP/SQLite6/6 suites PASS;12 actual signed web/native packets проверены PHP:
 pagination accepted, stale workspace/Aurora/Stoicheion/Advice source tokens
 отклонены по lease/source contract. Это не production network acceptance.

Логи в `output/release-3.3.6/runtime/`: `frontend-advice-source-final-full-05.log`,
`frontend-advice-source-final-build-03.log`, `frontend-advice-private-index-04.log`,
`frontend-advice-source-final-typecheck-04.log`, `native-advice-transport-jvm-01.log`,
`backend-advice-transport-01/`. Public Chromium acceptance описан отдельно в
`e2ee-336-advice-public-editions.md`.

Native продолжение обязано захватить actual AdviceSnapshotStore documents/index,
все owner v2 profiles/history/preferences/seen, exact known v1 records и provenance.
Неизвестные SharedPreferences hashes нельзя присвоить owner или назвать пустыми;
originals не удаляются. Portable archive/recovery, signed upgrades, API26/
WebView113,48 сценариев,14-language security UI и независимый crypto review ещё
не завершены. Production3.3.5/149, floors0, cutover off и Android deploy false
сохранены.
