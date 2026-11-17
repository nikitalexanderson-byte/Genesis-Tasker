# GENESIS 3.3.5 — переходный выпуск безопасности

Статус: реализация и проверка, не опубликован. Поручение владельца — 17 ноября
2026; дополнительно отключён Google Play Billing. Позднее владелец разрешил
Paddle в 3.3.5 при успешной настройке и проверке. В правильном кабинете 476362
домен остаётся In review, интеграция ещё не прошла E2E; сейчас доступна только ЮKassa.

## Исходное состояние

- Репозиторий `nikitalexanderson-byte/Genesis-Tasker`, база `d1d5be6c` из `main`.
- Сайт/API `de4938d5`, Deploy `43993908653` success.
- Android 3.3.4/147, релизный исходник `d850ed11`; последний подписанный run
  `43868424624`, APK-only публикация `43882600504`.
- Рабочая ветка `codex/security-bridge-3-3-5`; чужой `demo-output/` сохранён.
- В Play Console проверен All app bundles: максимальный занятый код 147.
  Выпуск готовится как **3.3.5/148**. Open 147 уже доступен тестировщикам.

## Приёмка 3.3.5

1. Исправленные зависимости и закреплённые Actions; редактированный secrets scan.
2. Реестр приватных data paths, ADR и план безопасной миграции для 3.3.6.
3. Общая проверяемая update policy и gate для Play/APK, в том числе background
   writers и обходные entrypoints. Обязательный порог пока выключен.
4. ЮKassa — единственный активный checkout. Lemon Squeezy удалён из действующих
   путей; Paddle и Google Play Billing выключены. История и права сохранены.
5. Гно для Premium/Business/Elite/Elite+, точные девять карт, недельный лимит,
   отдельные/неограниченные перебросы Elite+; приглашения от Standard.
6. Проверки переводов 14 языков, web размеров/схем, Android, подписи и сохранения
   локальных данных. Результаты добавляются по факту, не по ожиданиям.
7. Штатный web/API Deploy отдельно от APK-only публикации; AAB в существующий
   Open testing. `GENESIS_DEPLOY_ANDROID=false` вне публикации APK.

## Граница E2EE

3.3.5 — совместимый переходный выпуск. Он не обещает, что существующие данные
стали недоступны серверу. Новый crypto cutover, enrollment/recovery и retirement
требуют завершённой реализации, межплатформенной проверки и независимого review.
Прямое обновление старых клиентов сразу на 3.3.6 обязательно; установка 3.3.5
не может быть условием сохранения данных.

## Доказательства

Артефакты проверок: `output/release-3.3.5/`. Исходный аудит:
`output/security-review-2026-11-17/security-e2ee-report-2026-11-17.md`.
| Проверка | Фактический результат до публикации |
| --- | --- |
| CI locked install | `pnpm@11.19.0 install --frozen-lockfile` PASS |
| Полный dependency audit | 0 advisories после согласованных upgrades/overrides; не гарантия безопасности всего продукта |
| TypeScript | typecheck PASS |
| ESLint | 0 errors, 4 прежних предупреждения img; чужой demo-output исключён |
| JS tests | 1234/1234 PASS; Workers SSR проверяется через реальный Wrangler runtime |
| PHP suites | 130/131 в первом прогоне; исправлено старое ожидание routing и повторный целевой suite PASS |
| Изолированный HTTP API | 402 PASS, 0 FAIL, пять тарифов, без production данных |
| i18n | английский, остальные 12 каталогов, native/template/notification checks PASS; RU/EN и ещё 12 security-update таблиц и release notes вычитаны по смыслу |
| Static web | build:web PASS; 13 locale chunks, публичные страницы, offline precache проверены |
| Android unit/build | Финальная сборка после правки account preferences: `android-final-3.log` BUILD SUCCESSFUL; 1060 tests, 0 failures, 8 ранее пропускаемых; debug и androidTest assemble PASS |
| Backup drill | официальный age 1.3.2, побайтное совпадение, SQLite integrity/content PASS; wrong-key/truncation/tamper/digest/overwrite rejected |
| Шапка web | Today и Дела на 360/390/768/1440, light/dark: 16 after-снимков; оба before пользователя сохранены; detector [] |

