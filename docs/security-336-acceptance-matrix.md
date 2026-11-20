# 3.3.6: незакрытые системные критерии приёмки

Срез20 ноября2026. Нумерация соответствует исходным48 сценариям в сохранённом
аудите17 ноября. Это карта оставшейся приёмки, **не список пройденных тестов**.
Частные доказательства подробно записаны в `release-3.3.6.md` и документах ниже.
Полного выпуска3.3.6, включения pilot/cutover или обновления основной установки нет.

«Частично» означает наличие проверенных компонентов, но отсутствие полной
системной приёмки во всём требуемом охвате. «Не выполнено» означает, что нужное
испытание новой версии ещё не проводилось. Ни одна строка здесь не закрыта
общим количеством unit-тестов, проверкой schema inventory или девятью source
adapters. У финального результата каждой строки должны быть commit/artifact,
конкретный сценарий, платформа, evidence и явно указанные ограничения.

| № | Исходный сценарий | Состояние и конкретный остаток |
| --- | --- | --- |
| 01 | JS шифрует, Kotlin читает, и наоборот | Частично: общие vectors/readers проверены; нужны все product adapters и реальные upgrade/recovery journeys |
| 02 | Изменены ciphertext/tag/nonce | Частично: envelope/source отказы проверены; нужен весь контент и продуктовые ошибки без потери данных |
| 03 | Подменены owner/domain/object/epoch/schema | Частично: общий контракт проверен; нужны все реальные shared/personal маршруты |
| 04 | Неизвестный suite, неверный base64, переполнение | Частично: bounded parsers проверены; остаются large-data и полный набор feature inputs |
| 05 | Retry и crash до/после записи | Частично: immutable queues/receipts/coordinator проверены; все product writers ещё не подключены |
| 06 | Обрезаны/переставлены chunks, подменён manifest | Частично: file primitive и часть source output проверены; действующие вложения/загрузки ещё нужны |
| 07 | Сервер получил DB/config нового поколения | Не выполнено во всём продукте: все11 оставшихся sources и нормальные записи должны перейти в новый формат |
| 08 | Google-вход на новом устройстве | Частично: независимость crypto authority реализована; нужна полная login/unlock UX-приёмка |
| 09 | Подмена public key при QR enrollment | Частично: challenge/signature contract проверен; нужен реальный product enrollment и сравнение fingerprint |
| 10 | Replay истёкшего challenge или чужой аккаунт | Частично: контракт/серверные проверки есть; нужен полный UI/session journey |
| 11 | Отозванное устройство | Частично: directory/capsules/signatures проверены; нужны все фоновые и обычные product writers |
| 12 | Новая эпоха после отзыва | Частично: независимые roots/capsules проверены; остаётся атомарная интеграция ACL+rotation и feature content |
| 13 | Recovery на чистом устройстве | Частично: независимый recovery primitive и source readback есть; полного восстановления аккаунта со всеми данными нет |
| 14 | Только admin account recovery | Частично: identity отделена от ключей в контракте; нужна product-проверка отсутствия доступа к содержимому |
| 15 | Неверный recovery secret или пароль | Частично: crypto/source ошибки сохраняют исходники; нужны все пользовательские recovery/import paths |
| 16 | Потеря всех ключей | Частично: key-loss отказы/retained snapshots проверены; нужна полная понятная UX без пустого replacement vault |
| 17 | Кража browser storage при lock | Частично: новое encrypted storage проверено; действующий legacy product ещё не переведён целиком |
| 18 | Reload, новая вкладка, stale service worker | Частично: реальные worker/two-tab/fence cases есть; остаются общий product routing и uncontrolled/restored pages |
| 19 | Смена аккаунта/logout с pending data | Частично: owner permits и ряд источников проверены; остальные writers/drafts ещё подключаются |
| 20 | Инвалидирование Android Keystore | Частично: actual alias-loss/refusal/retained-key cases есть; полного recovery всех категорий нет |
| 21 | Crash reports, логи, clipboard, temp files | Частично: redaction/ограниченные ports есть; нужен системный canary-прогон финального кандидата |
| 22 | Backup перед первым sync | Частично: девять реальных captures и coordinator проверены; archive web input отдельно прошёл actual File/React/IDB cold readback. Остальные11 полных sources и весь product lifecycle mounted/unmounted drafts обязательны |
| 23 | Обрыв на каждом шаге миграции | Частично: state-machine/частные real cases и отдельное same-actor чтение mixed v1/v2/v3/cancel/orphan history проверены; нужны protected remote originals, полная state4/source/plan публикация, все feature paths, process death и clean restart |
| 24 | Две параллельные миграции | Частично: lease/fence/CAS проверены; полный многоклиентский product-переход ещё нужен |
| 25 | Legacy write во время финального commit | Частично: SQLite/HTTP/SW/owner barriers, полный native backup job и web backup whole-job проверены отдельно; все остальные local/normal/background writers и общая продуктовая приёмка ещё не завершены |
| 26 | Legacy write после activation | Частично: persistent deny и API policy проверены; product activation отключена, полный routing не принят |
| 27 | Старый offline outbox после удаления | Частично: task/diary/map reconciliation cases есть; все очереди и прямые обновления ещё нужны |
| 28 | Прямое3.3.4 →3.3.6 | Не выполнено: подписанного финального3.3.6 APK ещё нет; данные/сертификат должны быть проверены на upgrade |
| 29 | Поддерживаемые старые версии →3.3.6 | Не выполнено: нужны прямые signed upgrades без обязательной промежуточной3.3.5 |
| 30 | Два устройства и web редактируют одни данные | Частично: scoped queues/merge проверены; полного пути всех категорий на трёх клиентах нет |
| 31 | Импорт старого архива | Частично: backup/parser и некоторые журналы есть; нужен новый общий content-only import/restore |
| 32 | Чужой архив с premium/ACL | Частично: отдельная authority и ограничения есть; нужна новая полная import/restore-приёмка |
| 33 | Групповой проект, отзыв участника | Частично: signed role/rotation contract есть; атомарный ACL+rotation и реальные shared adapters не закончены |
| 34 | Новый участник проекта получает историю | Частично: historical grants проверены; нужен реальный shared UX с принятой политикой истории |
| 35 | Смена ключа собеседника | Не выполнено для финального3.3.6: существующие message keys/history сохраняются; нужны предупреждение/проверка и regression journey |
| 36 | Сервер выдаёт старый snapshot | Частично: pinned checkpoints/retired heads проверены; нужен весь product recovery/sync |
| 37 | Новое устройство без checkpoint | Частично: ограничение antirollback документировано; нужна соответствующая trust/recovery UX-приёмка |
| 38 | Play cancellation/back/error | Частично: bridge3.3.5/UpdateGate проверен; нужна приёмка финальной доставляемой версии в разрешённом канале |
| 39 | Play process death/reboot/resume | Частично: bridge/state handling есть; реальный финальный канал3.3.6 ещё не принят |
| 40 | Rollout ещё не дошёл до установки | Частично: policy/delivery guard есть;3.3.6 ещё не доставлена, update floors остаются0 |
| 41 | Нет сети/места/Play, expired login | Частично: bridge/refusal/emergency path есть; полный новый vault/recovery UX ещё нужен |
| 42 | Разные certificates сайта-APK и Play | Не выполнено для финального3.3.6: нужен реальный release artifact/lineage и проверка совместимости без reinstall |
| 43 | Widget/deep link/worker обходят Activity | Частично: bridge/transport/persistent fences есть; все реальные writers ещё требуют проверки |
| 44 | Подделан номер приложения в API | Частично: signature/epoch/protocol contract есть; полная active-scope route-приёмка ещё обязательна |
| 45 | Восстановление системного backup | Частично: внешняя защита system backup подготовлена/проверялась отдельно; нужен restore финального нового поколения без downgrade |
| 46 | Google export, spelling, AI | Частично: границы классифицированы; полная новая consent/external-copy интеграция ещё нужна |
| 47 | 14 языков, особенно английский | Частично: catalogue/design проверки есть; смысловая приёмка новой security/recovery/privacy UX ещё не закончена |
| 48 | Web360/390/768/1440, обе схемы; API26+ | Частично: согласованный дизайн и source cases проверялись; финальный полный product journey всех security flows ещё нужен |

Отдельный обязательный gate — независимый криптографический review человеком
или организацией; он не проведён. Материалы и вопросы:
`security-336-external-review-brief.md`. Возможный запрос Play/личного устройства
не подразумевается общим разрешением web/API/APK Deploy; сначала завершаются
все независимые разрешённые работы и готовится конкретный проверяемый кандидат.

Основные группы доказательств: `e2ee-336-contract-adr.md`,
`e2ee-336-runtime-adr.md`, `e2ee-336-operation-fences.md`,
`e2ee-336-service-worker.md`, `e2ee-336-native-transactions.md`,
`e2ee-336-retained-native-old-keys.md`, `e2ee-336-native-source-stream.md`,
документы конкретных source adapters и `security-bridge-335-adr.md`.
Границы нового read-only coordinator increment и точная приёмка:
`e2ee-336-migration-history.md`; он не закрывает полный системный сценарий.
