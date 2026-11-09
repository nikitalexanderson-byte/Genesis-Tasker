# Изолированный стенд личных майндмепов

Только локальные тестовые пользователи `@example.invalid`, PHP/SQLite и Chrome. Эти скрипты **не** доказывают живой Google OAuth/Calendar/Tasks. Не запускайте fixture в production checkout. Все команды выполняются из корня отдельного worktree.

Нужны Node/pnpm проекта, PHP 8.3+ с sqlite3, pdo_sqlite, sodium, mbstring, openssl, curl, установленный Chrome и Playwright. В текущем worktree PHP находится в `output/php/php.exe`. Установка дополнительной production/UI-библиотеки не требуется.

## Существующий стенд

Серверы 4319/4320 запущены отдельно. Для просмотра последней проверенной карты:

```powershell
$env:GENESIS_MINDMAPS_TEST = 'isolated'
$env:PLAYWRIGHT_PACKAGE = 'C:/Users/mrdeu/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/package.json'
node scripts/mindmaps/open-test-browser.mjs
```

При отсутствии указанного Playwright укажите путь к своему установленному `playwright/package.json`. Не печатайте и не прикладывайте `output/browser-*.json`, `*-state.json`, БД или `server/config.php`: они содержат локальные сессии/ключи.

## Новый чистый стенд

1. В отдельной ветке/worktree выполните `pnpm install --frozen-lockfile`.
2. Установите `GENESIS_MINDMAPS_TEST=isolated`. Команда `php scripts/mindmaps/fixture.php a` создаст локальный config только если его нет, а затем **проверит точный путь output/mindmaps-test.sqlite и localhost app_url до обращения к БД**. При другом config она остановится; не заменяйте чужой config. Выполните то же с аргументом `b`.
3. В отдельном терминале запустите PHP:

```powershell
$env:GENESIS_MINDMAPS_TEST = 'isolated'
php -S 127.0.0.1:4320 scripts/mindmaps/router.php
```

4. В другом терминале запустите веб:

```powershell
$env:GENESIS_MINDMAPS = 'true'
pnpm exec vite --config scripts/mindmaps/vite.config.ts
```

5. Установите тестовые env из первого блока, выполните `node scripts/mindmaps/prepare-browser.mjs`. Это создаёт приватный browser state тестового пользователя A с одним личным проектом и одной задачей. Не подставляйте личную browser-сессию.
6. Выполните `node scripts/mindmaps/e2e-core.mjs` — он создаст карту и настоящий task ID в локальном task store, изменит её через обычные дела, проверит ссылку и повторное открытие.

Не публикуйте router/fixture как HTTP-ручку. Fixture доступен только CLI; router требует cli-server, isolated env и loopback remote address. Серверные тесты проверяют БД независимо от browser state.

## Повтор проверок

После core:

```powershell
node scripts/mindmaps/e2e-references.mjs
node scripts/mindmaps/e2e-faults.mjs
node scripts/mindmaps/e2e-isolation.mjs
node scripts/mindmaps/e2e-conversion-fault.mjs
node scripts/mindmaps/e2e-recurring.mjs
node scripts/mindmaps/e2e-catalog.mjs
node scripts/mindmaps/e2e-controls.mjs
node scripts/mindmaps/e2e-undated.mjs
node scripts/mindmaps/e2e-navigation.mjs
node scripts/mindmaps/e2e-project-chaos.mjs
node scripts/mindmaps/capture-after.mjs
php server/tests/mindmaps.php
php server/tests/mindmaps-google-contract.php
php server/tests/mindmaps-native-contract.php
php server/tests/mindmaps-migration.php
```

Faults прерывает ответ **после настоящего server commit**; conversion-fault запрещает map PUT после реального сохранения локальной задачи. Это инъекции отказов транспорта, не подменённые успешные backend responses. Isolation использует реальную B PHP-сессию и штатный guard выхода A; не эмулирует полноценный Google login.

Undated требует одновременно flag-on сервер 4319 и flag-off 4322 (запуск ниже). Проверяет настоящую обычную задачу без даты, назначение/снятие даты, отсутствие в загруженном «Сегодня», выполнение, перезапуск и обычное редактирование с выключенным флагом. Сохраняет приватный `output/undated-state.json`; не коммитить. `mindmaps-native-contract.php` использует реальную изолированную SQLite/парсер, но симулирует Google transport; его PASS не является проверкой живого Google.

После undated команда `node scripts/mindmaps/capture-undated.mjs` снимает обычную форму без даты в 10 сочетаниях схемы/ширины. Она явно ставит внутреннюю прокрутку формы и документа в начало без smooth-scroll, ждёт два кадра и сохраняет viewport PNG `form-*.png` поверх прежних. Полный screenshot страницы с открытым fixed modal не используется: он искажает положение окна относительно фона.

Для flag-off запустите ещё один Vite процесс с тем же config, удалив только `GENESIS_MINDMAPS` из его окружения: порт 4322. Затем `node scripts/mindmaps/e2e-flagoff-text.mjs`. Скрипт также делает CSS text-resize 200% и не заменяет проверку экранного диктора/физического телефона.

`e2e-performance.mjs` создаёт архивные документы 200/1000 узлов и считает полный Playwright-сценарий. Затем `performance-isolated.mjs` использует эти документы и измеряет DOM click → два animation frame. Запускайте последний без параллельных сборок/тестов. Методы измеряют разные вещи.

Файлы результатов — `output/mindmaps-*-result.json`, `output/mindmaps-performance-isolated.json`, `output/playwright/mindmaps/`. Результаты не содержат сессионных ключей. Тесты добавляют fixture-карты в изолированную БД; повтор с новым fixture состоянием предпочтительнее запуска поверх пользовательских данных.

Перед browser-тестом дождитесь окончания изменения файлов/Vite HMR: перезагрузка во время сценария аннулирует результат. Не трактуйте проход dev server как проверку release JS: обязательная `GENESIS_MINDMAPS=true pnpm build:web` выполняется отдельно.

Собранную веб-версию можно проверить через тот же локальный PHP: после сборки и успешных core/undated запустите `pnpm exec vite preview --config scripts/mindmaps/vite.config.ts` (порт 4323), затем `node scripts/mindmaps/e2e-built-preview.mjs`. Он проверяет вход, загрузку зашифрованной карты, структуру, ленивый chunk полотна и обычное редактирование undated-задачи после перезапуска из реального `dist-web/public_html/`, без подмены API. После recurring можно выполнить `node scripts/mindmaps/capture-built.mjs` для снимков диапазона дат на 390/1440 px. Полный сквозной сценарий создания/редактирования отдельно выполняется на dev-стенде.

Остановка стенда — Ctrl+C в его терминалах. Отключение флага/остановка серверов не удаляет карты. Никаких production-команд, git push, deploy workflow, Android/Gradle и удаления SQLite в harness нет.
