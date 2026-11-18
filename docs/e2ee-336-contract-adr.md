# ADR: первый криптографический контракт 3.3.6

Дата: 18 ноября 2026. Статус: реализация для изолированных проверок, **не
production E2EE**. Основа — полный промпт владельца от 17 ноября и
`docs/security-bridge-335-adr.md`. Продолжаем от `e131ac2035264cacc797fc112bde861c3fa0f9f8`;
сайт, опубликованная 3.3.5/149 и её данные сохраняются.

## Решение первого инкремента

Web Crypto и JCA выполняют AES-256-KW (RFC 3394), AES-256-GCM и ECDSA
P-256/SHA-256. Дополнительные криптографические зависимости не нужны. Web Crypto —
реализация браузера; JCA — поставщик платформы (Android API26+ проверяется
отдельно от JVM). Лицензии реализации принадлежат браузеру/Android, новый
сторонний код не копируется. Backend использует существующий PHP OpenSSL
для проверки подписей, никогда не unwrap/decrypt. Самописных AES/ECDSA/KDF нет.

Suite ID `A256KW-A256GCM-ES256`, cryptoProtocol=1. Это отдельный контракт;
старый writerProtocol=9 сам по себе не становится E2EE. Для этого suite
writerProtocol остаётся 9; изменение модели требует следующего решения.
`dataGeneration`, `cryptoEpoch`, `securityEpoch`, `revision` — независимые
положительные безопасные целые <=9007199254740991. schemaVersion также >=1.
versionCode не участвует в криптографической авторизации.

Root — новые 32 случайных байта для scope, не производные от старого ключа,
Google identity или серверного секрета. В каждом вызове seal платформа создаёт
**новый случайный 256-битный DEK**. Root оборачивает его AES-KW в 40 байт.
Контент шифруется этим одноразовым DEK с новым случайным nonce 12 байт и
tag 16 байт. Отсутствует общий счётчик nonce, который могли бы клонировать
несколько устройств или restore. Повтор пары key/nonce требует совпадения
независимых 256+96 случайных битов; случайные ключи зависят от CSPRNG ОС.
При не более 2^32 seal на scope/epoch birthday bound <2^-289 для пары.
Лимит эпохи должен обеспечиваться будущим write contract; при его отсутствии
suite не включается. Retry хранит и повторяет **готовый envelope**, а не вызывает
seal с тем же operationId. Backend должен отвергать другой payload того же ID.

AES-KW не получает AAD: wrapped DEK и nonce входят в подписанные байты, а все
идентификаторы, эпохи и назначения связаны GCM AAD. Нельзя применить обёртку к
другому объекту или подменить её без ошибки подписи/tag. Один envelope не является
файловым chunk protocol: authenticated manifest/chunks — отдельный обязательный этап.

## Формат байтов

Внешний объект имеет ровно `context`, `wrappedKey`, `nonce`, `ciphertext`,
`signature`. Бинарные поля — канонический base64url без padding; повторное
кодирование должно совпасть. Размер plaintext <=4 MiB, wrappedKey=40,
nonce=12, signature=64 (P1363 r||s). Идентификаторы содержат только технический
ASCII; имена, заметки, plaintext hashes, названия файлов не помещаются в context.
Неизвестные поля, типы, suite, domain и выход за лимиты отвергаются без coercion.

AAD начинается UTF-8 `GENESIS-E2EE-AAD\0v1\0`. Затем в фиксированном порядке:
`cryptoProtocol`, `suite`, `ownerId`, `scopeId`, `domain`, `objectId`,
`schemaVersion`, `dataGeneration`, `writerProtocol`, `cryptoEpoch`,
`securityEpoch`, `revision`, `keyId`, `deviceId`, `operationId`.
Числа — unsigned big-endian uint64 (только safe integer), строки — uint32 BE
длины и ASCII/UTF-8 bytes. Не используется сериализация JSON для подписей/AAD.
Числовые поля нормализуются после JSON-декодирования к IEEE754 safe integer:
`7`, `7.0`, `7e0` означают одно число и дают одинаковый uint64. Строки и bool
числами не становятся; finite/fraction/range проверяются до преобразования.
Подписывается это каноническое значение, а не исходная лексема JSON. Лексическую
точность дробей за пределами IEEE754 модуль не обещает.

Подписывается `GENESIS-E2EE-SIGNATURE\0v1\0` + AAD + wrappedKey (40) + nonce
(12) + SHA-256(ciphertext||tag) (32). DER/P1363 преобразуется только как
кодировка целых ECDSA; арифметику подписи выполняют Web Crypto/JCA/OpenSSL.
Устройство подписывает header и hash ciphertext. Публичный ключ для проверки
приходит от вызывающей доверенной device directory, **не из envelope**.
Он должен быть EC secp256r1, другие curves и RSA не принимаются.

