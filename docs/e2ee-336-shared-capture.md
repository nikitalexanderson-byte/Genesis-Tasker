# Общие карты: обязательный capture на двух клиентах

21 ноября 2026. Web и native input01 прошли компонентную приёмку с явно
сохранённым API34 credential-refusal run. Это transport/capture boundary,
не готовые project/space adapters,
content-plan/run, original-key recovery или выпуск3.3.6. Coverage9/20 и gates
сохраняются. Серверный reader и исправление v4 fence уже приняты отдельно:
`e2ee-336-shared-mindmap-source.md`, commit5fe6be5b.

`SignedMigrationTransport` / `E2eeSignedMigrationTransport` имеют отдельный
`legacySharedMindmapsPage`: только project/space и точные maps, versions,
receipts, deletions, deletionScopes, conversions с bounded integer offset.
Public preflight проходит внутри sticky session. Personal context, неизвестная
таблица, отсутствующая page и чужой byte-offset отказывают до corresponding IO.
Низкоуровневые original codecs также требуют shared kind и явную page; одного
правильного публичного helper недостаточно для обхода этих проверок.

Новый role включён в существующие raw-original и wire1/2 ownership validators.
Новый crypto/writer protocol или envelope format не вводится. Actual directory,
device, source/lease, actor lifetime, provider admission, pre-network reservation,
raw EOF/hash, complete binding CAS и cold readback используют принятый session
контракт. Actual browser/AuthController factories передают тот же observation
в authenticated HTTP client. Без session чтение по-прежнему блокируется.

## Web evidence

- Focused JS60/60; full JS2062/2062,0 failures/skips.
  `runtime/shared-capture-js-{focused-01,full-01}.log`.
- Owned TSC02 и scoped ESLint02 PASS. QA harness изменён для трёх изолированных
  browser profiles; synthetic actor/metrics привязаны к конкретному scope kind.
- Chromium157/actual IndexedDB: personal15/15, project15/15, space15/15.
  По каждому scope первая raw response превышает2MiB; host проверяет исходные
  raw hashes/size независимо от browser. Полные original inventories:14/9/9,
  включая retained duplicate-JSON, HTTP409 и directory-header refusals.
- Для shared проверены все6 page roles, один whole-job fence, immutable receipt,
  actual cold device unlock с неизменными ciphertext rows, revoked transport,
  отсутствие HTTP без session и sticky caught preflight failures.
- В каждой console один ожидаемый HTTP409 resource error,0 warnings. Это не
  console0. Browser server/profile shutdown выполнены после terminal PASS.
  Точные JSON, host metrics, eval/console/close logs:
  `runtime/shared-capture-browser-{personal,project,space}-*-01`.

Node coordinator fixtures, настоящий authenticated browser client и loopback
signed-response server имеют разный scope. Они не доказывают real backend/OAuth
journey, независимую historical authenticity legacy server content или полноту
содержимого настоящих20 sources. PHP actual SQLite acceptance нового action
описана отдельно; локальные raw inputs всё ещё synthetic.

## Native frozen acceptance

Input01:
`7F87B61267BB54345C14BD966DBB9F801C5F5148E84D6585187525FE0AEAB922`.
Build01 SUCCESS10m55s. JVM1408 PASS,0 failure,8 existing opt-in HTTP skips,
1416 total/246 suites; итоговый unit status BLOCKED, не1416 PASS.

Main QA APK:
`C62F1F4D562F1AD61464EFF2FE3FCCF8F879492AE9DC0A052ECBDDEB9BB107AB`.
Test QA APK:
`12AB34D1D7E38788D5A3A5E095D6B5422F03E59217C835B52C8144945BF3D1F9`.

API26:34/34 PASS,0 failure/skip. API34:33 PASS в initial01 и один failed key-audit
case с `E2EE_UNLOCK_REQUIRED`. Измеренная временная отметка отказа находится
после300s окна системного authentication (примерно324s после setup). Полный
initial01 status остаётся INCOMPLETE, он не переименован в PASS. После свежего
owned system verification targeted keyaudit02 прошёл1/1 на ТОЧНО тех же APK.
Проверены34 distinct passing cases в двух runs; это НЕ единый clean34/34 run.
Таймауты product protection не менялись. Initial log/credential evidence и
составная приёмка сохранены отдельно:
`runtime/shared-capture-api34-{auth-expiry-01,composed-acceptance-02}.json`.

Новые cases используют actual provisioned Keystore, SQLite, AuthSessionClient
и synthetic HttpsURLConnection для всех6 roles обоих shared kinds. API34
использует system locksettings verify, не product credential dialog acceptance.
Временные PIN обоих AVD возвращены в NONE, source/APK identities сверены.
Оба свежих native artifacts также прошли WebCrypto подписи/byte-hash interop
ПРЕЖНИХ personal11 requests. Это существующий wire regression нового APK,
не новый shared wire vector и не clean-device recovery. Нового crypto format нет.
Evidence: `output/qa/security336-shared-capture-api{26,34}-01/`,
`security336-shared-capture-api34-keyaudit-02/` и
`runtime/shared-capture-native-host-api{26-01,34-02}.json`.

Fresh full native lint01 SUCCESS14m18s:0 errors/208 warnings/8 hints. Новых
issue/file pairs и увеличений count против session-integration03 нет. Это lint
нового7F87 input, не результат предыдущего9C754. Current web build01 PASS,
98 HTML/14 языков/280 gallery images/disclosures/offline precache сохранены.
После provider/lint/web build повторно сверены frozen source, оба APK и исходный
security prompt. Итог: `runtime/shared-capture-final-identity-01.json`.
Личные устройства, Play и production не затрагиваются. Полные system/upgrade/
recovery/14-language gates остаются обязательными; новый UI copy здесь отсутствует.
