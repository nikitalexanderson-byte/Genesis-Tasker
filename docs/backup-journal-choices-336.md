# Выбор сохранённых черновиков при восстановлении

18 ноября2026. Подготовка3.3.6; production не менялся.

Архив формата `journalVersion:1` сохраняет все ветки Авроры/Практик, включая
предыдущие snapshots одного writer. Теперь общий интерфейс web/Android показывает
разные варианты, их пользовательскую заметку и раскрываемые полные данные.
Ничего не выбирается автоматически при конфликте. До выбора нельзя подготовить
восстановление. Можно выбрать и старую сохранённую копию. Смена варианта снимает
ранее подготовленные операции и подтверждение; требуется новый preview.

Решение хранится только в памяти текущего интерфейса отдельно от архива.
`resolveBackupJournalDocument` снова вычисляет SHA-256 всего набора исходных
pending/base/cache и выбранного документа. Решение другого источника, владельца,
раздела или изменившейся копии не подходит. Порядок массива копий не влияет на
идентичность. Подсказка `data.document` и поля решения, записанные в сам файл,
не разрешают отбросить другую ветку. Асинхронное хеширование работает с отдельным
снимком, поэтому поздняя подмена входного объекта не меняет выбранные bytes.
Legacy originals и сам encrypted archive не изменяются. Identity, billing,
ACL и внешние очереди по-прежнему не восстанавливаются из контента.

Shared UI принимает только явные локальные choices; native entry передаёт их
в тот же restore adapter. Gradle inputs включают новый TSX-компонент, поэтому
изменение выбора не оставляет устаревший WebView bundle в кешированной сборке.
Приватные документы/решения не записываются в browser storage; существующая
история операций содержит только timestamps. Полные данные открываются локально,
без plaintext export или обращения к внешнему переводчику.

Проверено:

- 15/15 focused JS: оба journal sections, разные heads, предыдущие copies,
  подделанный default/decision, scope/source/base tamper, изменение во время
  хеширования, malformed journal, реальные encrypted restore operations и
  сохранность оригинальных storage bytes.
- Финальная общая регрессия1449/1449 без skips:
  `runtime/frontend-backup-choice-full-final.log`.
- В настоящем Chromium28/28 flows:14 языков ×2 схемы. Для каждой проверены
  360/390/768/1440:112 viewport checks. Дополнительно font1.3 в EN/RU/DE,
  открытие полных данных с клавиатуры, выбор старого snapshot, отсутствие
  преждевременного restore и отмена старого подтверждения. Console errors0.
  `runtime/backup-journal-browser-final.log`;118 screenshots в
  `output/playwright/backup-journal-screens/`.
- Android API34, отдельный `GenesisSecurity336_API34`, только QA package:
 2/2 instrumented прохода EN light/dark, font1.3. Фактические зашифрованные Room
  snapshots экспортированы через системный SAF, тот же encrypted file выбран
  обратно системным picker и открыт production WebView. Старый и последний
  варианты дали соответствующий encrypted preview, проверенный JCA; смена
  варианта сняла старое подтверждение. Три исходные encrypted rows до/после
  полностью совпали. Реальный restore commit этим fixture намеренно не делается.
  `native-backup-choice-api34-light-final.log`,
  `native-backup-choice-api34-dark-final.log`; снимки
  `output/playwright/backup-journal-native/backup336-journal-*.png`.
- Typecheck, changed-file lint, i18n catalogs/audits, web build и QA APK/test APK
  build PASS. Шесть новых фраз вычитаны на14 языках, включая смысл сохранения
  остальных вариантов и placeholder номера. Механический detector: `[]`.
  Логи `backup-choice-typecheck-final.log`, `backup-choice-lint-03.log`,
  `backup-choice-i18n-final.log`, `web-backup-choice-final.log`,
  `native-backup-choice-build-01.log`, `native-backup-choice-test-build-final.log`.

Первый browser fixture не выдавал некоторые языковые font subsets: allowlist
исправлен, финальный проход сделал0 console errors. Первые native screenshots
поймали кадр до завершения плавной прокрутки; финальный driver использует instant
scroll, геометрическую проверку и WebView visual-state callback. Продуктовые
assertions не ослаблялись. До/после: `output/playwright/backup-journal-before-390-light.png`
и финальные снимки. QA остаётся3.3.5/149 по metadata, это не релизный APK3.3.6.

Не подтверждены этим этапом: новое E2EE archive поколение, Drive, recovery на
чистом клиенте, отдельные конфликты одинаковых records карт/дневника, полный
native source coverage, реальные direct upgrades и48 сценариев. Непризнанные
форматы/конфликты этих категорий продолжают блокировать автоматическое применение.
