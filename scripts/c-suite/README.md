# Локальная связанная приёмка C1–C6

Тесты используют настоящий `AuthSessionClient`, `AuthController`, Android Keystore, HTTPS и текущий PHP API. Создаются только синтетические участники `@example.invalid` и собственные тестовые пространства. Google credentials, внешняя почта и push не нужны. Для обычных модульных тестов этот стенд не требуется.

Нужны PHP с `pdo_sqlite`, `sodium`, `mbstring`, Node, OpenSSL, Android SDK и эмулятор. Все команды выполняются из корня checkout. Не запускайте стенд в production. `setup.php` отказывается заменять существующий `server/config.php` или базу стенда; router разрешает только loopback и проверяет путь к тестовой БД для каждого запроса. Файлы runtime остаются в ignored `output/c-suite/https/`.

1. Установите `GENESIS_IMPROVEMENTS_TEST=isolated` в процессах PHP и Node. Выполните `php scripts/c-suite/setup.php`.
2. Создайте отдельный localhost-сертификат в ignored runtime:

   ```sh
   openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout output/c-suite/https/localhost.key -out output/c-suite/https/localhost.crt
   ```

3. Запустите в отдельных терминалах `php -S 127.0.0.1:4338 scripts/c-suite/router.php` и `node scripts/c-suite/tls-proxy.mjs`.
4. Соберите отдельный debug/test пакет из `android/`:

   ```sh
   ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -PgenesisDebugApplicationIdSuffix=.ghttps.debug -PgenesisUrl=https://localhost:4443
   ```

   В PowerShell используйте `./gradlew.bat` и заключите каждый `-P…` аргумент в одинарные кавычки.

5. Установите оба debug APK на эмулятор через `adb -s emulator-5554 install -r …` и выполните `adb -s emulator-5554 reverse tcp:4443 tcp:4443`. Release-приложение не удаляется и не очищается.
6. Передайте AndroidJUnitRunner аргументы `genesisPlanningHttps=true`, `genesisFixtureCa=<base64 public PEM localhost.crt>` и `class=ru.genesis.calendar.auth.NativeCSuiteHttpsTest,ru.genesis.calendar.ui.SharedCSuiteHttpsUiTest` для пакета `ru.genesis.calendar.ghttps.debug.test`. Применения шаблонов одного synthetic editor запускаются последовательно: их fingerprint учитывает квоты владельца. Независимые UI-проходы создают собственные пространства и меняют только их проектные правила. Без opt-in стенда тесты пропускаются.

`NativeCSuiteHttpsTest` проверяет шаблон → семь типов полей → JSON roundtrip → независимые связи/значения → фактическую историю отчёта → защиту поздней правки при undo; отдельно — worker, идемпотентность, проектные ограничения, отчёты/экспорт и отзыв прямых чтений. `SharedCSuiteHttpsUiTest` открывает все шесть функций из настоящего общего меню приложения и проходит отчёт → выборку → задачу → системный Back. `genesisCSuiteCapture=true` сохраняет PNG в cache debug-приложения; `genesisCaptureDark=true` выбирает тёмную схему.

Существующие `NativeTemplateHttpsIntegrationTest`, `NativeFieldDefinitionsHttpsTest`, `NativeFieldEditorHttpsTest`, `NativeTaskFieldQueryHttpsTest`, `NativeLegacyFieldOptionsHttpsTest` используют тот же стенд. Серверные CLI suites запускаются отдельно в собственной fresh SQLite, как в `deploy.yml`.

Завершив работу, остановите только процессы стенда и выполните `php scripts/c-suite/setup.php cleanup` с тем же opt-in. Удаление конфигурации требует совпадения SHA-256 и точного пути тестовой БД. Сертификат/ключ и runtime не включаются в Git или deploy.

Изолированные приёмки также допускают фиксированные `GENESIS_ACCEPTANCE_SUITE=efg-suite`, `kul-suite`, `audit-suite` и `audit-ui-suite`. У каждого свой ignored `output/<suite>/https/`; существующая БД не перезаписывается. Во всех процессах и при `cleanup` выбирайте один и тот же namespace. Два стенда не запускаются одновременно: конфигурация PHP общая, её принадлежность и точный путь БД проверяются по SHA-256.
