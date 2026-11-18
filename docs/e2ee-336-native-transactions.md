# Поддерживаемая Room transaction boundary в3.3.6

19 ноября2026. Android lint обнаружил два вызова library-restricted
`RoomDatabase.assertNotSuspendingTransaction` в guards legacy IO. Они заменены
app-owned coroutine context; baseline/suppression для ошибки не добавлялись.

`GenesisRoomTransaction.kt` использует поддерживаемый AndroidX `withTransaction`
для настоящего commit/rollback/dispatcher. Внутри тела дополнительный
`ThreadLocal.asContextElement(true)` переносит признак transaction через
`withContext`, вложенные transaction и structured cancellation. Он не хранит
account/key data. Все app-owned suspend Room transactions импортируют этот
boundary. Network/owner-operation gates проверяют его до взятия scope mutex,
вместе с обычным `db.inTransaction()`, и возвращают прежнюю redacted ошибку
`E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN`. Фактический lock order сохраняется:
scope operation permit → Room, без ожидания сети внутри transaction.

Synchronous raw SQLite transactions `E2eeRecordStorage` и `LegacyScopeFenceSql`
не переписаны: они используют SQLite внутри своего отдельного storage/schema
кода. App-owned detached coroutine work внутри transaction не разрешено.

`tests/native-room-transaction-boundary.test.mjs` проверяет весь native source
inventory, включая instrumentation: прямой импорт исходного suspend extension,
wildcard Room import и restricted probe не должны обойти boundary. Реальное
поведение проверяет `E2eeLegacyTransportGateTest`:7 случаев, включая dispatcher
hops, nesting, actual rollback и cancellation, восстановление нормального IO
после выхода, migration waiting/borrowed operations/account changes.

Общий actual API34 прогон:23/23 PASS,0 skips:
7 transport gate +9 advice-cache +1 workspace Room +3 Aurora +3 Stoicheion.
Проверены actual Room/Keystore, прежние ciphertexts и packaged isolated engine.
Лог: `output/release-3.3.6/runtime/native-room-boundary-api34-01.log`.
Оба QA APK собраны, version metadata3.3.5/149/debug package сохранены;
личные устройства не изменялись. Первая попытка KSP не прошла из-за пропущенного
импорта `Insert` при снятии wildcard; импорт исправлен до успешной сборки и
actual instrumentation. Логи01/02 не взаимозаменяемы.

Финальный consolidated build/lint/JVM run PASS за20m31s:
`runtime/native-room-boundary-build-lint-02.log`. Main/test APK, lintDebug и21/21
JVM tests прошли:5 Aurora +5 Stoicheion +8 migration +3 policy/protocol.
Lint:0 errors,206 warnings,8 hints; прежние warnings не подавлялись.
API26/35, signed direct upgrades и process-death
этим прогоном не покрыты. Production/cutover/floors не менялись.