Decrypt требует полный ожидаемый context, а не доверяет идентификаторам
сервера. Ранние ошибки имеют коды INVALID_ENVELOPE / CONTEXT_MISMATCH;
ошибки подписи, unwrap и GCM — CORRUPT_ENVELOPE, без содержимого в сообщении.
Никогда не создаются пустые данные/новый root после неудачной расшифровки.
Существующее хранилище этим модулем не изменяется.

## Реестр путей: что обязательно подключить после контракта

Во всех строках ключи нового поколения ещё не подключены к runtime. Все строки
включают local pending/tombstones, backup/export и delete; ни одна не исключается
из заявленного будущего полного coverage.

| Источник/владелец | Local и очередь | Endpoint / сервер / нынешний читатель | Backup, export, external, delete | Целевая проверка |
| --- | --- | --- | --- | --- |
| Личные проекты/задачи/привычки, user | `cloud-sync.ts`, `workspace-storage.ts`, browser base/outbox; Room, `CloudWorkspaceSync` | workspace/key/envelope, `repository.php`; account key раскрываем backend | личные архивы и runtime snapshot; явная Google-копия отдельно; tombstones | новый root, snapshot до сети, restore старого outbox без воскрешения |
| Дневник, сны, user | `diary-storage.ts`, native DiaryRoomStore/DiaryKeystoreCipher, drafts/chunks | private documents, account-key readers | архивы/экспорт, spelling по согласию; delete всех chunks | все chunks и drafts входят в manifest |
| Mindmaps/история, user или project | `mindmaps-storage.ts`, native repositories, conversion journal | personal documents/shared maps | личный/общий export, перенос в проект, deletion/history | отдельные domain/object и подписанный перенос |
| Аврора/Стойхейон/Гно, user | `app/aurora`, AuroraNativeStore, pending dialogue/draws | `aurora-workspace.php`, `stoicheion-workspace.php`; legacy keys | archives и история; entitlement/квоты отдельно | приватный текст закрыт, серверные права не импортируются |
| ФЮЗИС/здоровье, user | `app/physis/crypto.ts`, native account vault/queues | encrypted account vault и его ключи | backup/import/export; внешняя обработка отдельно; delete vault | независимый новый domain key, перешифрование вложенных ключей |
| Общие проекты/комментарии, project members | shared IndexedDB, SharedOfflineStore, native cache/outbox | shared APIs, `shared-content-storage.php`, ACL; сервер пока читатель | team archives и activity; удаление/выход не отменяет прочитанную историю | project epochs, подписанное членство, rotation/revocation |
| Вложения/previews, user/project | SharedTaskFilesDraftStore, attachment transport/temp | `shared-task-attachments.php`, blobs | archive, downloads; delete pending/blob/previews | отдельный file key, chunk ordering/size и authenticated manifest |
| Личные сообщения, участники | `private-message-crypto.ts`, private-message-vault, MessagingStore/drafts | ECDH ciphertext, key pins и metadata | отдельные key backups; история сохранена | существующий формат читаем; ratchet только готовой библиотекой и отдельным ADR |
| Производные данные/напоминания, user | search/cache, Room alarms/widgets/workers | sync/push projections без приватного текста | OS temp/recents/clipboard, logs/crash systems | lock/account switch, canary всех writers и caches |
| Импорт/аварийные копии, user | backup staging, BackupSafetyStore, encrypted emergency snapshot | `backups.php`; server не authority для vault | `.genesisrescue`, личные архивы, будущий Drive adapter; retention | clean-device recovery и отрицательные billing/ACL/identity tests |
| Identity/billing/Google, user и сервер | session/cookie/token caches | authoritative auth, billing, referrals, Google provider | system snapshot; user archives не возвращают authority | identity recovery не открывает vault; внешняя копия явно обозначена |

Системная age-копия уже подготовлена в 3.3.5; scheduler/retention и личные
Google Drive-копии не считаются реализованными этим ADR. Их интеграция идёт
отдельными проверяемыми шагами по ранее данному разрешению.

## Границы приёмки и следующий шаг

Контракт проверяется межплатформенными синтетическими vectors и негативными
тестами parser/AAD/signature/KW/tag/nonce. Генератор fixtures находится отдельно
от runtime и не даёт production API выбирать nonce/DEK. Проверяются реальные
браузер и Android API26+, а не только Node/JVM.

Он **не** выдаёт доверие устройству, не обеспечивает CAS, migration fence,
enrollment/recovery/отзыв, encrypted persistent vault или fork witness. Эти
обязательные следующие этапы не подменяются проверкой подписи. HPKE/group
enrollment и recovery требуют отдельного ADR с поддерживаемой библиотекой;
самописный HPKE/Double Ratchet запрещён. Root AES-KW не назначается также ключом
подписи/сессии и не передаётся в legacy wrapWorkspaceKey.

Независимый криптографический review полного протокола (включая enrollment,
миграцию, recovery и группы) обязателен до pilot/cutover. Review человеком или
организацией пока не подтверждён. Контракт не импортируется production entrypoint,
флаги активации и floors остаются выключены. Нельзя повышать runtime
`supportedCryptoProtocol` только из-за наличия этого модуля.
