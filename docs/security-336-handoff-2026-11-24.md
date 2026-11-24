# Продолжение24 ноября: выпуск3.3.6 и отдельный сайт

## Новейший срез: Boosty подтверждён, UI40 принят

Это дополнение заменяет старые статусы процессов и KYC ниже.

- Boosty в текущем UI подтвердил Basic (VERIFICATION COMPLETED, annual limit
  up to EUR500). Название GENESIS · Nikita Lyapin и полное честное About сохранены
  и повторно наблюдались. Официальный Copy link: https://boosty.to/genesiscalendar/donate.
  Screenshot: output/release-3.3.6/boosty-genesis-profile-20261124.jpg. Tab13 оставлен
  deliverable на странице профиля. KYC форму больше заполнять не нужно.
- Закрытая настройка Boosty включена на Hostinger24 ноября08:55:57UTC: enabled
  и profile_verified true, ровно этот публичный URL. Остальные значения config
  строго unchanged; права сохранены; приватная rollback-копия вне public_html.
  PHP CLI opcode cache потребовал invalidate/enable_cli=0; отказавшая проверка
  откатывала config. Финальный CONFIGURED сохранён в boosty-server-config-
  20261124.json. Публичный endpoint ещё ждёт Deploy; реальных платежей не было.
- PR49 HEAD3f91441d, PR CI45356215106 PASS обоих jobs. Push45356202996 ещё ждёт
  web-and-api. Обычный merge был отклонён branch policy из-за pending check;
  admin/auto обход не применялся. Main/live4cc67503/APK149 сохраняются.
- Prodamus tab11 на шаге3/5 в mobile editor links. Минимум2 подтверждённых
  ресурса; нельзя отмечать опубликованные ФИО/ИНН/тарифы до реального Deploy.
  Browser2/handles genesisBoosty, genesisSignup; tab17 — unauthenticated GitHub
  job, текущие logs требуют входа и через CLI доступны только после completion.
  Браузерный completion marker ещё не отправлен, CUA работа не завершена.
- Новый отдельный worktree output/release-3.3.6/prodamus-gateway-worktree,
  branch codex/prodamus-gateway-20261124, commit5216f0dc. Завершён bounded wire
  contract: canonical HMAC, strict form parser, merchant/short-link allowlist,
  exact amount/order/nonce/product binding, signed success receipt.63 checks
  PASS, включая независимый Python vector. Он не зарегистрирован в API; полного
  шлюза ещё нет. Документ docs/prodamus-contract-2026-11-24.md перечисляет остаток.
- Controller37 platform PASS_LOCAL_SCOPE1/1, migration/private normal reader/
  cold PIN сохранены. Wrapper INCOMPLETE из-за UI harness. UI37/38 реально2/4;
  native39 все4 prerequisite FAIL из-за By.text(...).clickable(true) на дочернем
  Text, а screenshot показывает enabled Compose button. Это не4PASS.
- API26 source37 оригинал INCOMPLETE:36PASS/1FAIL. Measure-Object over mixed
  dictionaries дал неверный верхний passed=2; оригинал сохранён, derived-totals
  отдельно36/1. Один capacity race после долгой подготовки повторён source39:
  output/qa/security336-native150-source39-api26-prepared-capacity/results.json,
  PASS_LOCAL_SCOPE1/1, genuine observed credential после подготовки, без
  periodic refresh. Original NONE восстановлен. Первые попытки38 были setup
  INCOMPLETE (owned AOSP verifier crash, конфликт двух UiAutomation clients),
  не продукты PASS; snapshot теперь пишет instrumentation, driver только читает.
- Native40 build SUCCESS117.8s, source hash
  A352EAC5FFB1265F1C53C513E034EFFEF7B82A60ACF3DE41E11D26CBE8F6AB76,
  unitExecuted=false. App APK идентичен37/38/39 SHA2567A7AF1CF…44D8F;
  изменены только instrumentation selectors/lifecycle prerequisites/diagnostics.
  Не выдавать эту сборку за повтор JVM: настоящие1452 JVM остаются build37.
- Completed UI40 session25308: runtime/focus-native40-launcher-driver.ps1,
  output/qa/security336-native150-ui40-launcher-driver-preserved37/results.json.
  Reuses controller37 runtime, same-owner identity delivered separately,
  external launcher exactly once; no callbacks/auth refresh/data reset. Test
  требует actual interactive button ancestor и STOPPED после Home. Результат:
  PASS_LOCAL_SCOPE4/4, backendUnchanged=true, qaDataPreserved=true; services
  stopped/reverse removed. Root native inputs разморожены. Runtime37 ещё owned
  preserved и требует cleanup до выпуска. Не повторять controller migration.

