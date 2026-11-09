"""Apply editorial corrections after localize-catalogs.py generates draft catalogues."""

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
catalog_path = ROOT / "app/catalog-translations"
source = json.loads((ROOT / "android/app/src/main/assets/catalogs/theokyklos.json").read_text(encoding="utf-8"))
titles = {segment["id"]: segment["title"]["ru"] for segment in source["segments"]}

TITLE_FIXES = {
    "el": {
        "southeast": "Νοτιοανατολικά · Καμίνι της Δύναμης",
        "south": "Νότος · Νικηφόρα Ενέργεια",
        "west": "Δύση · Ύδατα της Ψυχής",
        "zenith": "Ζενίθ · Άξονας της Εξουσίας",
        "nadir": "Ναδίρ · Τα Βάθη",
        "hearth": "Εσωτερικός Κύκλος · Εστία",
    },
    "de": {"north": "Norden · Souveräner Geist", "southeast": "Südosten · Schmiede der Kraft",
           "west": "Westen · Wasser der Psyche"},
    "fr": {"west": "Ouest · Eaux de Psyche", "hearth": "Anneau intérieur · Foyer"},
    "es": {"west": "Oeste · Aguas de Psyche"},
    "it": {"west": "Ovest · Acque di Psyche"},
    "pt": {"west": "Oeste · Águas de Psyche", "northwest": "Noroeste · Luz e Intuição"},
    "sr": {"zenith": "Зенит · Оса ауторитета", "nadir": "Надир · Дубине"},
    "uk": {"west": "Захід · Води Психеї"},
    "zh": {"north": "北方 · 至高心智", "northeast": "东北 · 野性自然",
           "east": "东方 · 黎明与智慧", "southeast": "东南 · 力量熔炉",
           "south": "南方 · 胜利之力", "southwest": "西南 · 大地与劳作",
           "west": "西方 · Psyche 之水", "northwest": "西北 · 光明与洞察",
           "zenith": "天顶 · 权威之轴", "nadir": "下极 · 深渊",
           "hearth": "内环 · 圣火", "center": "绝对之点",
           "entrance": "入口 · 光之门", "exit": "出口 · 灵魂之印"},
    "tr": {"southeast": "Güneydoğu · Gücün Ocağı",
           "southwest": "Güneybatı · Toprak ve Emek",
           "center": "Mutlak Nokta"},
    "ja": {"north": "北 · 主権の知性", "northeast": "北東 · 野生の自然",
           "east": "東 · 暁と知性", "southeast": "南東 · 力の鍛冶場",
           "south": "南 · 勝利の力", "southwest": "南西 · 大地と労働",
           "west": "西 · Psyche の水域", "northwest": "北西 · 光と洞察",
           "zenith": "天頂 · 権威の軸", "nadir": "天底 · 深淵",
           "hearth": "内環 · 炉", "center": "絶対の中心",
           "entrance": "入口 · 光の門", "exit": "出口 · 魂の封印"},
}

