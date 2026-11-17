# Переход безопасности 3.3.5 → 3.3.6

Дата: 17 ноября 2026. Решения 3.3.5 реализованы; контракт E2EE ниже — проект
для 3.3.6, не описание уже включённой защиты. Источник требований — аудит
`output/security-review-2026-11-17/security-e2ee-report-2026-11-17.md`.

## Что включается в 3.3.5

Обновлены зависимости React/RSC/Vite/vinext и транзитивные уязвимые компоненты.
Внешние Actions четырёх действующих workflows закреплены commit SHA. Сохраняются
раздельные публикации, минимальные permissions, SSH host pinning и проверка
текущего production commit. Новые способы авторизации и E2EE не включаются.

На main включена защита: изменения через PR, обязательные актуальные
`web-and-api` и `android`, разрешённые обсуждения, запрет force push и удаления.
Правила действуют и для администраторов. Обязательный внешний reviewer не
назначен: у проекта один доступный maintainer; это остаётся ограничением
независимого review, а не заявлением о проверке вторым человеком.

Android проверяет общедоступную подписанную policy без учётной сессии. ECDSA
P-256/SHA-256 подписывает точные байты payload; public key встроен в клиент,
private key хранится вне репозитория и hosting. HTTPS не заменяет подпись.
Публичный ключ: `releases/android-security-policy-public.pem`.
Policy не содержит URL произвольного APK: каналы фиксированы в клиенте.
Размеры, схема, целочисленные поля, package и срок проверяются до применения.

Раздельные site/play floors равны **0**, sequence=1. Crypto protocol=0 означает
старую account-key схему. Это не E2EE. Ненулевой floor требует отдельно
подтверждённых доставки, сохранения подписи/данных, восстановления emergency copy,
crypto review и проверки entrypoints. Скрипт подписи требует эти доказательства.

Новая policy должна иметь возрастающий sequence. Клиент сохраняет candidate;
активация возможна только после независимой проверки доступной версии через
Play AppUpdateInfo или свежий APK manifest. Отключённые/неполученные политики
не блокируют первый офлайн-запуск. Уже активированный floor сохраняется после
перезапуска, expiry, отмены Play, сбоя сети и отката часов. Повреждённое сохранённое
состояние активации закрывает рабочие функции. Более новая версия удовлетворяет
floor по versionCode и crypto protocol; строка «3.3.6» не зашита в gate.

Gate заменяет корневую композицию, включая уведомления/deep links. Общие
транспортные/мутационные guards и receivers/workers проверяют блокировку.
Отмена writer выражена CancellationException, чтобы остановка корутины не
превращалась в необработанное падение. Эти клиентские проверки не являются
серверной криптографической границей: уже отправленный запрос нельзя отозвать.
Для 3.3.6 обязателен серверный atomic fence на всех изменяющих маршрутах.

Play использует IMMEDIATE с новым AppUpdateInfo при повторе; после отмены
сохраняется собственный экран блокировки, без бесконечного цикла окон. APK
сохраняет штатную проверку package/signature и защиту от устаревшего manifest.
Систему нельзя заставить доставить выпуск отсутствующей в rollout установке.

## Реестр данных и границы доверия

Ни одна строка таблицы не считается мигрированной в новый E2EE в 3.3.5.
Реестр составлен по существующим путям; при добавлении новых repository/transport
путей он должен обновляться вместе с интеграционным тестом.

