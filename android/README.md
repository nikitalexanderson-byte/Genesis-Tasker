# Нативный Android-клиент

Самостоятельное приложение на Kotlin и Jetpack Compose; используются Room, WorkManager и нативные контракты PHP API. Исходники текущей версии: `3.2.7/139`, package `ru.genesis.calendar`. Минимальный API 26, target API 37, compile SDK 37.2. Release и debug имеют разные идентификаторы и сертификаты.

## Сборка без release-ключей

Нужны JDK 25, Android SDK `platforms;android-37.2`, `build-tools;37.0.0`, `JAVA_HOME` и `ANDROID_HOME`. Gradle 9.6.0 закреплён Wrapper-ом; AGP/Kotlin/Compose и библиотеки закреплены в build-файлах и `gradle/libs.versions.toml`.

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug \
  -PgenesisUrl=https://localhost.invalid/ \
  -Pkotlin.compiler.execution.strategy=in-process --max-workers=2 --no-daemon
```

На Windows используйте `gradlew.bat`, заключив аргументы `'-PgenesisUrl=…'` и `'-Pkotlin.compiler.execution.strategy=in-process'` в кавычки. Локальное `file.encoding=COMPAT` сохраняет кириллические пути в JVM argfiles; исходники остаются UTF-8. Системные настройки кодировки не меняются.

Debug APK создаётся в `app/build/outputs/apk/debug/app-debug.apk`, package — `ru.genesis.calendar.debug`. Он не может обновить основную установленную версию. `-PgenesisUrl` задаёт origin для конкретной сборки; для проверки без внешнего аккаунта используется недействительный тестовый адрес выше.

## Проверка

JVM-набор проверяет предметную логику, даты, хранилища, криптографию, тарифы, совместимость и контракты. HTTP integration cases требуют соответствующих `GENESIS_*_HTTP_TEST` и loopback fixture; без них часть JUnit-тестов пропускается. Instrumentation находится в `app/src/androidTest/` и требует отдельного эмулятора/устройства. Успешный JVM-run не означает полную проверку UI или живого Google-входа.

Для ADB всегда выбирайте точный serial: `adb -s <serial> …`. Используйте отдельный debug package и синтетические данные; основное приложение не удаляйте и не очищайте. Совместимое обновление основной установки требует прежнего release-сертификата и возрастающего versionCode. Signing keys и распространяемые APK/AAB в репозитории отсутствуют; CI выполняет только debug build и тесты.

Общие инструкции: [локальная разработка](../docs/LOCAL_DEVELOPMENT.md), [тестирование](../docs/TESTING.md), [подтверждённые результаты](../docs/VERIFICATION.md).
