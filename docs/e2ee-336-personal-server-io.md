# Personal server operation gate

19 ноября 2026. Личные legacy HTTP-запросы удерживают общий owner permit до
окончания ответа, включая provider callbacks и commit. Signed migration
commands/legacy reads берут исключающий permit перед SQLite writer; source hash
использует тот же permit. Все flock неблокирующие: занятый owner/file возвращает
409, сохраняет outbox и не ждёт callback под SQLite writer.

Borrowing допускается только в одинаковом режиме. Legacy callback не может
вложенно начать migration; migration не вызывает ordinary provider helpers.
Permit не сериализуется/клонируется, debug redacted, finally/destructor закрывают
ссылку. Clone rejection не снимает исходный lock. Разные owner независимы.

Google cache проверяет SQL owner, primary existence и linked ownership; после
owner/file locks повторяет проверку. Действующая lease/active/retirement отказывают
до loaders, decrypt и записи. Cleanup не читает ciphertext; после unlink допускает
только захваченные сервером owner metadata, несовпадение с живым SQL owner
запрещено. Новая процедура account/provider deletion после cutover ещё нужна.

Пропущенный GET `sync/tasks` добавлен в canonical transport contract. PHP,
web/service worker/native используют общий набор vectors; active scope запрещает
этот путь независимо от заявленной версии.

Проверки в `output/release-3.3.6/runtime/`:

- `personal-io-gate-regression-01/`: 11/11 PHP suites.
- `personal-io-gate-process-02/`: реальные дочерние процессы/flock, borrowing,
  crash/finally, signed read/command refusal перед SQLite writer.
- `personal-io-policy-syntax-04/`: 2/2 PHP suites.
- `personal-io-policy-web-01.log`: 9/9 JS policy/worker tests.
- `personal-io-policy-native-jvm-04.log`: Gradle PASS; policy JVM 1/1, skipped0,
  failures0/errors0; actual web/native vectors.
- `personal-io-policy-web-build-04.log`: web build/static checks PASS.
- `personal-io-cache-05/`: 4/4 suites; два несуществующих имени фильтра runner
  проигнорировал, это не шесть проверок.
- `personal-io-cache-boundary-06/`: 5 PASS, 1 FAIL из-за display_name в новой
  synthetic fixture. После исправления `personal-io-cache-boundary-07/` PASS.
- `personal-io-full-backend-08/`: 146 PASS, 1 FAIL — habit-reminders fixture
  выявила короткую EC-координату OpenSSL. Исправление/повтор обязательны; весь
  прогон не объявляется зелёным.
- `personal-io-api-final-04/`: 402/402 реальных loopback HTTP lifecycle cases PASS.

Изолированные DB/config/session/tmp; внешняя отправка отключена. Это private
legacy coordination, не shared migration gate или полный account lifecycle.
Provider files ещё должны войти в source token/lossless read/client reconciliation.
Floors0, cutover off, Android3.3.5/149 и GENESIS_DEPLOY_ANDROID=false сохранены.
Независимый crypto review не выполнен и остаётся обязательным до activation.