| Данные | Клиент и локальная копия | Сервер/сеть/архив | Что требуется в 3.3.6 |
| --- | --- | --- | --- |
| Задачи, проекты, привычки, настройки, удалённые записи | `app/cloud-sync.ts`, browser base/outbox; native `CloudWorkspaceSync`, Room tasks/documents/outbox, `LocalCipher` | workspace envelope в `server/src/repository.php`; старый account key известен серверу; runtime backup | Новый случайный root на клиенте; snapshot до сети, AAD, CAS, tombstones и outbox в migration manifest |
| Дневник, сны, личные заметки | `diary-storage.ts`, `DiaryRoomStore`, `DiaryKeystoreCipher` и chunk rows | приватные документы и их копии/экспорт | Перешифровать содержимое и все вложенные ключи; не пропускать chunks и локальные черновики |
| Личные mindmaps и история | `mindmaps-storage.ts`, native repositories и журнал преобразования | личные documents; перенос в общий проект | Связать object/domain/epoch; перенос как новая авторизованная операция |
| Aurora, Гно, история раскладов | `app/aurora`, `AuroraNativeStore`, account-key cache | серверные операции/документы и резервные копии | Отделить серверно проверяемые права и лимиты от приватных текстов/истории |
| ФЮЗИС и здоровье | `app/physis-*`, native account-vault | отдельный encrypted account vault и backups | Независимые domain keys, новая обёртка/данные; серверный ключ не сохраняет право чтения |
| Сообщения и черновики | `private-message-crypto.ts`, `private-message-vault.ts`, `MessagingStore` | ECDH/HKDF ciphertext, identity pins и metadata | Сохранить историю; отдельный ADR по поддерживаемой ratchet-библиотеке; текущая схема не обещает forward secrecy |
| Общие проекты, задачи, комментарии | shared editor IndexedDB, `SharedOfflineStore`, native gateways/cache | `shared-content-storage.php`, ACL/membership, activity | Project epoch keys, подписанное членство, отзыв и выдача истории по явной политике |
| Общие вложения и отложенная отправка | `SharedTaskFilesDraftStore`, native attachment transport, browser drafts | `shared-task-attachments.php`, blob store | Проверенные AEAD chunks и manifest, ограничения размера, очистка temp без потери pending files |
| Поиск, previews, напоминания, widgets | производные web caches, Room reminders, alarms/receivers | push metadata, фоновые sync jobs | Только разрешённый минимум при locked vault; тесты всех writers и уведомлений |
| Импорт/экспорт, локальные safety snapshots | `backup-*`, `BackupSafetyStore`, native import/export и emergency snapshot | `backups.php`, runtime `config.php` + SQLite | Строгий parser, staging/preview/atomic apply; billing/ACL/OAuth/device authority не импортируются |
| Identity, платежи, referral/entitlements | cached account entry и session material | authoritative API, provider history, server config | Отделены от восстанавливаемого пользовательского контента; архив не выдаёт права |
| Google Calendar, AI, spelling и другие внешние действия | явные UI/transport пути | данные уходят соответствующему обработчику по выбранной функции | Точное описание согласованного plaintext и metadata; не называть внешнюю копию E2EE GENESIS |
| Логи, traces, crash reports, OS backups | временные файлы, clipboard, recents, browser profile | CI artifacts, серверные логи, системные архивы | Canary проверки; без токенов/ключей/контента; отдельные сроки хранения и удаление |

## Контракт следующей версии (до реализации и review)

1. Свежий client-generated 256-bit vault root. Старый account key не используется
   для derivation нового root. Отдельные случайные DEK для объектов/проектов;
   обёртки под domain-separated HKDF keys. Окончательный suite и encoding
   фиксируются межплатформенными vectors до записи production данных.
2. AES-256-GCM с уникальным 96-bit nonce. AAD связывает protocol, owner, domain,
   object, cryptoEpoch и schemaVersion в одном версионированном бинарном формате.
   Retry повторяет тот же ciphertext/operationId; тот же ID с другим payload
   отвергается. Новая операция получает новый nonce. Файлы используют отдельный
   object key, chunk index/total и проверяемый manifest.
3. Google-only identity не открывает vault. Enrollment требует подтверждения
   доверенным устройством или recovery secret, challenge с TTL и single-use,
   привязку аккаунта и обеих ключевых идентичностей. Сервер сам не выдаёт себе
   устройство. Recovery secret хранится отдельно, проверяется пробным восстановлением.
4. Отзыв повышает security/membership epoch, отсекает новые подписи/сессии и
   меняет ключи будущих данных. Уже прочитанные данные отозвать невозможно.
   Новый участник не получает старую историю автоматически.
5. Encrypted IndexedDB/outbox/drafts; root в памяти после явной разблокировки.
   WebAuthn PRF либо отдельно проверенный KDF fallback, без raw key в storage.
   Android Keystore user-presence policy и обработка инвалидирования без очистки.
   Фоновая работа при закрытом vault не извлекает чувствительные тексты.
6. Состояния миграции: legacy → local-snapshot → shadow-upload → client-verify →
   atomic-commit → active → legacy-retired. Один migrationId, обязательные
   expectedRevision/dataGeneration и idempotency; crash возобновляет тот же шаг.
   Перед commit сервер ставит scope fence; после него любой legacy write,
   включая restore/shared/attachment/background, отклоняется по crypto contract.