GREEK_PHRASES = {
    "Cosmogonic profile": "Κοσμογονικό προφίλ",
    "Numerical Essence": "Αριθμητική ουσία",
    "Concussion Energy": "Ενέργεια της δόνησης",
    "Deep Indigo": "βαθύ λουλακί",
    "Deep Olive": "βαθύ λαδί",
    "Deep Purple": "βαθύ πορφυρό",
    "Deep Purpur": "βαθύ πορφυρό",
    "Pearl white": "μαργαριταρένιο λευκό",
    "Sea blue": "θαλασσί",
    "Shimmering silver": "λαμπερό ασήμι",
    "Smoldering coal": "σιγοκαίον κάρβουνο",
    "Emerald Green": "σμαραγδένιο πράσινο",
    "Burned Bronze": "καμένος μπρούντζος",
    "Neon green": "φωτεινό πράσινο",
    "World Soul": "Παγκόσμια Ψυχή",
    "Lord of Time and the Seventh Zone": "Κύριος του Χρόνου και της Έβδομης Ζώνης",
    "Cosmogonic profile": "Κοσμογονικό προφίλ",
    "Fifth Sky": "Πέμπτος Ουρανός",
    "Fire Tetrad": "πύρινη Τετράδα",
    "Numerical Essence - The Energy": "Αριθμητική ουσία — Η ενέργεια",
    "Theodore Azinsky": "Θεόδωρος ο Ασινεύς",
}
GREEK_WORDS = {
    "GENESIS": "ΓΕΝΕΣΙΣ", "Hexad": "Εξάδα", "Diad": "Δυάδα", "Tetride": "Τετράδα",
    "Hebdomad": "Επτάδα", "Ogdoada": "Ογδοάδα", "Ennead": "Εννεάδα",
    "Bodywork": "Σωματική πρακτική", "Terracotta": "τερακότα", "Midnight": "μεσονύχτιο",
    "Saffron": "κρόκος", "Indigo": "λουλακί", "Purpur": "πορφυρό",
    "Zoe": "Ζωή", "Pater": "Πατήρ", "Phos": "Φως", "phos": "φως",
    "Aiter": "Αιθήρ", "Anthropos": "Άνθρωπος", "Kinesis": "Κίνηση",
    "Lifestream": "ροή ζωής", "pythmen": "πυθμήν", "gonate": "γόνατα",
    "Numerical": "Αριθμητική", "Essence": "ουσία", "Energy": "ενέργεια",
    "Fire": "φωτιά", "Fifth": "Πέμπτος", "Sky": "Ουρανός",
    "The": "Ο", "the": "το", "and": "και", "Door": "Θύρα",
    "Nadir": "Ναδίρ", "NADIR": "ΝΑΔΙΡ", "Charites": "Χάριτες",
    "Plouton": "Πλούτων", "Olympian": "Ολύμπιος", "Kronos": "Κρόνος",
    "cronus": "κρόνος", "Aletheia": "Αλήθεια", "Meme": "Μημ",
    "Mem": "Μεμ", "Middlena": "Μεσότητα", "Thunderer": "Κεραυνός",
    "Deep": "βαθύ", "spin": "στροφή", "SOTER": "ΣΩΤΗΡ",
    "SPIN": "ΡΑΧΗ", "ANIMINE": "ΚΟΙΛΙΑ",
}
LATIN = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")
SINGLE = dict(zip("abcdefghijklmnopqrstuvwxyz",
    ("α", "β", "κ", "δ", "ε", "φ", "γ", "χ", "ι", "τ", "κ", "λ", "μ", "ν", "ο", "π", "κ", "ρ", "σ", "τ", "υ", "β", "ω", "ξ", "υ", "ζ")))
DIGRAPHS = (("ph", "φ"), ("th", "θ"), ("ch", "χ"), ("ps", "ψ"),
            ("ou", "ου"), ("sh", "σ"), ("ae", "αι"), ("ai", "αι"), ("ei", "ει"))


def transliterate(word: str) -> str:
    def one(part: str) -> str:
        value = part.lower()
        for source, target in DIGRAPHS:
            value = value.replace(source, target)
        value = "".join(SINGLE.get(char, char) for char in value)
        return value.upper() if part.isupper() else value.title() if part.istitle() else value
    return "-".join(one(part) for part in word.split("-"))


def greek_only(value: str) -> str:
    for source, replacement in sorted(GREEK_PHRASES.items(), key=lambda item: -len(item[0])):
        value = re.sub(r"\b" + re.escape(source) + r"\b", replacement, value)
    return LATIN.sub(lambda match: GREEK_WORDS.get(match.group()) or transliterate(match.group()), value)


