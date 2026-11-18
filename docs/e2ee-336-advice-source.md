# Советы: подготовка реального источника3.3.6

19 ноября2026. Серверная часть read-only source, без product activation и без
утверждения о готовом клиентском content adapter.

`legacy-advice` — подписанный read на существующем `/e2ee/v1/read`. Использует
общий personal owner/resource/device/directory/lease/fence/source-token contract
под тем же SQLite writer. Обычные publication/selection helpers не вызываются:
они могут создавать новые советы, менять view/dismiss и тратить live quota.
Исторический read не меняет private rows и не генерирует account key.

Выбираются только поля текущего владельца:

- `users.advice_preferences_json`: точный старый JSON приватных настроек.
- `daily_advice_days`: точные entry/selection JSON и временные отметки.
- `daily_advice_entries` и `daily_advice_extra_entries`: все сохранённые slots,
  включая7–9, исходный entry JSON и view/dismiss history.
- `user_metrics`: приватные числа projects/tasks/habits и время снимка.

`draw_limit`, subscription, live next-card permission, sessions, tokens и keys
не выбираются. Entry JSON сохраняется дословно для клиентской проверки старого
формата; серверная whitelist полей не заменяет его будущий domain validator.
Личные предпочтения и исторические consent-поля нельзя импортировать как новую
серверную authority. Каталоги и публичные иллюстрации не переносятся в приватное
хранилище как новые assets; приватна связь пользователя с выбранным содержимым.
Суммарно до10000 rows и16MiB ответа; превышение — явная ошибка.

Изолированная PHP/SQLite проверка3/3 suites PASS:
`output/release-3.3.6/runtime/backend-advice-source-reader-02/`.
Новый source suite включает реальные подписанные positive/foreign/revoked/stale
lease/signature/cancel проверки, точные private fields, unchanged source hash,
повторное read без content mutation, empty source без создания key и17MiB
oversized preference rejection. Shared-store regression запрещает даже shared
owner читать personal Advice через групповые ACL. Cross-platform transport
регрессия прежних workspace/Aurora/Stoicheion reads также PASS; новых Advice
web/native transport vectors ещё нет.

Первый fixture запуск ошибочно задал extra slot1; actual schema допускает7–9.
Исправлен только seed на7; product schema/ограничения не ослаблялись.

Обязательны дальше: web/native signed transport ports, реальные owner-bound
cache/memory capture и domain reconciliation, new-root readback и recovery.
Native inventory включает `AdviceSnapshotStore`, рабочий дневной кеш/seen/history
и старый SharedPreferences-кеш с hashed keys. Хеш сам по себе не подтверждает
владельца неизвестной исторической записи. Unassigned копии нельзя молча считать
пустыми, присвоить текущему владельцу или удалить. Веб-состояние TodayAdvice
снимается до source IO вместе с текущими preference/selection/dismiss changes.

Эта серверная подготовка не повышает real adapter coverage: готовые source
categories по-прежнему workspace/Aurora/Stoicheion3/20,17 остальных обязательны.
Полный product lifecycle, all-path reconciliation, recovery/direct upgrades,
48 сценариев/14 языков и независимый crypto review ещё требуются. Production
и3.3.5/149, update floors0, Android deploy false и cutover off не менялись.
