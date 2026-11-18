# Публичные исторические редакции советов для3.3.6

19 ноября2026. Это зависимость будущего реального `personal.advice` adapter.
Она не включает product E2EE и не повышает подтверждённый coverage3/20.

Старые `entry_json` могут ссылаться на `contentVersion` или
`translationVersion`, не содержать полный переведённый текст. Обычный
`genesisAdviceForClient` разрешает такие ссылки из редакционных файлов.
Миграция не должна вызывать обычный draw/publication endpoint, выбирать новую
карточку вместо прежней или считать отсутствующую редакцию пустым советом.

В web build добавлены только публичные редакционные словари:

- восемь существующих daily editions, включая обе psychopompia и aretology;
- `philosophers-2026-11-v1` с2602 афоризмами;
- все14 языков каждой редакции:126 файлов, точные исходные UTF-8 bytes.

`scripts/advice-public-assets.mjs` выпускает эти bytes по URL
`advice-catalogues/v1/<kind>/<version>/<language>.<sha256>.json` и manifest.
Входы — только allowlisted публичные каталоги. Private rows, users и selections
не читаются. Неизвестные свойства редакционного payload блокируют экспорт.
Файлы скачиваются по необходимости, не добавлены в offline shell precache или
native APK; существующие иллюстрации и тексты не изменены.

`contracts/public-advice-editions-v1.json` фиксирует текущий corpus с19 ноября.
Нельзя править текст существующего version directory: проверка build требует
новую редакцию, сохранение прежнего directory/pin и явное добавление новых pins.
Удаление прежней редакции/языка также блокирует build. Это сохранение с текущего
среза, не доказательство неизменности каталогов до этой фиксации. Ранее реально
отображённые тексты native snapshots всё равно должны войти в полный источник.

`PublicAdviceCatalogues` читает полный public edition, проверяет SHA-256/размер/
строгий формат, возвращает независимую копию текста. Selected advice ID,
preferences и owner ID не входят в URL. Actual HTTP reader использует
`credentials:omit`, `referrerPolicy:no-referrer`, запрет redirect и bounded
streaming. Missing edition/translation, неверные bytes/manifest, смена account
и закрытый owner guard не приводят к fallback на свежую редакцию. Cache ограничен
32MiB исходных bytes, одновременно не более четырёх различных загрузок.

SHA-256 проверяет целостность bytes и release pins. Это не независимая подпись
редактора и не защита от подмены всего web origin; новое обещание такого рода
не вводится. Native entry/source bridge и перенос private selections ещё нужно
подключить. Обычный Today/оплата/public locale routing не изменены.

## Фактически выполнено

-7/7 focused Node checks: все126 actual files, pins, strict public export,
 exact translations, corruption/missing version, concurrent callers, owner
 changes, credential-free HTTP и declared/streamed limits.
- Chromium157, actual built assets через loopback HTTP:132/132 checks PASS,
 126 editions/14 languages, WebCrypto digest, tamper rejection, owner closure,
 независимые copies и отсутствие Cookie/Referer на всех catalogue requests.
 Synthetic fixture cookie действительно был установлен на HTML; reader его
 не отправил. Console0 errors/0 warnings.
- Web build PASS; browser server перед запуском сравнил каждый emitted byte
 с исходным файлом. Полный JS1474/1474 PASS. Web Advice signed transport
 дополнительно38/38 migration tests PASS; native Advice transport ещё нужен.
- Typecheck PASS. Полный ESLint сначала дал3 errors только в чужом untracked
 `demo-output/production/render_logo.cjs`. Файлы не менялись и не добавлялись.
 С исключением только `demo-output/**` —0 errors,4 прежних img warnings.

Артефакты относительно `output/release-3.3.6/runtime/`:
`frontend-advice-public-full-01.log`, `frontend-advice-public-build-01.log`,
`frontend-advice-public-typecheck-01.log`,
`frontend-advice-public-lint-owned-02.log`, `frontend-advice-transport-01.log`.
Browser report: `output/playwright/3.3.6/advice-catalogue-chromium-01.json`.

Нет нового визуального UI или переводов для вычитки; corpus сохранён побайтно.
Native Chromium113/API26, private Advice reconciliation/new-root readback,
unattributed SharedPreferences, product lifecycle, recovery/direct upgrades и
независимый crypto review этим инкрементом не подтверждены. Production3.3.5/149,
floors0, Android deploy false и cutover off сохранены.
