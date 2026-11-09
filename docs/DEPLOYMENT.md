# Выпуск сайта и API

Production: [genesiscalendar.com](https://genesiscalendar.com), Hostinger. Разрешён только корень `/home/u531952483/domains/genesiscalendar.com`: публичный клиент/API router в `public_html`, закрытый PHP-код в `server`, runtime в `server/var`, закрытые резервные копии в `backups`. Соседние сайты не входят в эту процедуру.

## Два отдельных workflow

`Source checks` автоматически проверяет push/PR и может запускаться вручную. Он не получает production credentials и собирает только debug Android.

`Deploy` запускается только вручную из `main` репозитория `nikitalexanderson-byte/Genesis-Tasker`. Вводятся полный SHA текущего `main` и полный SHA действующего сайта из `deploy-meta.json`. До обращения к SSH workflow сверяет checkout, current main и последний подходящий успешный `Source checks` точного SHA. Старый успешный run не скрывает новый failed/pending run.

Нужен только secret `HOSTINGER_SSH_KEY`, переданный через защищённый канал GitHub Secrets; его значение не публикуется. Variable `GENESIS_DEPLOY_TARGET=hostinger` обязателен. Сборка использует `GENESIS_MINDMAPS=true`; Android-выпуск всегда выключен. Credentials Google, платежей и подписи Android не нужны этому workflow и не копируются в репозиторий. SSH host key закреплён в `ops/deploy-known-hosts`.

## Порядок публикации

1. Проверить окончательный SHA, отсутствие активной выкладки из прежнего репозитория и актуальность production SHA. Concurrency GitHub действует внутри одного репозитория и не блокирует другой.
2. Дождаться успешного `Source checks`; получить этот SHA заново из GitHub и подтвердить установку, сборку и основной smoke. Подготовить rollback до dispatch.
3. Запустить `Deploy` с точным проверенным SHA и ожидаемым SHA сайта. Workflow повторно проверит production по HTTPS и локальный `deploy-meta.json` на сервере перед публикацией.
4. Проверить корни и отсутствие symlinks, установить два maintenance helper без удаления других файлов `ops`, сохранить согласованную SQLite-копию с `config.php`. `integrity_check` обязателен; права каталогов 0700, закрытых файлов 0600, удерживаются 20 runtime-копий.
5. Зафиксировать граф incumbent assets, обновить закрытый PHP без `config.php`, `config.example.php`, `var/`, `.git/`; затем добавить immutable web assets без delete и опубликовать клиент/API с отложенной заменой.
6. Сохранить `downloads/` и `android-update.json`. Удалять только истёкшие hashed assets по прежней 30-дневной политике. Проверить `/api/health` и точный SHA/repository в `deploy-meta.json`.
7. Проверить фактически отдаваемые HTML/JS/CSS/JSON, загрузку modules/изображений, документы и изменённый Today в двух схемах. Не использовать реальные личные данные для экспериментов.

Все 120 SQL-миграций совпадают с исходным production-набором; новых схем эта подготовка не добавляет. Миграции в приложении запускаются при обращении к БД, поэтому их набор сверяется до выпуска. Подготовленный workflow не выполняет ручных SQL-правок.

## Откат к предыдущему коду

До перехода подтверждён успешный прежний Deploy `42512478732` с commit `fb9ddbfc8b7895ab47544548b81220d927389ea0`. Прежний репозиторий и его credentials сохранены. При регрессии можно повторить именно этот успешный run после проверки `GENESIS_DEPLOY_TARGET=hostinger`, `GENESIS_DEPLOY_ANDROID=false` и отсутствия одновременной выкладки в обоих репозиториях.

Откат возвращает web/API-код, сохраняя текущие пользовательские данные и Android-загрузки. Он не восстанавливает БД автоматически. При восстановлении БД можно потерять записи после резервирования, поэтому оно требует отдельного решения и не входит в обычный code rollback. После отката снова проверяются health, SHA и основные пользовательские сценарии.

## Запись результатов перехода

На этапе подготовки workflow production оставался на указанном выше исходном SHA. Актуальный статус выпуска подтверждают [запуски Deploy](https://github.com/nikitalexanderson-byte/Genesis-Tasker/actions/workflows/deploy.yml) и [production metadata](https://genesiscalendar.com/deploy-meta.json). Лог успешного запуска содержит runtime backup path и результат проверки SHA/health; независимые результаты приёмки фиксируются в отчёте выпуска. Предварительные и непроверенные состояния перечислены в [VERIFICATION.md](VERIFICATION.md).
