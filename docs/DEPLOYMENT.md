# Выпуск сайта и API

Production: [genesiscalendar.com](https://genesiscalendar.com), Hostinger. Разрешён только корень `/home/u531952483/domains/genesiscalendar.com`: публичный клиент/API router в `public_html`, закрытый PHP-код в `server`, runtime в `server/var`, закрытые резервные копии в `backups`. Соседние сайты не входят в эту процедуру.

## Проверка и web/API-выпуск

`Source checks` автоматически проверяет push/PR и может запускаться вручную. Он не получает production credentials и собирает только debug Android.

`Deploy` запускается только вручную из `main` репозитория `nikitalexanderson-byte/Genesis-Tasker`. Вводятся полный SHA текущего `main` и полный SHA действующего сайта из `deploy-meta.json`. До обращения к SSH workflow сверяет checkout, current main и последний подходящий успешный `Source checks` точного SHA. Старый успешный run не скрывает новый failed/pending run.

Нужен только secret `HOSTINGER_SSH_KEY`, переданный через защищённый канал GitHub Secrets; его значение не публикуется. Variable `GENESIS_DEPLOY_TARGET=hostinger` обязателен. Сборка использует `GENESIS_MINDMAPS=true`; Android-выпуск в этом workflow всегда выключен. Credentials Google, платежей и подписи Android не нужны этому workflow и не копируются в репозиторий. SSH host key закреплён в `ops/deploy-known-hosts`.

## Порядок публикации

1. Проверить окончательный SHA, отсутствие активной выкладки из прежнего репозитория и актуальность production SHA. Concurrency GitHub действует внутри одного репозитория и не блокирует другой.
2. Дождаться успешного `Source checks`; получить этот SHA заново из GitHub и подтвердить установку, сборку и основной smoke. Подготовить rollback до dispatch.
3. Запустить `Deploy` с точным проверенным SHA и ожидаемым SHA сайта. Workflow повторно проверит production по HTTPS и локальный `deploy-meta.json` на сервере перед публикацией.
4. Проверить корни и отсутствие symlinks, установить два maintenance helper без удаления других файлов `ops`, сохранить согласованную SQLite-копию с `config.php`. `integrity_check` обязателен; права каталогов 0700, закрытых файлов 0600, удерживаются 20 runtime-копий.
5. Зафиксировать граф incumbent assets, обновить закрытый PHP без `config.php`, `config.example.php`, `var/`, `.git/`; затем добавить immutable web assets без delete и опубликовать клиент/API с отложенной заменой.
6. Сохранить `downloads/` и `android-update.json`. Удалять только истёкшие hashed assets по прежней 30-дневной политике. Проверить `/api/health` и точный SHA/repository в `deploy-meta.json`.
7. Проверить фактически отдаваемые HTML/JS/CSS/JSON, загрузку modules/изображений, документы и изменённый Today в двух схемах. Не использовать реальные личные данные для экспериментов.

Все 120 SQL-миграций совпадают с исходным production-набором; новых схем эта подготовка не добавляет. Миграции в приложении запускаются при обращении к БД, поэтому их набор сверяется до выпуска. Подготовленный workflow не выполняет ручных SQL-правок.

## Android и Google Play

`Android release` вручную собирает APK и Play AAB из проверенного текущего `main`. Он проверяет успешный `Source checks` того же SHA и ожидаемый incumbent сайта. Четыре `GENESIS_ANDROID_RELEASE_*` secrets хранят прежние keystore, alias и пароли только в GitHub Secrets. Ключ используется во временном файле runner и удаляется после сборки. Проверяются package, версия, прежний SHA-256 сертификата, выравнивание APK и отсутствие установщика APK в Play-манифесте. APK/AAB, mapping и контрольные суммы сохраняются как один неизменяемый artifact с `source.json`.

После приёмки артефактов выполнить web/API `Deploy` и проверить сайт. Затем временно установить repository variable `GENESIS_DEPLOY_ANDROID=true` и вручную запустить `Publish Android download` с SHA сайта и ID успешной сборки Android. Он сверяет origin/repository/SHA/workflow/event/run status артефакта, контрольные суммы и уже опубликованный SHA сайта. Сначала загружается APK в тот же разрешённый Hostinger root, затем активируется `android-update.json`. Предыдущий manifest сохраняется вне `public_html`; downgrade и замена другого APK с тем же versionCode запрещены. Оба workflow публикации используют общую production concurrency group. После попытки выпуска вернуть variable в `false`.

После проверки сайта и APK обновить выбранный подключённый смартфон поверх основного приложения с прежними package и сертификатом, без очистки данных. В Google Play загружать соответствующий AAB только в существующий Closed testing Alpha. Production-трек и состав тестировщиков сохраняются; отправка на проверку Google и доступность версии тестировщикам — разные состояния.

## Откат к предыдущему коду

До перехода подтверждён успешный прежний Deploy `42512478732` с commit `fb9ddbfc8b7895ab47544548b81220d927389ea0`. Прежний репозиторий и его credentials сохранены. При регрессии можно повторить именно этот успешный run после проверки `GENESIS_DEPLOY_TARGET=hostinger`, `GENESIS_DEPLOY_ANDROID=false` и отсутствия одновременной выкладки в обоих репозиториях.

Предыдущая проверенная база нового репозитория — `4748a546a5b10105689765b3d3c810f73d1c24fa`, Deploy `42546008666`. Для обычного отката изменений 3.2.8 создать revert-коммит, пройти его `Source checks` и выполнить штатный `Deploy` с актуальным production SHA. Повтор старого run нового workflow без возврата current main не проходит защиту от устаревшей выкладки. Android-загрузки этим web/API-откатом не меняются; возврат поведения установленного Android выполняется новым подписанным выпуском с большим versionCode.

Откат возвращает web/API-код, сохраняя текущие пользовательские данные и Android-загрузки. Он не восстанавливает БД автоматически. При восстановлении БД можно потерять записи после резервирования, поэтому оно требует отдельного решения и не входит в обычный code rollback. После отката снова проверяются health, SHA и основные пользовательские сценарии.

## Запись результатов перехода

На этапе подготовки workflow production оставался на указанном выше исходном SHA. Актуальный статус выпуска подтверждают [запуски Deploy](https://github.com/nikitalexanderson-byte/Genesis-Tasker/actions/workflows/deploy.yml) и [production metadata](https://genesiscalendar.com/deploy-meta.json). Лог успешного запуска содержит runtime backup path и результат проверки SHA/health; независимые результаты приёмки фиксируются в отчёте выпуска. Предварительные и непроверенные состояния перечислены в [VERIFICATION.md](VERIFICATION.md).
