package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import ru.genesis.calendar.ui.AlertDialog
import androidx.compose.material3.MaterialTheme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.ui.Text

internal data class Notes(val title: String, val close: String, val changes: List<String>)

/** The app and Open testing use the same reviewed release copy. */
internal fun currentReleaseNotes(context: Context, language: String): List<String> {
    val catalog = context.assets.open("originals/i18n/android-3.3.7-notes.json")
        .bufferedReader(Charsets.UTF_8).use { org.json.JSONObject(it.readText()) }
    val items = catalog.optJSONArray(language) ?: catalog.getJSONArray("ru")
    return (0 until items.length()).map { items.getString(it) }
}

/** Reviewed release copy for every supported app language; also used for the Play Alpha notes. */
internal val release331Notes = mapOf(
    "ru" to listOf(
        "Улучшена читаемость иллюстрированных блоков «Сегодня» и календаря в светлых темах.",
        "«Путь Героя» соответствует выбранной палитре. Компактнее погода, пустая история снов и окно проекта.",
        "При выключенных сакральных функциях календарь проще: квадратные дни и компактные месяцы без описаний.",
        "Блоки «Сегодня» можно скрывать глазом. Категории жизни вынесены в отдельную кнопку, майндмепы — в шапку.",
        "Обновление сразу до самой новой версии, без промежуточных установок."),
    "en" to listOf(
        "Improved readability of illustrated Today and calendar panels in light themes.",
        "Hero Path follows your colour palette. Weather, empty dream history and the project dialog are more compact.",
        "With sacred features off, the calendar has square day cells and compact months without descriptions.",
        "Hide Today panels with the eye button. Life categories have their own button; mind maps are in the header.",
        "Updates go straight to the latest version, skipping intermediate releases."),
    "he" to listOf(
        "שיפור בקלות הקריאה של לוחות היום והלוח השנה המוצגים בנושאים קלים.",
        "מסלול גיבור עוקב אחר פלטת הצבעים שלך מזג האוויר, היסטוריה של חלומות ריקים והדיאלוג של הפרויקט הם קומפקטיים יותר.",
        "עם מאפיינים קדושים כבויים, ללוח השנה יש תאים של יום ריבועי וחודשים קומפקטיים ללא תיאור.",
        "הסתיר את לוחות היום עם הכפתור עין. לקטגוריות חיים יש כפתורים משלהם; מפות מוח נמצאות בכותרת.",
        "עדכונים הולכים ישר לגרסה האחרונה, דוחפים את השחרורים הביניים."),
    "ar" to listOf(
        "تحسين قابلية قراءة ألواح اليوم والتقويم المصورة في مواضيع خفيفة.",
        "يتبع مسار البطل ألوانك. الطقس، تاريخ الأحلام الفارغة وحوار المشروع أكثر دقة.",
        "مع السمات المقدسة، التقويم لديه خلايا اليوم المربع والأشهر المدمجة دون وصف.",
        "إخفاء لوحات اليوم مع زر العين. فئات الحياة لديها زر خاص بها؛ الخرائط العقلية في العنوان.",
        "وتجري عمليات التحديث مباشرة إلى أحدث نسخة، مع تجاوز الإصدارات الوسيطة."),
    "ko" to listOf(
        "가벼운 테마에서 일러스트 오늘과 달력 패널의 가독성이 향상되었습니다.",
        "영웅 경로는 색상 팔레트를 따릅니다. 날씨, 비어있는 꿈 기록 및 프로젝트 대화 상자가 더 컴팩트합니다.",
        "신성한 기능이 꺼져 있으면, 달력은 사각형 일 셀과 설명 없는 컴팩트 한 달을 가지고 있습니다.",
        "눈 단추로 오늘 패널을 숨깁니다. 생활 분류는 자체 버튼이 있으며 마인드 맵은 헤더에 있습니다.",
        "업데이트는 중간 릴리스를 건너뛰고 최신 버전으로 바로 이동합니다."),
    "nl" to listOf(
        "Verbeterde leesbaarheid van geïllustreerde panelen Vandaag en Agenda in lichte thema's.",
        "Hero Path volgt je kleurenpalet, het weer, de lege droomgeschiedenis en het projectdialoogvenster zijn compacter.",
        "Als de heilige functies zijn uitgeschakeld, heeft de kalender vierkante dagcellen en compacte maanden zonder beschrijvingen.",
        "Vandaag panelen verbergen met de oog knop.Levenscategorieën hebben hun eigen knop; mindmaps zijn in de header.",
        "Updates gaan rechtstreeks naar de nieuwste versie, tussentijdse releases worden overgeslagen."),
    "el" to listOf(
        "Πιο ευανάγνωστα εικονογραφημένα πλαίσια στο Σήμερα και στο ημερολόγιο στα φωτεινά θέματα.",
        "Η Πορεία του Ήρωα ακολουθεί την παλέτα σας. Πιο συμπαγής καιρός, κενό ιστορικό ονείρων και παράθυρο έργου.",
        "Με τις ιερές λειτουργίες ανενεργές, το ημερολόγιο έχει τετράγωνα κελιά ημερών και μικρότερους μήνες χωρίς περιγραφές.",
        "Κρύψτε πλαίσια του Σήμερα με το μάτι. Ξεχωριστό κουμπί κατηγοριών ζωής, νοητικοί χάρτες στην κεφαλίδα.",
        "Άμεση ενημέρωση στην πιο πρόσφατη έκδοση, χωρίς ενδιάμεσες εγκαταστάσεις."),
    "de" to listOf(
        "Bessere Lesbarkeit der bebilderten Heute- und Kalenderbereiche in hellen Designs.",
        "Der Heldenpfad folgt Ihrer Farbpalette. Wetter, leerer Traumverlauf und Projektdialog sind kompakter.",
        "Ohne sakrale Funktionen zeigt der Kalender quadratische Tagesfelder und kompakte Monate ohne Beschreibungen.",
        "Heute-Bereiche per Auge ausblenden. Lebenskategorien haben eine eigene Schaltfläche; Mindmaps stehen oben.",
        "Updates führen direkt zur neuesten Version, ohne Zwischenversionen."),
    "fr" to listOf(
        "Meilleure lisibilité des panneaux illustrés du jour et du calendrier dans les thèmes clairs.",
        "Le Parcours du Héros suit votre palette. La météo, l’historique des rêves vide et la fenêtre de projet sont plus compacts.",
        "Lorsque les fonctions sacrées sont désactivées : cases des jours carrées et mois compacts sans descriptions.",
        "Masquez les blocs du jour avec l’œil. Bouton des catégories de vie ; cartes mentales en haut.",
        "Mise à jour directe vers la dernière version, sans versions intermédiaires."),
    "es" to listOf(
        "Mejor legibilidad de los paneles ilustrados de Hoy y del calendario en los temas claros.",
        "El Camino del Héroe sigue tu paleta. El tiempo, el historial de sueños vacío y el diálogo del proyecto son más compactos.",
        "Sin funciones sagradas, el calendario muestra días cuadrados y meses compactos sin descripciones.",
        "Oculta bloques de Hoy con el ojo. Categorías de vida con botón propio; mapas mentales en la cabecera.",
        "Actualiza directamente a la última versión, sin instalar versiones intermedias."),
    "it" to listOf(
        "Migliorata la leggibilità dei riquadri illustrati di Oggi e del calendario nei temi chiari.",
        "Il Cammino dell’Eroe segue la tua palette. Meteo, cronologia dei sogni vuota e finestra del progetto più compatti.",
        "Con le funzioni sacre disattivate, il calendario mostra giorni quadrati e mesi compatti senza descrizioni.",
        "Nascondi i riquadri di Oggi con l’occhio. Pulsante per le categorie di vita; mappe mentali in alto.",
        "Aggiornamento diretto all’ultima versione, senza installazioni intermedie."),
    "pt" to listOf(
        "Melhor legibilidade dos painéis ilustrados de Hoje e do calendário nos temas claros.",
        "O Caminho do Herói segue a sua paleta. Meteorologia, histórico de sonhos vazio e janela do projeto mais compactos.",
        "Com as funções sagradas desativadas, o calendário mostra dias quadrados e meses compactos sem descrições.",
        "Oculte blocos de Hoje com o olho. Botão próprio para categorias de vida; mapas mentais no cabeçalho.",
        "Atualização direta para a versão mais recente, sem versões intermédias."),
    "pl" to listOf(
        "Czytelniejsze ilustrowane panele Dzisiaj i kalendarza w jasnych motywach.",
        "Ścieżka Bohatera używa wybranej palety. Pogoda, pusta historia snów i okno projektu zajmują mniej miejsca.",
        "Po wyłączeniu funkcji sakralnych kalendarz ma kwadratowe pola dni i mniejsze miesiące bez opisów.",
        "Ukrywaj bloki Dzisiaj przyciskiem oka. Kategorie życia mają własny przycisk; mapy myśli są w nagłówku.",
        "Aktualizacja od razu do najnowszej wersji, bez instalacji wersji pośrednich."),
    "sr" to listOf(
        "Побољшана читљивост илустрованих блокова Данас и календара у светлим темама.",
        "Пут Хероја прати изабрану палету. Временска прогноза, празна историја снова и прозор пројекта су компактнији.",
        "Без сакралних функција календар има квадратна поља дана и мање месеце без описа.",
        "Сакријте блокове Данас дугметом ока. Категорије живота имају своје дугме; мапе ума су у заглављу.",
        "Ажурирање директно на најновију верзију, без инсталирања међуверзија."),
    "uk" to listOf(
        "Поліпшено читабельність ілюстрованих блоків Сьогодні та календаря у світлих темах.",
        "Шлях Героя відповідає вибраній палітрі. Компактніші погода, порожня історія снів і вікно проєкту.",
        "Без сакральних функцій календар має квадратні комірки днів і компактні місяці без описів.",
        "Блоки Сьогодні можна приховувати оком. Категорії життя мають окрему кнопку, мапи думок — у шапці.",
        "Оновлення одразу до найновішої версії, без проміжних установлень."),
    "zh" to listOf(
        "提高浅色主题中“今天”和日历插图面板的文字可读性。",
        "英雄之路采用所选配色。天气、空的梦境历史和项目窗口更加紧凑。",
        "关闭神圣功能后，日历使用正方形日期单元格和不含描述的紧凑月份卡片。",
        "可用眼睛按钮隐藏“今天”面板。生活类别使用独立按钮，思维导图移至顶栏。",
        "直接更新至最新版本，无需逐一安装中间版本。"),
    "tr" to listOf(
        "Açık temalarda Bugün ve takvimdeki görselli panellerin okunabilirliği iyileştirildi.",
        "Kahramanın Yolu seçili renk paletini kullanır. Hava durumu, boş rüya geçmişi ve proje penceresi daha kompakt.",
        "Kutsal özellikler kapalıyken takvim, kare gün hücreleri ve açıklamasız küçük ay kartları gösterir.",
        "Bugün panellerini göz düğmesiyle gizleyin. Yaşam kategorileri ayrı düğmede, zihin haritaları üst çubukta.",
        "Ara sürümleri yüklemeden doğrudan en son sürüme güncelleyin."),
    "ja" to listOf(
        "ライトテーマで「今日」とカレンダーの画像付きパネルの文字を読みやすくしました。",
        "英雄の道に選択した配色を適用。天気、空の夢の履歴、プロジェクト画面をコンパクトにしました。",
        "神聖機能がオフの場合、日付のマスを正方形にし、月の説明を省いて表示を小さくしました。",
        "目のボタンで「今日」のブロックを非表示にできます。生活カテゴリは専用ボタンに、マインドマップは上部に移動しました。",
        "中間バージョンをインストールせず、最新バージョンへ直接更新できます。")
)