UK_PHRASES = {
    'In the process of unfolding the reality of the Омега (Ω, ω) acts as the final element, completing the cycle of twenty-four letters and symbolizing the "End" (Teleute - телеіте).':
        'У процесі розгортання реальності Омега (Ω, ω) постає завершальним елементом: вона замикає коло двадцяти чотирьох літер і символізує Кінець (Телеуте).',
    'The alchemist Zosimus of Panopolitan described the Омега as a round letter consisting of two parts, and identified it with the Oceanus (Океанос), the source and seed of all the gods.':
        'Алхімік Зосим із Панополіса описував Омегу як округлу літеру з двох частин і пов’язував її з Океаносом — джерелом і насінням усіх богів.',
    'Terracotta': 'теракотовий', 'Silver': 'сріблястий',
    'Deep Olive': 'глибокий оливковий', 'Deep Indigo': 'глибокий індиго',
    'Emerald Green': 'смарагдовий зелений', 'Burned Bronze': 'обпалена бронза',
    'Shining Gold': 'сяюче золото', 'Sky Blue': 'небесний блакитний',
    'Silver White': 'сріблясто-білий', 'Concussion Energy': 'енергія струсу',
    'Deep Purpur': 'глибокий пурпур', 'Smoldering coal': 'тліюче вугілля',
    'Neon green': 'неоновий зелений', 'Deep Purple': 'глибокий пурпуровий',
    'Transparent Blue': 'прозорий блакитний', 'Indigo': 'індиго',
    'The One': 'Єдиний', 'Pure': 'Чиста', 'Wild': 'Дика',
    'Swift drive': 'Стрімкий порив', 'Intelligence': 'Розум', 'Wise': 'Мудрий',
}
UK_SINGLE = dict(zip('abcdefghijklmnopqrstuvwxyz',
    ('а','б','к','д','е','ф','ґ','г','і','дж','к','л','м','н','о','п','к','р','с','т','у','в','в','кс','и','з')))
UK_DIGRAPHS = (('kh','х'),('ph','ф'),('th','т'),('sh','ш'),('ch','ч'),
               ('zh','ж'),('ou','у'),('ei','ей'),('oi','ой'),('ae','е'),
               ('ya','я'),('yu','ю'),('ie','іє'))


def ukrainian_only(value: str) -> str:
    for source, replacement in sorted(UK_PHRASES.items(), key=lambda item: -len(item[0])):
        value = value.replace(source, replacement)
    def rewrite(match: re.Match) -> str:
        word = match.group()
        letters = word.lower()
        for source, target in UK_DIGRAPHS:
            letters = letters.replace(source, target)
        letters = ''.join(UK_SINGLE.get(letter, letter) for letter in letters)
        return letters.upper() if word.isupper() else letters.title() if word.istitle() else letters
    return LATIN.sub(rewrite, value)


for language, fixes in TITLE_FIXES.items():
    path = catalog_path / f"{language}.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    for sector_id, title in fixes.items():
        catalog["theokyklos"][titles[sector_id]] = title
    if language == "el":
        catalog["theokyklos"].update({
            "С": "Β", "СВ": "ΒΑ", "В": "Α", "ЮВ": "ΝΑ", "Ю": "Ν",
            "ЮЗ": "ΝΔ", "З": "Δ", "СЗ": "ΒΔ", "НАДИР": "ΝΑΔΙΡ",
            "Чистая.": "Η Αγνή.", "Дикая.": "Η Άγρια.",
            "Неприкосновенная.": "Η Άθικτη.", "Великолепие.": "Λαμπρότητα.",
            "Стремительный натиск.": "Ορμητική έφοδος.",
            "Светозарный.": "Η Φωτεινή.",
        })
        for letter in catalog["stoicheion"].values():
            for field in ("name", "tagline", "content"):
                letter[field] = greek_only(letter[field])
        for key, value in catalog["theokyklos"].items():
            catalog["theokyklos"][key] = greek_only(value)
        for art in catalog["stoicheionArt"].values():
            for field in ("body", "bodyGreek", "invocation"):
                art[field] = greek_only(art[field])
    if language == "uk":
        for letter in catalog["stoicheion"].values():
            for field in ("name", "tagline", "content"):
                letter[field] = ukrainian_only(letter[field])
        for key, value in catalog["theokyklos"].items():
            catalog["theokyklos"][key] = ukrainian_only(value)
        for art in catalog["stoicheionArt"].values():
            for field in ("body", "bodyGreek", "invocation"):
                art[field] = ukrainian_only(art[field])
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

year_path = ROOT / "app/year-translations/el.json"
year = json.loads(year_path.read_text(encoding="utf-8"))
for key, value in year.items():
    if key != "__lunarStartTemplate":
        year[key] = greek_only(value).replace("XIII", "13")
