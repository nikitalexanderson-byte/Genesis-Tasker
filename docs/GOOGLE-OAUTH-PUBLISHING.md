# Google OAuth в тестовом экземпляре

Для разработки создайте отдельный Google Cloud project и OAuth credentials. Используйте собственный разрешённый тестовый origin и тестовых пользователей. Значения ниже — заполнители, их нельзя копировать как действующие настройки.

| Параметр | Пример |
| --- | --- |
| Authorized origin | `https://genesis-test.example.invalid` |
| Web redirect URI | `https://genesis-test.example.invalid/api/auth/google/callback` |
| Приложение | Genesis Tasker (тестовый экземпляр) |
| Секрет | Только игнорируемый `server/config.php` тестового экземпляра |

Redirect URI должен точно совпадать с адресом backend. Для нативного входа отдельно настройте Android credentials для нужного applicationId и отпечатка тестового сертификата. Debug package отличается от production; production signing keys не нужны для debug-тестов.

Обычный вход запрашивает `openid`, `email`, `profile`. Подключение Calendar и Tasks — отдельное согласие. Calendar использует созданный приложением календарь и соответствующий scope; Tasks требует отдельного доступа. Проверьте фактические scopes в `server/src/google.php` и клиентском запросе перед изменением Google Console.

Для живой проверки создайте синтетическое событие в выделенном тестовом календаре, измените его в обоих клиентах, проверьте обновление и удаление, отзыв доступа и восстановление сессии. Не используйте личные пользовательские календари и production credentials. Локальная подмена ответа Google подтверждает только локальный контракт.

Публикация OAuth consent screen, изменение production-доменов и прохождение проверки Google — отдельные операции владельца сервиса; этот репозиторий их автоматически не выполняет. Пользователь должен видеть актуальные документы конфиденциальности, условия, поддержку и действие удаления аккаунта своего экземпляра. Рекомендации Google: [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) и [API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
