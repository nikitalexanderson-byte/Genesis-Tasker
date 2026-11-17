# GENESIS 3.3.5 — переходный выпуск безопасности

Статус: реализация и проверка, не опубликован. Поручение владельца — 17 ноября
2026; дополнительно отключён Google Play Billing, оставлена только ЮKassa.

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
сборки продолжается отдельно. Личные устройства не используются.

Владелец подтвердил, что кроме Hostinger хранилищ нет. Подготовлен вариант
Google Cloud Storage Free Tier (`docs/offsite-backup-google-cloud.md`), но
production offsite destination, платёжный аккаунт и recovery recipient пока
не подключены. Наличие зашифрованного инструмента не означает наличие внешней копии.

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
| 45 | Синтетический полный runtime backup восстановлен и проверен; production offsite destination/recipient ещё не подключены |
| 46 | Внешние plaintext-потоки не менялись; новый аудит согласий обязателен до E2EE claims |
| 47 | Изменённые copy/release notes на 14 языках вычитаны; native автоматический аудит PASS; все экранные состояния на всех языках не объявляются проверенными |
| 48 | Web header matrix PASS; native API26 и расширенные проверки ниже; личные устройства не использовались |

Архитектурные решения, реестр данных, ограничения и activation/restore runbook:
`docs/security-bridge-335-adr.md`. Обязательный floor остаётся **0**; полного
переносимого emergency recovery и нового E2EE пока нет.