PR49 после green обеих проверок слит обычным merge: main
7964526b2e78ce5956cfaf95a1f9df129dc95b1a. Его собственные main Source checks и
Deploy пока впереди; live всё ещё4cc67503. В root нет remote origin; перед
fetch выбрать существующий remote по точному Genesis-Tasker URL, не создавать
новый checkout поверх указателя OneDrive.

После ready PR49: ordinary merge, дождаться exact main checks, штатный Deploy
с актуальным expected_current_commit, live footer/documents/redirect/donation
verification и unchanged manifest149. Затем accepted main включить вперёд в
security. Остались48-scenario/20-path evidence, final internal exact candidate
crypto review, signed149→150, раздельные release workflows и owner-checked cleanup.

## Предыдущий срез (история)

Корень: C:/Users/mrdeu/.codex/work/genesis-tasker-20261108/public-candidate, branch codex/security-336, HEAD c0ac5d82f006bbb1aefe5e576aede31cf053b769. Native inputs root заморожены до controller37/runtime; срочный сайт меняется только в собственном worktree. Документы root обновлены незакоммиченно.

## Сайт и платежи

Worktree: output/release-3.3.6/unified-payments-worktree, branch codex/unified-payments-20261124, commit875c8b5ea10d4405c6c43fa57947404a1332596f. PR49: https://github.com/nikitalexanderson-byte/Genesis-Tasker/pull/49 . Exact-source CI45354438107 и45354426366 выполняются. Локальные typecheck/lint/i18n14,26 focused tests, PHP billing/CloudTips PASS. build98HTML/280gallery PASS. Browser02 PASS5 public cases +8 startup; footer16 geometries EN/RU×schemes×4widths; вручную EN1440dark и RU360light. Bundle c59b49e4faf23132d1b80bb5b71d5e2c7af01f0a024f19abfa54b1515d19a636 неизменен. Synthetic cleanup completed. Ранее full1248 дал1245PASS: два устаревших public-copy ожидания исправлены; SSR prerequisite pnpm build выполнен; затронутые render checks PASS. Details docs/web-unified-payments-2026-11-24.md.

Paddle удалён из active web/server/native code и переводов. Одна витрина,14 языков, /ru/302 к общим документам. ФИО/ИНН/контакты/реальные RUB цены видны в подвале. Никита — исполнитель и PD-controller, Юрий — домен/хостинг. USD-display не привязан к ложному checkout. Новые security paths не входят в этот web/API Deploy; APK149 остаётся.

Донаты web/native source: выбор CloudTips/Boosty с региональным порядком и ручным выбором; explicit popup, accepted URL parser, статeless public GET /donations/methods. Старый335 CloudTips POST и signed receipts неизменны. Boosty private config disabled до KYC/verified owner destination; публичная ссылка не получает account data и не даёт paid access. Включение внешних неподвязанных донатов закрывает автоматическое account-retention deletion. В privacy есть условное раскрытие Boosty14 языков.

## Браузер: не завершено

Browser2, Prodamus tab11/variable genesisSignup: https://anketa.prodamus.ru/customer , шаг3/5. Самозанятый, ФИО и остальные личные поля пройдены владельцем. Настроены IT/ПО/Лицензии/онлайн, GENESIS, полное честное описание функций включая sacred calendars/self-reflection, адрес genesiscalendar, support email. Открыт popup подтверждения сайта: ФИО,ИНН,тарифы; пока не отмечен, т.к. production ещё старый. Требуется минимум2links; реальный Telegram t.me/genesiscalendar есть, но не публиковать туда сообщения без отдельного поручения и не подтверждать несуществующие реквизиты. Можно проверить реальные public website pages как отдельные ссылки. Не принимать новый договор Prodamus без action-time подтверждения; никакие финансовые операции не выполнялись.

Boosty tab13/variable genesisBoosty: профиль https://boosty.to/genesiscalendar создан на Nikita Lyapin; email nikitalexanderson@gmail.com, blog currencyRUB. Владелец отдельно подтвердил ToS/payment terms и затем сообщил «верифицировал аккаунт». Но reload и /app/settings/verification показывают отдельную пустую KYC форму с выбором страны и обязательным допуском к payments. Открыта и markHandoff; async попросили пройти именно KYC. Не включать foreign option на одном утверждении, пока observed UI противоречит ему. Попытка About editor fill/save не сохранила описание после reload; не заявлять его сохранённым. При необходимости использовать настоящий paste/typing в rich editor и проверить сохранение. Обычный google signup выполнен, повторное принятие тех же условий не запрашивать. API keys/паспорта/банк/OTP не собирать в чат.