7. Текущий writerProtocol и Android version header не заменяют cryptoProtocol,
   cryptoEpoch, securityEpoch или подпись устройства. Сервер видит ciphertext
   и проверяет структуру/полномочия, клиент проверяет полноту расшифрованных данных.
8. Подписанные checkpoints обнаруживают откат относительно доверенного состояния.
   Полный fork/rollback нового устройства без внешнего witness не гарантирован.
9. После cutover возможен только совместимый E2EE repair/release. Нельзя
   автоматически вернуть account-key mode, откатить БД или очистить local storage.
   Прямые обновления 3.3.4 и старше → 3.3.6 обязательны без промежуточной 3.3.5.

## Операционные runbooks

### Emergency copy

`.genesisrescue` — отдельный AES-256-GCM архив со случайным ключом, 12-byte IV и
фиксированным versioned AAD. Ключ отображается отдельно, не сохраняется в prefs
или автоматически в clipboard. Snapshot читает Room transaction и локальные
preferences без sync. Сохраняются task revision/done/tombstones, documents/drafts,
outbox operation IDs/state и reminder state. Cached identity/billing authority
исключена. Неизвестные ячейки сохраняются исходными и перечисляются в manifest.

Ограничение: не все вложенные данные переносимы с прежнего устройства, полного
автоматического восстановления пока нет. Это явно написано на 14 языках.
**Активировать обязательный floor с таким незавершённым recovery запрещено.**
До активации нужно завершить переносимый parser/importer, проверить все scope/
вложения и восстановление на чистом устройстве. Архив сам по себе не повышает
billing, shared ACL или доверие к устройству.

### Системная копия

`ops/encrypted-runtime-backup.py` принимает готовый snapshot из существующего
`backup-runtime.php`, не читает live config и не заменяет текущую CI/CD.
Официальный age 1.3.2 шифрует tar stream публичному recovery-получателю; plaintext
tar при шифровании не записывается. Manifest содержит хеши и размеры всех трёх
файлов. Restore принимает только whitelist, отвергает links/пути/неожиданные
записи, неверный ключ/tag/hash и существующий destination. Config не исполняется,
БД не активируется. Выходной digest требуется хранить независимо от hosting:
публичный age recipient сам по себе не доказывает автора архива при полной подмене.

Перед production-интеграцией владелец назначает отдельного recovery-получателя,
offsite destination, независимое хранение digest и retention. Private identity
не хранится на hosting, GitHub или рядом с архивом. Восстановление выполняется
в изолированную private directory с SQLite integrity-check и проверкой версии.
Windows-хост должен иметь закрытый ACL родительской папки: chmod не заменяет ACL.
Только после успешного drill допускается отдельная активация восстановленной
системы. retain=20 означает число копий, не дни. Legacy copies и ключи не удаляются
до согласованного срока, полного coverage и успешного restore нового поколения.

Владелец подтвердил наличие только Hostinger. Вариант Google Cloud Storage
Free Tier, ограничения оплаты и расчёт объёма подготовлены в
`docs/offsite-backup-google-cloud.md`; внешнее хранилище пока не подключено.

### Выпуск и включение policy

Сначала Source checks и подпись APK/AAB. Затем отдельный web/API Deploy,
Android release и APK-only publish с проверенным incumbent SHA. Флаг
GENESIS_DEPLOY_ANDROID=true только на публикацию APK, после неё false.
В Play используется существующий Open testing, Alpha/Production не меняются.
Policy 3.3.5 остаётся нулевой. Ненулевую policy подписывают только после
приёмки восстановления, writer guards, cancel/resume/process death, прямого
обновления с прежним сертификатом и реальной доступности нужному cohort.
Не использовать понижение floor как аварийный выключатель: активный floor sticky.
При сбое доставки чинить канал и выпускать совместимое исправление.

### Остаточные ограничения

Сервер по-прежнему обладает legacy account keys. Web origin может подменить
клиент, активный вредоносный JS/разблокированное заражённое устройство остаются
вне гарантии шифрования хранения. Privacy документы сохраняют это описание.
Production offsite rotation, полный vault/enrollment/recovery, новый shared/file
protocol и crypto enforcement ещё не включены. Это открытая работа 3.3.6,
а не закрытые находки аудита.