internal val release330Notes = mapOf(
    "ru" to listOf(
        "Шире блоки «Сегодня», удобнее навигация и даты календаря. Улучшены светлые палитры, лунный блок и погодные эффекты.",
        "Таймер новой привычки включается только по вашему выбору. Настройки автоудаления открыты, часовой пояс можно найти по городу или UTC.",
        "Ярче надписи карт Оракула, розовые перевёрнутые позиции. Советы сохраняются на день. Тёмно-синий Путь Героя и новый Telegram-канал."),
    "en" to listOf(
        "Wider Today panels, clearer calendar dates and navigation. Refined light palettes, Moon panel and weather effects.",
        "New habits use a timer only when you enable it. Auto-delete settings stay visible. Search time zones by city or UTC offset.",
        "Brighter Oracle card lettering and pink reversed positions. Advice is cached for the day. Dark blue Hero’s Path and a new Telegram channel."),
    "he" to listOf(
        "לוחות היום רחבים יותר, תאריך בלוח השנה ברור יותר וניווט. פלטות אור מתוחכמות, לוח ירח ואפקטים מזג אוויר.",
        "הרגלים חדשים משתמשים בשעון רק כשאתה מפעיל אותו. הגדרות המיחזור האוטומטי נשארות נראות. חיפוש אזורי זמן לפי עיר או סטייה מ- UTC.",
        "קלפי אורקל בהירים יותר ומיקומים הופכים ורודים. עצה נשמרת ליום. דרך הגיבור בכחול כהה וערוץ חדש Telegram."),
    "ar" to listOf(
        "ألواح اليوم الأوسع، تواريخ التقويم الأكثر وضوحا والملاحة. تنقيح ألوان الضوء، لوحة القمر والتأثيرات الجوية.",
        "تستخدم العادات الجديدة توقيتاً فقط عندما تقوم بتفعيله. تظل إعدادات الحذف الآلي مرئية. البحث عن مناطق التوقيت بالمدينة أو تغير UTC.",
        "كتابة بطاقات أوراكل أكثر إشراقاً ومواقع وردية معكوسة. المشورة مخزنة لليوم. مسار البطل الأزرق الداكن وقناة جديدة Telegram."),
    "ko" to listOf(
        "더 넓은 오늘 패널, 더 명확한 달력 날짜 및 내비게이션. 세련된 조명 팔레트, 달 패널 및 날씨 효과.",
        "새로운 습관은 타이머를 활성화할 때만 사용합니다. 자동 삭제 설정은 표시됩니다. 도시 또는 UTC 오프셋으로 시간대를 검색하십시오.",
        "더 밝은 오라클 카드 글자와 분홍색 반전 위치. 조언이 하루 동안 캐시됩니다. 다크 블루 영웅의 경로와 새로운 Telegram 채널."),
    "nl" to listOf(
        "Bredere panelen vandaag, duidelijkere kalenderdata en navigatie.Verfijnde lichtpaletten, maanpaneel en weerseffecten.",
        "Nieuwe gewoonten gebruiken alleen een timer als u deze inschakelt. Instellingen voor automatisch verwijderen blijven zichtbaar Zoek tijdzones op stad of UTC-verschuiving.",
        "Helderdere Oracle-kaartletters en roze omgekeerde posities. Advies wordt gecached voor de dag, donkerblauw Hero's Path en een nieuw Telegram-kanaal."),
    "el" to listOf(
        "Πλατύτερα πλαίσια «Σήμερα», σαφέστερες ημερομηνίες και πλοήγηση. Βελτιωμένες φωτεινές παλέτες, Σελήνη και εφέ καιρού.",
        "Το χρονόμετρο νέας συνήθειας ενεργοποιείται μόνο αν το επιλέξετε. Οι ρυθμίσεις αυτόματης διαγραφής παραμένουν ορατές. Αναζήτηση ζώνης ώρας ανά πόλη ή UTC.",
        "Φωτεινότερα γράμματα στις κάρτες και ροζ ανεστραμμένες θέσεις. Οι συμβουλές αποθηκεύονται για την ημέρα. Σκούρο μπλε μονοπάτι του ήρωα και νέο κανάλι Telegram."),
    "de" to listOf(
        "Breitere Heute-Bereiche, klarere Kalenderdaten und Navigation. Verbesserte helle Paletten, Mondansicht und Wettereffekte.",
        "Der Timer neuer Gewohnheiten ist nur nach Ihrer Auswahl aktiv. Einstellungen zum automatischen Löschen bleiben sichtbar. Zeitzonensuche nach Stadt oder UTC-Versatz.",
        "Hellere Kartenbeschriftung und rosa umgekehrte Positionen. Tagestipps werden lokal gespeichert. Dunkelblauer Heldenpfad und neuer Telegram-Kanal."),
    "fr" to listOf(
        "Blocs Aujourd’hui plus larges, dates et navigation plus claires. Palettes claires, Lune et effets météo améliorés.",
        "Le minuteur des nouvelles habitudes nécessite votre activation. Réglages de suppression automatique visibles. Recherche de fuseau par ville ou décalage UTC.",
        "Textes des cartes plus lumineux et positions inversées roses. Conseils conservés pour la journée. Voie du héros bleu foncé et nouveau canal Telegram."),
    "es" to listOf(
        "Paneles de Hoy más amplios, fechas y navegación más claras. Mejoras en paletas claras, Luna y efectos del tiempo.",
        "El temporizador de hábitos nuevos solo se activa si lo eliges. Ajustes de borrado automático visibles. Busca zonas horarias por ciudad o diferencia UTC.",
        "Letras de cartas más luminosas y posiciones invertidas rosas. Consejos guardados durante el día. Camino del héroe azul oscuro y nuevo canal de Telegram."),
    "it" to listOf(
        "Riquadri Oggi più ampi, date e navigazione più chiare. Migliorati temi chiari, Luna ed effetti meteo.",
        "Il timer delle nuove abitudini si attiva solo se lo scegli. Impostazioni di eliminazione automatica sempre visibili. Ricerca fusi per città o differenza UTC.",
        "Scritte delle carte più luminose e posizioni capovolte rosa. Consigli salvati per la giornata. Percorso dell’eroe blu scuro e nuovo canale Telegram."),
    "pt" to listOf(
        "Painéis Hoje mais largos, datas e navegação mais claras. Melhorias nas paletas claras, Lua e efeitos meteorológicos.",
        "O temporizador de novos hábitos só é ativado se o escolher. Definições de eliminação automática visíveis. Pesquisa de fusos por cidade ou diferença UTC.",
        "Letras das cartas mais claras e posições invertidas cor-de-rosa. Conselhos guardados durante o dia. Caminho do herói azul-escuro e novo canal Telegram."),
    "pl" to listOf(
        "Szersze panele Dzisiaj, czytelniejsze daty i nawigacja. Ulepszone jasne palety, Księżyc i efekty pogody.",
        "Timer nowych nawyków działa tylko po włączeniu. Ustawienia automatycznego usuwania są widoczne. Szukaj stref według miasta lub przesunięcia UTC.",
        "Jaśniejsze napisy na kartach i różowe odwrócone pozycje. Porady są zapisywane na dany dzień. Granatowa Droga bohatera i nowy kanał Telegram."),
    "sr" to listOf(
        "Шири блокови „Данас“, јаснији датуми и навигација. Побољшане светле палете, Месец и временски ефекти.",
        "Тајмер нове навике ради само ако га укључите. Подешавања аутоматског брисања су видљива. Претрага временских зона по граду или UTC одступању.",
        "Светлији натписи на картама и ружичасти обрнути положаји. Савети се чувају током дана. Тамноплави Пут хероја и нови Telegram канал."),
    "uk" to listOf(
        "Ширші блоки «Сьогодні», зручніші дати й навігація. Поліпшено світлі палітри, місячний блок і погодні ефекти.",
        "Таймер нової звички вмикається лише за вашим вибором. Налаштування автовидалення відкриті. Пошук часових поясів за містом або зміщенням UTC.",
        "Яскравіші написи карт і рожеві перевернуті позиції. Поради зберігаються на день. Темно-синій Шлях героя та новий Telegram-канал."),
    "zh" to listOf(
        "加宽“今天”面板，优化日历日期与导航。改进浅色配色、月亮面板和天气效果。",
        "新习惯的计时器仅在您主动开启后启用。自动删除设置始终可见。可按城市或 UTC 时差搜索时区。",
        "提高神谕卡片文字亮度，以粉红色区分逆位。每日建议保存在本机。英雄之路采用深蓝背景，并更新 Telegram 频道链接。"),
    "tr" to listOf(
        "Daha geniş Bugün panelleri, daha anlaşılır tarihler ve gezinme. Açık paletler, Ay paneli ve hava efektleri iyileştirildi.",
        "Yeni alışkanlıklarda zamanlayıcı yalnızca siz açarsanız etkinleşir. Otomatik silme ayarları görünürdür. Şehir veya UTC farkıyla saat dilimi arayın.",
        "Kart yazıları daha parlak, ters konumlar pembedir. Öneriler gün boyunca saklanır. Koyu mavi Kahramanın Yolu ve yeni Telegram kanalı."),
    "ja" to listOf(
        "「今日」のパネルを拡幅し、日付とカレンダー操作を改善。ライト配色、月のパネル、天候の視覚効果を調整しました。",
        "新しい習慣のタイマーは、自分で有効にした場合のみ表示。自動削除設定を常に表示し、都市名や UTC 時差でタイムゾーンを検索できます。",
        "カードの文字を明るくし、逆位置をピンク色で表示。助言をその日の間、端末に保存します。英雄の道を濃紺にし、新しい Telegram チャンネルに対応しました。")
)