Первый локальный полный web-прогон остановлен: bundle был собран без
`GENESIS_MINDMAPS=true`, а старый CSS-selector карты дня уже не соответствовал
принятому интерфейсу. Сама выбранная карта была видна и сохранена. Сценарий
переведён на доступные имена region/button; повтор выполняется с production
флагом mindmaps. Это не дефект данных и не повод менять принятый дизайн.

PR #37 создан, HEAD `39d1f641` прошёл lint/typecheck и 1233/1234 JS tests в CI.
Единственный сбой — устаревшее ожидание версии 3.3.4/147. Оно заменено на
3.3.5/148; полный локальный повтор дал **1234/1234 PASS** (`js-final.log`).
Браузерный сценарий цен также обновлён: в обеих геолокациях проверяются реальные
цены ЮKassa в RUB вместо прежнего USD-каталога. Ранний запущенный процесс ещё
содержит старый сценарий и не считается финальным зелёным прогоном.

API26 на предыдущей сборке: gate/restart/deep link/writer guards/offline rescue,
release notes на 14 языках в обеих схемах при масштабе 1.3 и передача APK
системному установщику — **3/3 PASS** (`native-api26.log`). Проверка финальной
сборки продолжается отдельно. Затем владелец явно подключил realme RMX5000
для проверки и финального обновления. Основная установка 3.3.4/147 из Play
сохранена; её сертификат совпадает с прежним release certificate.
Отдельная синтетическая QA-установка прошла **5/5**: update gate, release notes
на 14 языках/двух схемах, текущий Gno wizard на 14 языках, graceful bootstrap
failure/close и owner-bound encryption. Расширенная приёмка 44 наборов выполняется
отдельно и пока не объявляется завершённой. Realme запрещает shell pm clear/grant;
runner получил явный режим reinstall только для task-owned QA package, с проверкой
уведомлений, предоставленных штатной установкой. Настройки безопасности телефона
не ослаблялись; основное приложение не очищалось.

Создан реальный snapshot Hostinger, зашифрован age 1.3.2 и сохранён локально:
**17 525 112 bytes**, SHA-256
`c9d90bd7b8aeeeb368502219a87981da8d3a00340c23db00a4bde03f412949f0`.
Restore drill проверил manifest/hash/size трёх файлов и SQLite integrity_check=ok;
config не исполнялся, production restore не выполнялся, временный plaintext удалён.
По последующему поручению зашифрованный архив и несекретный digest размещены
в отдельной закрытой папке Google Drive nikitalexanderson. Permissions readback:
только owner, shared=false. Архив скачан обратно: SHA-256 совпал побайтно.
Private age identity на Hostinger/Drive не передавался. Периодическое расписание
пока не настроено. Личные зашифрованные копии в Google Drive из настроек приложения
одобрены для этапа 3.3.6, но ещё не реализованы.

Первый полный web-прогон: 380 PASS / 6 FAIL. Пять сбоев — запущенный до исправления
старый USD-тест цен. Шестой: Standard offline edit сохранился, но после reload
Chromium получил ERR_CONNECTION_FAILED для rolldown runtime и оставил SSR-страницу.
Trace не показывает потерю сессии или данных; повторный Standard offline edit/reload
PASS. Отдельный повтор Standard завершён с featureExitCode=0 и startup gate PASS,
92 строками PASS; обновлённые RUB-цены в двух регионах тоже прошли. Остальные тарифы
и итоговый CI учитываются отдельно.

## Secrets scan

Официальный gitleaks 8.30.1, checksum архива проверен. История: 105 commits,
315 MB, **27 raw findings**, повторяющих девять мест в baseline commits.
Текущий checkout: 865 MB, **10 raw findings**. Отчёты полностью redacted.
Не писать «gitleaks zero»: срабатывания есть, они классифицированы.