Screenshots: output/release-3.3.6/boosty-registration-terms.jpg, boosty-kyc-pending.jpg; последний показан пользователю. Браузерный ::browser-complete ещё не отправлен, т.к. handoffs не закончились. После compaction сначала cua.rewriteDocumentation(). Не выводить все tab URLs: OAuth popup может содержать code; inventory emit:false и только origin/path/title при необходимости.

## Security: текущие доказательства и процессы

C0 exact Source checks45343556816 SUCCESS both jobs (45343546707 duplicate можно не повторять). Native build37 SUCCESS24m26s; JVM XML252suites/1452cases:1444PASS0failures8opt-in skips. Source hash38322BF326156883D86C237581E33DE5E51B7716FE16BFD1CE5F373DA84A6DCD. Root native inputs не менялись.

API34 source37 focused4suites/37cases PASS (2 bridge-pressure,8 storage,20 streamed,7mindmaps). Report output/qa/security336-native150-source37-api34/results.json. Это component run с настоящим initial auth и HAT refresh; не UI acceptance. Source36 старые результаты были78/24fail наAPI26 и96/6fail наAPI34; их не выдавать за полный PASS.

Active session53388: runtime/native150-private-controller-and-unlock-api34-37.ps1 -NoAuthenticationRefresh -KeepFixture, started10:40MSK. Log runtime/controller37-run.log. Reuses build37, actual controller + PIN/fingerprint/cancel/background4/4; launcher flags0x10200000 вставлены из focus-native36 driver. ADB instrumentation PID48932, parent34476. Controller runtime SQLite менялся11:13MSK, PIN-ready marker10:53 и resumed PagerTestActivity; отсутствие text logs во время buffered instrumentation не доказывает зависание. Не запускать миграцию повторно без конкретной ошибки. Контроллер умеет20min stage timeout; stdout/report появляется после completion. Pin watcher uses existing synthetic API34PIN; не менять его. Must retain/clean fixture correctly if PASS.

Active session30203: output/release-3.3.6/runtime/run-native37-api26-per-case.ps1. Owned emulator-5594 / GenesisSecurity336_API26_AOSP, original credentialNONE checked; synthetic336336 set, will restoreNONE in finally. Separate actual observed ConfirmDeviceCredential before each of35 cases + preflight pressure2, no periodic headless refresh. Exact37 cases expected. Report output/qa/security336-native150-source37-api26-per-case/results.json; log runtime/api26-percase37-run.log. Do not touch this emulator's credential mid-run. Primary package untouched.

Restore36-02 alreadyPASS: source controller30 hashE7B28B6E…; consumer36 FA2AB0AC…; age snapshot3ACTIVE scopes/25E2EEtables, wrong/tamper deny,3byte-exact files, actual cold PIN/normal read. Runtime/plaintext cleaned. No old migration repetition needed just for restore.

C0 web races: actual Chromium/IDB RED4bad scenarios + unchanged controlPASS; GREEN5/5. scripts/qa/e2ee-entry-input-browser-{check.ts,server.mjs}; runtime/entry-input-browser-{red37,green37}.json. Scoped regression63/63, lint/tscPASS. Secret snapshots precede awaited directory/storage, zero owned finally; native bridge permit released before ack but limit2 preserved; streamed fixture binding fixed, validators not weakened.

## Остаток

Дождаться обоих platform runs, исправлять только реальные отказы. Свести фактическую20paths/48scenarios matrix и final internal AI crypto review exact candidate. Signed149→150 baseline наemulator5580 уже8encryptedrows+1draft, не seed/clear/reinstall main. ru.genesis.calendar UID10194, QA UID10192. Cert1e161d36f574b0560d808c7ee95e1abe98165b3385336d0276fb381dfd901cb8. Release workflows existing/exact-main/live-commit guarded. После срочного website release включить accepted main вперёд в security root, не перезаписывать security code копированием файлов.

Перед release очистить owner-checked retained native30 runtime и web58/client-state; private JSON не читать. Pilot/cutover/floors0 и deployAndroid=false неизменны; full3.3.6 пока не выпущена. No subagents/Daybreak; demo-output не трогать. GooglePlay/real devices не затрагивать.
