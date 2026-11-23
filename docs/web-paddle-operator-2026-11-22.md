# Международная публичная редакция для Paddle, 22 ноября 2026

23 ноября: PR45 опубликован в mainc1205c045862fcfbaa01b48a1fbd7f04d6693b75,
Source checks45084250291 и Deploy45088162015 success. При live-проверке обнаружено,
что язык сохранённого аккаунта заменял ?lang=en документа, а международные Terms
включали прежние RUB-цены. Следующее исправление привязывает документ к URL,
добавляет согласованные международные USD-условия на14 языках и убирает повторные
блоки оператора, уже приведённые в общем merchant block. Российские условия
/ru/ сохранены. Смысловая вычитка новых14 текстов выполнена: подтверждение суммы,
реальные дни зачёта остатка, годовой переход, отсутствие подмены доплаты полной
стоимостью, возвраты и обязательные права потребителя сохранены.

На исправленном кандидате: locked install, lint0errors/4 прежних warnings,
typecheck, полный pnpm test1248/1248 и build:web PASS; проверены196 HTML,
галерея280 файлов,13 locale dictionaries и offline precache. Изолированный browser
public-region5/5 и shared startup4/4 PASS. Новый regression проходит после реального
синтетического входа: /terms?lang=en остаётся EN/USD после загрузки account
preferences; /terms?lang=ru остаётся международным RU/USD; /ru/terms сохраняет
российские цены. Evidence: output/playwright/public-documents-1123/.
Визуальная геометрия не менялась; прежняя матрица размеров/схем не выдаётся за
новый прогон. Настоящие GPS/покупки, активация Paddle и security3.3.6 сюда не входят.

По прямому уточнению владельца международные страницы показывают Iurii Logvinov
(GENESIS) как оператора международных продаж и продавца, поддержку
`demiurge.soft@gmail.com`. Авторство приложения не переименовано. Российская
редакция /ru/ сохранена с прежними достоверными ролями и реквизитами.

Изменены общий prerender/React legal presenter, 14 международных комплектов copy,
название блока оператора, weekly reflection/planning copy, описание видов календаря,
meta author GENESIS и international head с alternate ru на /?lang=ru. Privacy/terms/refund/
support/delete-account используют международную контактную и коммерческую редакцию.
Факты о данных, retention, backup, Google, аудио, optional AI и добровольных чаевых
сохранены. Общая политика описывает категории external AI/payment processors;
обязательные notices перед отправкой внутри приложения остаются без изменений.
Paddle назван Merchant of Record условно для покупок через Paddle. Это не активация
checkout и не подтверждение одобрения домена. Elite/lifetime сохранён.

Исходная база main ac8ccf604bb42f7b7b19411f8703b88cd7dce8d2. Изолированный web
checkout, без security3.3.6/DB migrations/Android. APK149, package, подпись и данные
не меняются. GENESIS_DEPLOY_ANDROID=false, E2EE/floors off.

Уточнение 23 ноября: обе редакции поддерживают все 14 языков независимо от региона.
Путь /?lang=ru показывает международного оператора и USD; /ru/ сохраняет российскую
редакцию. Российский GPS достаточен для автоматического перехода даже с иностранным
VPN/IP. Только IP не вызывает перехода. Ранее granted-разрешение используется без
нового prompt; отдельная кнопка разрешает запросить геолокацию. Координаты не
передаются GENESIS. Выбранный язык, документ, referral и anchor сохраняются;
OAuth callbacks и приватные разделы не перенаправляются.

Донаты доступны только при российском GPS или свежем российском IP без известного
иностранного GPS. Для остальных и неизвестных регионов — disabled-кнопка без href,
без checkout и без claim support popup. Навигационный offline cache разделён по
редакции, документу и языку; юридический документ не заменяет общий app shell.

Предыдущий кандидат до этих уточнений: typecheck, production build, 98 public HTML,
галерея/locale chunks/offline precache и browser layout PASS. Эти результаты не
подтверждают новый кандидат.

Текущий кандидат: locked install, typecheck, lint изменённых TS/React/QA-файлов,
15 связанных unit/render tests, i18n audit всех 14 языков и production build PASS.
Verifier проверил все 196 HTML, роли каждой редакции, USD/RUB, полные privacy
disclosures, canonical/alternates/sitemap; gallery/locale chunks/offline precache PASS.
Гидратированный браузер: root RU сохранил международные сведения и USD; /ru/ RU
показал прежние роли и RUB; /ru/?lang=en сохранил российские роли на английском.
Матрица 360/390/768/1440 × light/dark без horizontal overflow, 14 language controls,
кнопка геолокации высотой 44px. Evidence: output/paddle-operator/region-*.jpg и
region-browser-layout.json. Реальный GPS и платёжные транзакции вручную не проверялись;
GPS/VPN/отказ/unknown и donation state проверяются отдельными изолированными CI-сценариями.
Полный pnpm test, required CI и публикация — в процессе.
