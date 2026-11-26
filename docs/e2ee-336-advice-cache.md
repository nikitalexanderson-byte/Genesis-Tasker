# Android-кеш советов: подготовка3.3.6

19 ноября2026. Это hardening фактического legacy cache, ещё не завершённый
`personal.advice` source adapter и не production activation.

Прежде `DailyAdviceCache` писал response и view markers открытым JSON в
`daily_advice_day_v1` SharedPreferences. Ключ рассчитывался из owner/language/
preferences; само наличие hashed key не позволяло надёжно назначить неизвестную
историческую запись конкретному аккаунту.

Новый рабочий контейнер — одна owner-scoped Room row `advice-cache-v2`, внутри
которой Keystore field encryption защищает все profile descriptors, hash lookups,
current responses, exact known legacy originals и seen markers. Новые private
preference hashes, advice IDs, даты выбора и настройки не входят в открытый
Room kind/AAD. AAD содержит только scope и постоянное техническое имя. Historical
rows используют `advice-cache-history-v2:<ciphertext hash>`; хешируется ciphertext,
а не private plaintext. Они сохраняют точный прежний ciphertext и открываются
исходным постоянным AAD. Это legacy field encryption, не новый E2EE root.

Весь fetch/record/local commit проходит через owner-bound
`NativeLegacyOperationPermit`, включая borrowed HTTP и cleanup. Scope mutex
берётся раньше Room и остаётся до завершения операции; миграция должна дождаться
позднего ответа. Persistent preparing/active fence запрещает новый legacy IO
до чтения кеша или сети. Другой активный account и UpdateGate также блокируют
операцию. Сетевой вызов не выполняется внутри Room transaction.

Known v1 key выбирается только из точно воспроизводимого owner/language/
preferences tuple. Его raw bytes сначала сохраняются в encrypted container,
после чего разрешён fetch следующего дня. Текущий кеш и каждый прежний encrypted
container сохраняются; существующий legacy SharedPreferences не изменяется и не
перечисляется по чужим/unassigned keys. Старые plaintext copies остаются
обязательным пунктом полного source capture/provenance/retention, а не скрытым
исключением E2EE. Нельзя объявить их пустыми или удалить ради успешной приёмки.

Crypto/parse ошибка не включает plaintext/network fallback и не очищает row.
Перед созданием нового day/profile/seen state проверяется существующий encrypted
cache либо older owner-bound `AdviceSnapshotStore` witness. Это не позволяет
потерянному ключу стать новым пустым кешем только из-за другого preference hash.
Глобальный lifecycle остальных LocalCipher users остаётся отдельной обязательной
проверкой; этот guard относится к фактическим Advice records. Полный E2EE device
vault/unlock/recovery не подменяется наличием Keystore field encryption.

Контейнер ограничен4MiB UTF-8 и256 profiles; превышение сохраняет старую версию
и выдаёт ошибку. Перед commit новая обёртка проверяется decrypt/readback. Старый
ciphertext архивируется в той же Room transaction; отказ не заменяет данные
пустым документом. Raw parser/crypto causes не показываются как данные ошибки.

## Проверки

9/9 actual API34 instrumentation PASS;0 skips. Отдельный QA package
`ru.genesis.calendar.qa1103.debug`, debug signing, metadata3.3.5/149; личные
устройства не менялись. Main/test APK build PASS. Артефакты:

- `runtime/native-advice-cache-build-05.log`: финальный main контейнерный формат.
- `runtime/native-advice-cache-test-build-06.log`: финальный тестовый APK.
- `runtime/native-advice-cache-api34-final-02.log`:9/9 actual Room/AndroidKeyStore.

Все пути относительно `output/release-3.3.6/`. Проверены exact known v1 capture
до network, encrypted recreation/day rollover и exact prior ciphertext history,
8 concurrent loads с одним fetch,8 concurrent views с одним record, dismissal,
current-owner isolation/late account change во время fetch/record, preparing
во время pending fetch и отсутствие нового IO после fence. При corruption/потере
свежего fixture-only Keystore alias не выполняются network/plaintext fallback,
новые markers/profiles или замена key. Actual older AdviceSnapshotStore witness
также проверен. Missing primary при retained history и6 authenticated malformed
container variants сохраняют исходные rows и отказывают до сети. В открытых
новых Room kind/AAD нет preference hash/advice identity.

Первый проход дал8 successful security cases и отказ setup старого qa330 test
из-за его строгого package guard. Guard не ослаблен; исходные functional
assertions воспроизведены в текущем qa1103 fixture с реальным owner guard.
Финальный прогон9/9 PASS. API26, прямое signed обновление, low-memory/process-death
этого кеша и глобальный LocalCipher lifecycle этим инкрементом не подтверждены.
Другие UI/features не менялись; новых строк локализации или визуальных поверхностей
нет. Старые raw SharedPreferences остаются обязательной частью будущего источника.

После перехода всех app-owned Room transaction на поддерживаемый boundary кеш
проверен повторно: те же9 случаев PASS внутри23/23 actual API34 regression,
`runtime/native-room-boundary-api34-01.log`. Main/test APK,21/21 focused JVM и
lintDebug PASS,0 lint errors без suppression. Подробности, первый KSP import
failure и точная граница охвата: `e2ee-336-native-transactions.md`.

Android runtime и signed web/native Advice source ports/reconciliation ещё
нужны для нового root. Coverage остаётся3/20; legacy source/upgrade/recovery,
48 сценариев/14 языков и независимый crypto review не завершены. Production
3.3.5/149, update floors0, GENESIS_DEPLOY_ANDROID=false и cutover off сохранены.