year_path.write_text(json.dumps(year, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

YEAR_CJK = {
    "ja": {
        "lunar": "GENESIS では、これは象徴的な「女性の年」です。年の内的なリズムは太陽暦の月や週ではなく、月の満ち欠けによって形づくられます。春分は毎年の基準点にすぎず、実践の時期は各太陰月の内部で定まるため、グレゴリオ暦の年の区切りには縛られません。",
        "basis": "これは GENESIS が構築した現代の象徴体系であり、単一の古代ギリシャ暦を復元したものではありません。古代の着想源は、人々に時を知らせる天のしるしとしての Selene と、Homer に伝わる月半ばの満月です。ギリシャの太陰太陽暦では、閏月を設けて月々の巡りを季節と合わせていました。",
        "civil": "現代のグレゴリオ暦は、幾重もの歴史をもつ世俗の市民暦です。月の名称や年の数え方はローマから受け継がれました。7日を一週とする考え方の源流には古代バビロンの占星術があり、目に見える七つの天体が重視されました。この周期は、ユダヤ教の安息日とギリシャ・ローマの惑星信仰という二つの経路を通じてローマへ広がりました。古代には曜日に太陽、月、火星、水星、木星、金星、土星が結びつき、それぞれの日に神聖な意味が与えられました。1月1日を新年とする慣習もローマに由来します。1月は門、移行、始まりの神 Janus と結びついていました。紀元前153年、執政官がイスパニアでの戦争に早く赴けるよう、その就任日が1月1日に移されました。年を執政官の名で呼んでいたため、この日が市民の年の始まりとなり、Julius Caesar の改革がその慣習を定着させました。1582年、教皇 Gregory XIII はユリウス暦に蓄積したずれを正し、教会の復活祭計算で用いる春分の日を元の位置に戻すため、後に自身の名で呼ばれる暦改革を導入しました。こうして現代の暦には、バビロンとユダヤ、ギリシャ・ローマ、ローマの市民制度、キリスト教会の伝統が重なっています。GENESIS の象徴体系では、Cronus が時間、尺度、限界、周期の絶え間ない歩みを体現する守護者です。土曜日は仕事を止め、身体を回復し、内なる静けさへ戻る神聖な休息の日と考えます。この実践は、労働を控え神にささげるユダヤ教の第七日、Shabbat と響き合います。",
    },
    "zh": {
        "lunar": "在 GENESIS 的象征体系中，这是一个“女性之年”：它的内在节律不由太阳年的月份和星期决定，而由月相的渐盈、圆满与渐亏决定。春分只是每年的校准点；实践时机在各个太阴月内形成，因此不受公历年份划分的约束。",
        "basis": "这是 GENESIS 的现代象征体系，并非对某一种古希腊历法的复原。它借鉴了 Selene 作为天象标志的形象，以及 Homer 颂歌中月中满月的意象；希腊阴阳合历通过设置闰月，使月份与季节保持大致同步。",
        "civil": "现代格里高利历是一套历经多层演变的世俗民用历法。月份与纪年的方式承袭自罗马。七日一周的观念可追溯到古巴比伦；巴比伦占星术特别重视肉眼可见的七个天体。这种节律经由犹太教的安息日传统和希腊罗马的行星传统传入罗马。古人将星期各日与太阳、月亮、火星、水星、木星、金星和土星联系起来，赋予每一天神圣的象征意义。以 1 月 1 日为新年也是源自罗马的习俗，并非一人发明。1 月与掌管门户、过渡和开端的 Janus 相关。公元前 153 年，为使执政官更早赴西班牙作战，其就职日期改为 1 月 1 日；由于当时以执政官的姓名标记年份，这一天成为民用年的起点，Julius Caesar 的改革又巩固了这一传统。1582 年，教皇 Gregory XIII 推行以他命名的历法改革，纠正儒略历累积的偏差，使春分重新符合教会计算复活节的依据。因此，现代历法汇聚了巴比伦与犹太、希腊与罗马、罗马民政以及基督教会的传统。在 GENESIS 的象征体系中，Cronus 守护这一纪年，象征时间、尺度、界限以及周期不可阻挡的运行。星期六被视为必须休息的神圣日子：暂停日常劳动、恢复身体并回归内心宁静。这一实践与犹太教的 Shabbat 相呼应——第七日应停止工作，将一天奉献给上帝。",
    },
}
for language, replacements in YEAR_CJK.items():
    path = ROOT / f"app/year-translations/{language}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for source in list(data):
        if source.startswith("В системе GENESIS это магический «женский» год:"):
            data[source] = replacements["lunar"]
        elif source.startswith("Это современная символическая система GENESIS") and len(source) > 300:
            data[source] = replacements["basis"]
        elif source.startswith("Современный григорианский календарь") and len(source) > 1500:
            data[source] = replacements["civil"]
    for source, translated in data.items():
        if source.startswith("__"):
            continue
        if language == "ja":
            names = {"クロノス": "Cronus", "ピタゴラス": "Pythagoras", "ヘシオドス": "Hesiod",
                     "ホメロス": "Homer", "ホーマー": "Homer", "セレーネ": "Selene",
                     "アレイオス": "Areios", "ヤヌス": "Janus"}
        else:
            names = {"克洛诺斯": "Cronus", "毕达哥拉斯": "Pythagoras", "赫西俄德": "Hesiod",
                     "荷马": "Homer", "塞勒涅": "Selene", "雅努斯": "Janus"}
        for old, new in names.items():
            translated = translated.replace(old, new)
        data[source] = translated
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

uk_path = ROOT / "app/year-translations/uk.json"
uk_year = json.loads(uk_path.read_text(encoding="utf-8"))
for source in uk_year:
    if source.startswith("В системе GENESIS это магический «женский» год:"):
        uk_year[source] = "У системі GENESIS це магічний «жіночий» рік: його внутрішній ритм визначають не місяці й тижні сонячного року, а зростання, повня та спадання Місяця. Весняне рівнодення слугує лише щорічною точкою налаштування; умови для практик виникають усередині самих місячних місяців і тому не залежать від григоріанського поділу року."
    elif source.startswith("Это современная символическая система GENESIS") and len(source) > 300:
        uk_year[source] = "Це сучасна символічна система GENESIS, а не реконструкція єдиного давньогрецького календаря. Її антична основа — образ Селени як небесного знака для людей і повня посеред місяця в гомерівському гімні; грецькі місячно-сонячні календарі узгоджували місяці з порами року за допомогою вставного місяця."
uk_path.write_text(json.dumps(uk_year, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# The primary UI dictionaries also contain ancient names outside the catalogues.
spec = importlib.util.spec_from_file_location("genesis_localizer", ROOT / "scripts/localize-catalogs.py")
localizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(localizer)
ancient_names = {term[0]: term[1] for term in localizer.TERMS}
pattern = re.compile(r"\b(?:" + "|".join(map(re.escape, sorted(ancient_names, key=len, reverse=True))) + r")\b", re.IGNORECASE)
GREEK_UI_LABELS = {
    "Артемида": "Άρτεμις", "Геката": "Ἑκάτη", "Зевс": "Δίας", "Гера": "Ήρα",
    "Посейдон": "Ποσειδώνας", "Гесиод": "Ησίοδος", "Гомер": "Όμηρος",
    "Пифагор": "Πυθαγόρας", "Монада": "Μονάς", "Апейрон": "Ἄπειρον",
    "Агонион": "Αγώνιον", "Стойхейон": "Στοιχεῖον", "Теокиклос": "Θεόκυκλος",
    "· Пифмен": "· Πυθμήν", "Гно · Метэр · Басилея": "Γνώ · Μήτηρ · Βασίλεια",
    "Гно · Метэр · Базилея": "Γνώ · Μήτηρ · Βασίλεια",
    "Арес": "Άρης", "Афродита": "Αφροδίτη", "Гермес": "Ερμής",
    "Аполлон": "Απόλλων", "Деметра": "Δήμητρα", "Гефест": "Ήφαιστος",
    "Афина": "Αθηνά", "Гестия": "Εστία", "Диада": "Δυάδα",
    "Пентада": "Πεντάδα", "Тетрада": "Τετράδα", "Триада": "Τριάδα",
    "Эфир": "Αιθήρ",
}
for path in (ROOT / "app").glob("translations.el.*.json"):
    dictionary = json.loads(path.read_text(encoding="utf-8"))
    for key, value in dictionary.items():
        dictionary[key] = pattern.sub(lambda match: ancient_names[match.group().title()], value)
        if key in GREEK_UI_LABELS:
            dictionary[key] = GREEK_UI_LABELS[key]
        elif key in ("Нюкс · Ночь", "Эребос · Мрак", "Тартарос · Бездна",
                     "Эрос · Влечение", "Фанес · Сияние"):
            dictionary[key] = greek_only(dictionary[key])
    path.write_text(json.dumps(dictionary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