internal val notes = mapOf(
    "ru" to Notes("Что нового", "Понятно", listOf(
        "Моделирование по шагам: пояснения и примеры у каждого вопроса, уточнения по ответам и безопасные варианты действий.",
        "Более разнообразные священные слова с новыми правилами ритма и пропорций.",
        "Исправлены окна, размеры кнопок и выбор ветки в майндмэпах.",
        "Обновлены светлые палитры, блоки календаря и погоды.",
        "Новые детальные панорамы природы для смартфона и большого экрана.")),
    "en" to Notes("What’s new", "Got it", listOf(
        "Step-by-step modelling: explanations and examples for every question, adaptive follow-ups and safe action options.",
        "More varied sacred words with new rhythm and proportion rules.",
        "Refined dialogs, button sizes and named branch selection in mind maps.",
        "Updated light palettes, calendar and weather panels.",
        "New detailed nature panoramas for phones and large screens.")),
    "he" to Notes("מה חדש", "הבנתי", listOf(
        "מידול צעד אחר צעד עם הסברים ודוגמאות לכל שאלה, שאלות המשך מותאמות ואפשרויות פעולה בטוחות.",
        "מגוון רחב יותר של מילים מקודשות, עם כללים חדשים לקצב וליחס בין החלקים.",
        "שופרו תיבות הדו־שיח, גודלי הכפתורים ובחירת ענפים לפי שם במפות חשיבה.",
        "עודכנו לוחות הצבעים הבהירים ותצוגות לוח השנה ומזג האוויר.",
        "נוספו תמונות נוף פנורמיות מפורטות לטלפונים ולמסכים גדולים.")),
    "ar" to Notes("ما الجديد", "حسنًا", listOf(
        "نمذجة خطوة بخطوة مع شرح وأمثلة لكل سؤال، وأسئلة متابعة تتكيّف مع الإجابات، وخيارات آمنة للتصرّف.",
        "تنوع أكبر في الكلمات المقدسة بفضل قواعد جديدة للإيقاع والتناسب.",
        "تحسين مربعات الحوار وأحجام الأزرار واختيار الفروع بالاسم في الخرائط الذهنية.",
        "تحديث لوحات الألوان الفاتحة ولوحتي التقويم والطقس.",
        "مشاهد بانورامية جديدة ومفصّلة للطبيعة على الهواتف والشاشات الكبيرة.")),
    "ko" to Notes("새로운 기능", "확인", listOf(
        "단계별 모델링에서 질문마다 설명과 예시를 제공합니다. 답변에 맞춘 후속 질문과 안전하게 시도할 수 있는 행동도 제시합니다.",
        "리듬과 비례에 관한 새 규칙을 적용해 신성한 단어의 구성이 더 다양해졌습니다.",
        "대화상자와 버튼 크기를 조정하고 마인드맵에서 이름으로 가지를 선택하는 기능을 개선했습니다.",
        "밝은 테마의 색상과 달력 및 날씨 패널을 새롭게 다듬었습니다.",
        "휴대전화와 대형 화면에 정교한 자연 파노라마 이미지를 추가했습니다.")),
    "nl" to Notes("Wat is er nieuw?", "Begrepen", listOf(
        "Stapsgewijs modelleren met uitleg en voorbeelden bij elke vraag, vervolgvragen die aansluiten op je antwoorden en veilige handelingsmogelijkheden.",
        "Meer variatie in de heilige woorden dankzij nieuwe regels voor ritme en verhoudingen.",
        "Verbeterde dialoogvensters, knopafmetingen en selectie van takken op naam in mindmaps.",
        "Bijgewerkte lichte kleurenpaletten en vernieuwde kalender- en weerpanelen.",
        "Nieuwe gedetailleerde natuurpanorama’s voor telefoons en grote schermen.")),
    "el" to Notes("Τι νέο υπάρχει", "Κατάλαβα", listOf(
        "Μοντελοποίηση βήμα προς βήμα: εξηγήσεις και παραδείγματα σε κάθε ερώτηση, προσαρμοστικές διευκρινίσεις και ασφαλείς επιλογές δράσης.",
        "Πιο ποικίλες ιερές λέξεις με νέους κανόνες ρυθμού και αναλογιών.",
        "Βελτιωμένα παράθυρα, κουμπιά και επιλογή κλάδου με όνομα στους χάρτες σκέψης.",
        "Ανανεωμένες φωτεινές παλέτες, ημερολόγιο και καιρός.",
        "Νέα λεπτομερή πανοράματα φύσης για κινητά και μεγάλες οθόνες.")),
    "de" to Notes("Was ist neu", "Verstanden", listOf(
        "Schrittweise Modellierung: Erklärungen und Beispiele zu jeder Frage, passende Rückfragen und sichere Handlungsoptionen.",
        "Vielfältigere heilige Wörter mit neuen Rhythmus- und Proportionsregeln.",
        "Überarbeitete Dialoge, Schaltflächen und benannte Zweigauswahl in Mindmaps.",
        "Aktualisierte helle Paletten, Kalender- und Wetterfelder.",
        "Neue detaillierte Naturpanoramen für Smartphones und große Bildschirme.")),
    "fr" to Notes("Nouveautés", "Compris", listOf(
        "Modélisation pas à pas : explications et exemples à chaque question, précisions adaptées et actions sûres.",
        "Mots sacrés plus variés avec de nouvelles règles de rythme et de proportions.",
        "Fenêtres, dimensions des boutons et sélection des branches par leur nom améliorées.",
        "Palettes claires, calendrier et météo retravaillés.",
        "Nouveaux panoramas naturels détaillés pour mobiles et grands écrans.")),
    "es" to Notes("Novedades", "Entendido", listOf(
        "Modelado paso a paso: explicaciones y ejemplos en cada pregunta, aclaraciones adaptadas y acciones seguras.",
        "Palabras sagradas más variadas con nuevas reglas de ritmo y proporción.",
        "Mejoras en ventanas, tamaño de botones y selección de ramas por nombre.",
        "Paletas claras y paneles de calendario y tiempo renovados.",
        "Nuevas panorámicas naturales detalladas para móviles y pantallas grandes.")),
    "it" to Notes("Novità", "Ho capito", listOf(
        "Modellazione guidata: spiegazioni ed esempi per ogni domanda, approfondimenti adattivi e azioni sicure.",
        "Parole sacre più varie con nuove regole di ritmo e proporzioni.",
        "Finestre, dimensioni dei pulsanti e scelta dei rami per nome migliorate.",
        "Palette chiare e pannelli di calendario e meteo aggiornati.",
        "Nuovi panorami naturali dettagliati per telefoni e grandi schermi.")),
    "pt" to Notes("Novidades", "Entendi", listOf(
        "Modelação por etapas: explicações e exemplos em cada pergunta, esclarecimentos adaptados e ações seguras.",
        "Palavras sagradas mais variadas com novas regras de ritmo e proporção.",
        "Melhorias nas janelas, dimensões dos botões e seleção de ramos pelo nome.",
        "Paletas claras e painéis de calendário e meteorologia renovados.",
        "Novos panoramas naturais detalhados para telemóveis e ecrãs grandes.")),
    "pl" to Notes("Co nowego", "Rozumiem", listOf(
        "Modelowanie krok po kroku: objaśnienia i przykłady przy każdym pytaniu, dopasowane pytania uzupełniające i bezpieczne działania.",
        "Bardziej zróżnicowane święte słowa z nowymi zasadami rytmu i proporcji.",
        "Poprawione okna, rozmiary przycisków i wybór gałęzi według nazwy.",
        "Odświeżone jasne palety oraz panele kalendarza i pogody.",
        "Nowe szczegółowe panoramy przyrody na telefony i duże ekrany.")),
    "sr" to Notes("Шта је ново", "Разумем", listOf(
        "Моделовање корак по корак: објашњења и примери уз свако питање, прилагођена потпитања и безбедни поступци.",
        "Разноврсније свете речи са новим правилима ритма и пропорција.",
        "Исправљени прозори, величине дугмади и избор гране по називу.",
        "Дорађене светле палете, календар и временски подаци.",
        "Нове детаљне панораме природе за телефоне и велике екране.")),
    "uk" to Notes("Що нового", "Зрозуміло", listOf(
        "Моделювання крок за кроком: пояснення й приклади до кожного запитання, адаптивні уточнення та безпечні варіанти дій.",
        "Різноманітніші священні слова з новими правилами ритму й пропорцій.",
        "Виправлено вікна, розміри кнопок і вибір гілки за назвою в мапах думок.",
        "Оновлено світлі палітри, блоки календаря й погоди.",
        "Нові детальні панорами природи для смартфонів і великих екранів.")),
    "zh" to Notes("本次更新", "知道了", listOf(
        "逐步建模：每个问题都有说明和示例，并根据回答提出后续问题及安全行动选项。",
        "神圣词语的声音更加多样，采用新的节奏与比例规则。",
        "改进弹窗、按钮尺寸和思维导图中的分支名称选择。",
        "更新浅色配色、日历和天气面板。",
        "为手机和大屏幕重新制作了细节丰富的自然全景图。")),
    "tr" to Notes("Yenilikler", "Anladım", listOf(
        "Adım adım modelleme: her soru için açıklama ve örnekler, yanıtlara uygun ek sorular ve güvenli eylem seçenekleri.",
        "Yeni ritim ve oran kurallarıyla daha çeşitli kutsal sözcükler.",
        "Pencereler, düğme boyutları ve zihin haritalarında adla dal seçimi iyileştirildi.",
        "Açık paletler, takvim ve hava durumu panelleri yenilendi.",
        "Telefonlar ve büyük ekranlar için yeni, ayrıntılı doğa panoramaları.")),
    "ja" to Notes("今回の更新", "了解", listOf(
        "段階的なモデリング：すべての質問に説明と例を追加し、回答に応じた追加質問と安全な行動案を提示。",
        "リズムと比率の新しい規則により、聖なる言葉の響きを多様化。",
        "ダイアログ、ボタンの寸法、マインドマップの名前による枝の選択を改善。",
        "ライト配色、カレンダーと天気のパネルを更新。",
        "スマートフォンと大画面向けに、精細な自然のパノラマを新しく制作。"))
)