| Места | Классификация |
| --- | --- |
| WorkspaceCipherTest, webcrypto-vectors, backups/web-v1.json | Синтетические межплатформенные vectors |
| shared-notifications.php test | Публичный RFC fixture |
| web-push.php test | Детерминированно построенный тестовый DER key |
| cloud-sync PENDING_KEY, solar-place SOLAR_PLACE_KEY | Имена localStorage, не credential |
| .vinext/cache/.rscinfo | Игнорируемый локальный runtime build cache, вне tracked/staged |

Действующие credentials в этих находках не установлены. Production config/DB
для тестов не читались. Подписывающий private key update policy остаётся вне
репозитория и hosting; в commit входит только public PEM.

## 48 сценариев аудита: границы доказательств

Исходный реестр и критерии не заменены новыми unit-тестами. Статусы относятся
к фактической области 3.3.5; «отложено» означает обязательную работу до 3.3.6.

| ID | Состояние |
| --- | --- |
| 01 | Node-подпись disabled policy читается JCA/Kotlin; vectors будущего vault отложены |
| 02–05 | Подпись/tamper/wrong signer, parser limits/integer/schema и random emergency nonces проверены; новый E2EE contract ещё не включён |
| 06 | Новый файловый chunk protocol отложен |
| 07–14 | Fresh-root, enrollment, отзыв/ротация, clean-device recovery отложены; сервер всё ещё знает legacy account keys |
| 15–16 | Wrong emergency key не раскрывает архив; потеря всех vault ключей и полный recovery flow отложены |
| 17–20 | Encrypted web vault, multitab epoch, account switch и новое Keystore-unlock поведение отложены |
| 21 | Redacted history/current secrets scan выполнен; полный canary-аудит устройств и внешних crash systems ещё нужен |
| 22 | Offline emergency snapshot включает локальные tasks/outbox/drafts; инструментальная проверка ниже |
| 23–27 | Новая migration state machine/CAS/fence и legacy-write rejection отложены; формат текущей sync не менялся |
| 28–30 | Прямые переходы на 3.3.6 и multi-device migration отложены; 3.3.5 не является обязательной ступенью |
| 31–32 | Новый E2EE importer отложен; emergency copy не принимается как billing/ACL/identity authority |
| 33–37 | Shared epoch/history, ratchet, checkpoints и fork discovery отложены |
| 38–39 | Gate не снимается callback отмены; persisted/recreated UI проверяется отдельно; настоящий Play IMMEDIATE/cancel/reboot требует доставленного следующего выпуска |
| 40 | Unit: версия должна реально удовлетворять floor; будущий policy/expired policy/недошедший cohort не блокируются |
| 41 | Known gate сохраняется без сессии/сети; ещё не проверены реальная нехватка диска и отсутствие Play services |
| 42 | SHA/package/cert проверяются release workflow; реальный переход с Play delivery certificate на site APK ещё не доказан, uninstall не предлагается |
| 43 | Общие guards/receivers/workers и замена root composition реализованы; полная гонка всех writers до ненулевого floor остаётся обязательной |
| 44 | Новое server crypto enforcement отложено; version header не считается защитой |
| 45 | Синтетический и реальный runtime backup проверены; private Drive offsite roundtrip SHA-256 PASS, реальный SQLite integrity-check PASS; расписание ещё не включено |
| 46 | Внешние plaintext-потоки не менялись; новый аудит согласий обязателен до E2EE claims |
| 47 | Изменённые copy/release notes на 14 языках вычитаны; native автоматический аудит PASS; все экранные состояния на всех языках не объявляются проверенными |
| 48 | Web header matrix PASS; API26 и realme 5/5 PASS; полная realme-регрессия продолжается по новому поручению |

Архитектурные решения, реестр данных, ограничения и activation/restore runbook:
`docs/security-bridge-335-adr.md`. Обязательный floor остаётся **0**; полного
переносимого emergency recovery и нового E2EE пока нет.
