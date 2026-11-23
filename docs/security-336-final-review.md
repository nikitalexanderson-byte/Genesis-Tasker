# 3.3.6 — итоговое внутреннее крипторевью

Статус21 ноября2026: **предстоит после завершения кода и общей приёмки**.
Владелец прямо поручил провести его самому исполнителю и снять требование
внешнего заключения для этого выпуска. Это внутренний AI review тем же автором;
независимый человеческий аудит не заявляется. Исходный сохранённый prompt
не меняется; это уточнение применяется поверх исторических требований review.

1. Зафиксировать конечный commit, lockfile, SHA-256 web/native inputs и артефактов.
   Не переносить PASS старого ядра на новый продуктовый diff.
2. Повторно разобрать модель угроз, точный охват всех20 private paths и реальные
   web/API/Android entrypoints: identity отдельно от crypto authority, ключи,
   enrollment/recovery, directory/checkpoints, revoke/rotation, shared ACL,
   бизнес-подписи, файлы, локальные очереди/формы и резервные копии.
3. Сверить межплатформенные vectors, AEAD/AAD/nonce/KDF/signature validation,
   парсеры и лимиты, immutable retry, stale epochs, replay/fork/rollback,
   cancelled/unknown outcomes, lock/account switch и отсутствие downgrade.
4. Пройти применимые исходные48 сценариев по acceptance matrix с сохранёнными
   входами/артефактами и реальными ограничениями. APK до3.3.5 исключены владельцем;
   прямое3.3.5/149 →3.3.6 с подписью/данными/очередями остаётся обязательным.
5. Проверить canaries на отсутствие новых raw keys/private plaintext в сети,
   серверном хранении/логах, web storage, Android temp/system backup; исключить
   перенос sessions, grants, entitlement, tokens и живых команд через импорт.
6. Зафиксировать найденные дефекты и воспроизводимость, исправить подтверждённые
   проблемы, повторить затронутые проверки. После изменения security-пути обновить
   review для нового commit/artifact; failed/skipped не обозначать PASS.
7. Отдельно проверить смысл security/recovery/privacy/update copy на14 языках,
   особенно английском, и честность публичных обещаний. Не заявлять forward
   secrecy для сохранённого протокола сообщений или защиту от same-origin XSS.
8. Сформировать итоговый вывод с фактическим охватом, остаточными ограничениями
   и готовностью конкретного кандидата. Только после выполненных условий перейти
   к уже разрешённым раздельным web/API/APK release workflows.

Существующие условия охвата, восстановления, обязательного обновления, сохранения
package/сертификата/данных и подтверждённой доставки не ослаблены. Pilot/cutover,
floors и GENESIS_DEPLOY_ANDROID не меняются одним редактированием этого файла.

## Промежуточная смысловая сверка23 ноября

Повторно прочитаны168 значений на всех14 языках: vault-copy
`kitHint/privacy/offlineDescription`, native-key-recovery `notice`,
personal-device-entry `codeNotice/replaceNotice/retainedNotice` и все5 значений
native-unlock. Смысл сохранён: Google identity не расшифровывает vault, recovery
secret не отправляется серверу, offline edits ожидают online unlock; локальный
код браузера не заменяет recovery, отзыв требует нового одобрения, прежняя
история не воспроизводит команды, PIN/отпечаток относятся к блокировке устройства.
Новых смысловых противоречий в этом объёме не найдено. Это частная вычитка,
не приёмка остальных текстов или всех экранов. Визуальный повтор vault27:
output/playwright/security336-private-locales-44-1123/, PASS13/13 checks,
112/112 сочетаний14 языков×2 схем×360/390/768/1440 без горизонтального overflow.
Bundle SHA-25632789ed4598609ef29a044c3ee611d1c4caa1808cab66bbfc1a51bdba273a5de
не изменился во время прогона; owned runtime cleanup PASS. Вручную просмотрены
EN light360/dark1440, RU dark390, DE light360 и EL/PL/TR/JA light+dark360;
наложений не найдено. Остальные снимки имеют автоматическую geometry-проверку,
но не полный ручной визуальный просмотр. Это только locked-vault states,
не acceptance остальных security/recovery/shared экранов или font-scale1.3.
Окончательный вывод этого review остаётся открытым до общей приёмки/исправлений.

## Дополнительное доказательство системного восстановления

`output/qa/security336-system-restore-native31-02/results.json`: PASS_LOCAL_SCOPE.
Actual age envelope protects config/SQLite/metadata from controller30 with three
ACTIVE scopes and25 E2EE tables. Wrong identity and tampered ciphertext refused;
three recovered files byte-exact, SQLite integrity/schema/counts unchanged.
Source controller hash E7B28B6E… and consumer31 hash663A4E01… are separately
recorded. Consumer uses actual system PIN and normal workspace repository to read
the retained edited project; background relocks. Synthetic login delivery is
supplied separately and is not claimed as restored provider credentials. External
fixture key destroyed; successful restore plaintext/runtime cleaned. This closes
this bounded restore drill, not signed upgrade or the final entire crypto review.