@Composable
internal fun releaseNotesTitle(): String = notes[LocalGenesisLanguage.current]?.title ?: notes.getValue("ru").title

@Composable
internal fun ReleaseNotesDialog(onDismiss: () -> Unit) {
    val language = LocalGenesisLanguage.current
    val context = LocalContext.current
    val changes = remember(context, language) { currentReleaseNotes(context, language) }
    val copy = (notes[language] ?: notes.getValue("ru")).copy(changes = changes)
    AlertDialog(onDismissRequest = onDismiss,
        modifier = Modifier.testTag("release-notes-dialog"),
        title = { Text("${copy.title} · ${BuildConfig.VERSION_NAME}") },
        text = { Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            copy.changes.forEach {
                Text("• $it", style = MaterialTheme.typography.bodyMedium)
            }
        } },
        confirmButton = { TextButton(onClick = onDismiss) { Text(copy.close) } })
}

@Composable
internal fun ReleaseNotesAutoDialog(enabled: Boolean) {
    val context = LocalContext.current
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(context, enabled) {
        if (!enabled) return@LaunchedEffect
        val prefs = context.getSharedPreferences("genesis.release-notes", Context.MODE_PRIVATE)
        val seen = prefs.getInt("seenVersionCode", 0)
        if (seen >= BuildConfig.VERSION_CODE) return@LaunchedEffect
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val updated = packageInfo.lastUpdateTime > packageInfo.firstInstallTime
        prefs.edit().putInt("seenVersionCode", BuildConfig.VERSION_CODE).apply()
        show = updated
    }
    if (show) ReleaseNotesDialog { show = false }
}
