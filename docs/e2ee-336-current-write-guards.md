# Актуальность операции на физической границе записи

21 ноября 2026. Web/native-приёмка этой границы пройдена, включая полный native
lint. Это не выпуск3.3.6; coverage остаётся9/20.

После добавления обязательной quota admission появилась дополнительная граница
ожидания: producer мог проверить актуальность операции до `vault.write`, затем
дождаться quota после retirement и всё же записать служебные rows, пока сам
vault оставался открыт. Сохранён browser RED на настоящем IndexedDB:
`E2EE_ACCOUNT_CHANGED`, но records1→4 и ciphertext inventory изменён.
Правильная ошибка после записи не заменяет проверку перед ней.

Теперь scoped guard передаётся через source-stage, content-plan, raw-original
и scoped coordinator save в реальный provider. Web проверяет его после sealing,
DB/quota awaits и в cursor/mutation callbacks strict transaction; native —
внутри существующей SQLite transaction через её `requireOpen` callback. Guard
включает lifetime конкретного producer, поэтому закрытый raw observer тоже
блокирует запись при открытом device vault. Trusted guard exception сохраняет
identity, включая AbortError; provider exceptions сохраняют прежнюю sanitation.
Default guard остальных writers по-прежнему проверяет lifetime vault. Это не
новая интеграция всех account sessions, provision/unlock/enrollment или recovery.

Guard не отменяет уже совершённую durable transaction задним числом. Здесь
проверяется retirement до её физической границы/CAS и отказ без публикации
поздних writes. Активация продукта и работа после reboot этим не доказываются.

Web evidence текущего изменения:

- Chromium1576/6: actual quota wait, operation retirement для raw/source/plan,
  observer.close и actual cursor callback с сохранением AbortError identity;
- source/preparation17/17: отдельные state3 и state4 retirement на actual quota
  boundary, сохранение полного orphan source и отсутствие transport;
- actual provider writes14/14, raw originals23/23, content plan13/13, включая
  cold read всех bytes двух generated9MiB originals и независимые host hashes;
- вместе73 browser checks. Console0 наблюдался на каждой принятой странице;
  у content-plan console снимался до последнего чтения успешного результата;
- full JS2044/2044,0 fail/skip; owned TSC02/scoped ESLint02 PASS. JS01 прерван
  для дополнительного state3 callsite; он не является финальной приёмкой.

RED: `runtime/provider-current-browser-red-02.json` (records1→4).
GREEN: `runtime/provider-current-browser-green-01.json` (все четыре quota
retirement cases records1→1), `provider-current-planning-green-02.json` и
`provider-current-{writes,raw,content}-green-*.json`.

Final frozen native input:
`D57549D86ABD73392D5C8856A009A9C61B7F63B67DEA840EC99E53BB3F332418`.
API26/API34 каждый27/27,0 failures/skips:8 provider,8 planning,8 remote-original,
1 key audit и по1 targeted source/plan guard. Все names whole-class methods и
оба targeted метода сверены с исходниками. Большой80MiB content-plan case не
повторяется ради этой границы. Прежние APK2979 не проверяют новый код.

Первый input3A8DB5 прошёл build/unit/full lint за24м11с. В первом device run
26/27: новый source-stage тест ошибочно передавал guard в ensureDurableKeys,
оставляя assertCurrent пустым. Исправлены именно параметры теста с явными именами.
Final build/unit/lint2м48с; production main APK воспроизведён побайтно, test APK
обновлён. Повторный device run02 — все27/27 на каждом API. Ошибочный run01
сохранён и не используется как PASS. Web source при исправлении native fixture
не менялся. Полный JVM1398 PASS,0 failures,8 прежних opt-in HTTP skips; status
BLOCKED из-за skips, все1406 нельзя отмечать PASS.

Main QA APK:
`C6D4F51E5711B97E761D0EAC65FD271CDE97F5271B4FF0D2E8E1AF2AE750E76C`.
Test APK:
`850D20A5E161FEAAC37742BC0EB4AA7460D6E07D3BD600192D5EC96FC0F7DBFA`.
Full native lint:0 errors/208 warnings/8 hints, без новых issue/file pairs или
увеличения counts относительно input1AD0. Отложенный полный анализ provider
writes теперь закрыт на текущем input; обязательная финальная приёмка релиза
сохраняется. Temporary PIN обоих owned AVD возвращены в NONE. API26 — наблюдаемый
Confirm Device Credential UI; API34 — actual system locksettings verify, не
продуктовая приёмка credential dialog, OEM/аппаратного backing или recovery.

`build:web` PASS:98 HTML/14 языков/280 gallery images, authored disclosures,
dictionaries/offline precache сохранены. Source/APK/prompt hashes после всех
проверок подтверждены в `runtime/provider-current-final-identity-02.json`.
Native reports: `output/qa/security336-provider-current-api{26,34}-02/results.json`.
Source checks принятого HEAD196 — run44859943692 SUCCESS; это CI предыдущего
commit, не замена проверке текущего working input.

Следующий capture/session черновик сохранён только в исключённом runtime:
шесть component tests проверяют complete-original binding при HTTP/JSON failure,
withheld result при binding failure, sticky caught failure, drain незавершённого
HTTP и revocation escaped ports. Это memory/callback fixture, не coordinator CAS,
не новый coverage. Coordinator/transport draft дополнительно прошёл21 model/CAS
checks, включая все10 actions и page/fragment формы, exact owned state-cell
readback и cold repair. Настоящая browser authenticated factory и native
композиция ещё не приняты. Основной код и frozen native input во время текущей
приёмки этими черновиками не менялись.
