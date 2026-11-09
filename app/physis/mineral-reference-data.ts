import type { ReferenceText, SupplementReference } from './supplement-reference-data';

export type MineralIntake = { minAge: number; maxAge: number | null; male: number; female: number };
export type MineralProfile = {
  id: string; name: ReferenceText; kind: 'RDA' | 'AI'; unit: 'mg' | 'mcg'; intakes: MineralIntake[];
  note: ReferenceText; absorption: ReferenceText; supplementation: ReferenceText;
  interactions: ReferenceText; combinations: ReferenceText; sources: string[];
};
const ods = (name: string) => `https://ods.od.nih.gov/factsheets/${name}-HealthProfessional/`;
const intake = (male: number, female = male, minAge = 19, maxAge: number | null = null): MineralIntake => ({ minAge, maxAge, male, female });
const profile = (id: string, name: ReferenceText, kind: MineralProfile['kind'], unit: MineralProfile['unit'], intakes: MineralIntake[], note: ReferenceText, absorption: ReferenceText, supplementation: ReferenceText, interactions: ReferenceText, combinations: ReferenceText, sources: string[]): MineralProfile => ({ id, name, kind, unit, intakes, note, absorption, supplementation, interactions, combinations, sources });
const ordinaryFood: ReferenceText = ['Обычные пищевые сочетания не требуют разнесения по времени. Взаимодействия высоких доз добавок и лекарств оценивают отдельно.', 'Ordinary food combinations do not require separate timing. High-dose supplement and medicine interactions need separate assessment.'];
const noRoutine: ReferenceText = ['При достаточном поступлении с пищей дополнительный приём обычно не нужен. Тренировки сами по себе не доказывают дефицит.', 'With adequate dietary intake, routine supplementation is usually unnecessary. Training alone does not establish deficiency.'];
const noComplex: ReferenceText = ['Комбинированный препарат не обязателен. Сверяйте количество самого элемента и суммарное поступление из всех средств.', 'A combination product is not required. Check the elemental amount and total intake from all products.'];

export const MINERAL_PROFILES: MineralProfile[] = [
  profile('calcium', ['Кальций', 'Calcium'], 'RDA', 'mg', [intake(1000, 1000, 19, 50), intake(1000, 1200, 51, 70), intake(1200, 1200, 71)],
    ['Потребность зависит от возраста и пола; витамин D участвует в усвоении кальция.', 'Requirements vary by age and sex; vitamin D supports calcium absorption.'],
    ['Карбонат лучше принимать с едой; цитрат меньше зависит от кислотности желудка. Усвоение добавки снижается при больших разовых количествах. Масса соли не равна массе кальция.', 'Carbonate is better taken with food; citrate depends less on stomach acidity. Absorption falls with larger single supplement amounts. Salt weight is not calcium weight.'],
    ['Добавка может восполнить недостающее количество в рационе; фиксированный комплекс с D3 нужен не каждому.', 'A supplement can cover a dietary shortfall; a fixed D3 combination is not needed by everyone.'],
    ['Магний и фосфор в обычной еде не запрещены вместе с кальцием. Добавки кальция взаимодействуют с левотироксином и некоторыми антибиотиками; интервалы зависят от лекарства.', 'Dietary magnesium and phosphorus are not prohibited with calcium. Calcium supplements interact with levothyroxine and some antibiotics; timing depends on the medicine.'], noComplex, [ods('Calcium')]),
  profile('phosphorus', ['Фосфор', 'Phosphorus'], 'RDA', 'mg', [intake(700)],
    ['Пища обычно покрывает потребность; фосфатные добавки особенно важны при оценке рациона при болезнях почек.', 'Food usually covers requirements; phosphate additives are especially relevant when assessing diets in kidney disease.'],
    ['Фосфаты пищевых добавок усваиваются хорошо; фитатный фосфор растений доступен хуже.', 'Food-additive phosphates are readily absorbed; plant phytate phosphorus is less available.'], noRoutine,
    ['Кальций и фосфор естественно присутствуют вместе в продуктах. Это не основание объявлять их несовместимыми; при заболеваниях почек важен общий баланс.', 'Calcium and phosphorus naturally occur together in foods. This does not make them incompatible; overall balance matters in kidney disease.'], noComplex, [ods('Phosphorus')]),
  profile('magnesium', ['Магний', 'Magnesium'], 'RDA', 'mg', [intake(400, 310, 19, 30), intake(420, 320, 31)],
    ['420 мг — ориентир для мужчин от 31 года, а не единая норма для всех взрослых.', '420 mg is the reference for men aged 31 and older, not all adults.'],
    ['Цитрат, хлорид, лактат и аспартат обычно усваиваются лучше оксида. Слово «хелат» само по себе не гарантирует лучшую пользу или переносимость.', 'Citrate, chloride, lactate and aspartate are generally absorbed better than oxide. The word “chelate” alone does not guarantee better benefit or tolerance.'], noRoutine,
    ['Нет общего запрета сочетать пищевой магний с кальцием или цинком. Добавки могут мешать некоторым антибиотикам и бисфосфонатам; при снижении функции почек опасно накопление.', 'There is no general ban on dietary magnesium with calcium or zinc. Supplements can interfere with some antibiotics and bisphosphonates; impaired kidneys risk accumulation.'],
    ['Соли магния и калия в лекарстве не являются обязательным комплексом для тренировок. Учитывайте показания и работу почек.', 'Magnesium and potassium salts in a medicine are not a required training combination. Consider indications and kidney function.'], [ods('Magnesium')]),
  profile('potassium', ['Калий', 'Potassium'], 'AI', 'mg', [intake(3400, 2600)],
    ['AI отражает общее поступление. При нарушении выведения калия эти ориентиры могут не подходить.', 'AI describes total intake. These references may be unsuitable with impaired potassium excretion.'],
    ['Пищевые источники включают бобовые, картофель, овощи, сухофрукты, рыбу и молочные продукты.', 'Food sources include legumes, potatoes, vegetables, dried fruit, fish and dairy.'], noRoutine,
    ['Ингибиторы АПФ, БРА, калийсберегающие диуретики и болезни почек повышают риск гиперкалиемии. Учитывайте заменители соли с калием.', 'ACE inhibitors, ARBs, potassium-sparing diuretics and kidney disease increase hyperkalemia risk. Account for potassium salt substitutes.'], noComplex, [ods('Potassium')]),
  profile('sodium', ['Натрий', 'Sodium'], 'AI', 'mg', [intake(1500)],
    ['NASEM 2019: AI 1500 мг. CDRR 2300 мг — уровень, выше которого рекомендуется снижение потребления для уменьшения хронического риска; это не цель и не верхний безопасный предел UL.', 'NASEM 2019: AI 1500 mg. CDRR 2300 mg is the level above which reducing intake is recommended to reduce chronic risk; it is neither a target nor a UL.'],
    ['1 г обычной поваренной соли содержит примерно 400 мг натрия и 600 мг хлорида. Это расчёт состава NaCl, а не рекомендация порции.', '1 g of ordinary table salt contains about 400 mg sodium and 600 mg chloride. This is a NaCl composition calculation, not a serving recommendation.'],
    ['При длительной нагрузке и больших потерях пота восполнение жидкости и натрия подбирают индивидуально; обычная аэробная тренировка не означает обязательного приёма соли.', 'During prolonged exercise with substantial sweat loss, fluid and sodium replacement is individualized; ordinary aerobic exercise does not require salt supplementation.'],
    ['Избыточное потребление соли повышает давление. При сердечной или почечной недостаточности ограничения индивидуальны; натрий крови не равен количеству соли в рационе.', 'Excess salt raises blood pressure. Heart or kidney failure requires individualized guidance; blood sodium is not the amount of dietary salt.'], noComplex,
    ['https://lpi.oregonstate.edu/mic/minerals/sodium', 'https://www.nationalacademies.org/read/25353/chapter/1']),
  profile('chloride', ['Хлорид (хлор)', 'Chloride'], 'AI', 'mg', [intake(2300, 2300, 19, 50), intake(2000, 2000, 51, 70), intake(1800, 1800, 71)],
    ['AI для хлорида: NASEM 2005. Это отдельный ион, а не вторая норма натрия; их количества нельзя складывать как одну потребность.', 'Chloride AI: NASEM 2005. This is a separate ion, not another sodium reference; their amounts cannot be added as one requirement.'],
    ['Основной источник — хлорид натрия в пище. Хлорид является пищевым ионом; элементарный хлор не является пищевой добавкой.', 'The main source is sodium chloride in food. Chloride is a dietary ion; elemental chlorine is not a dietary supplement.'],
    ['Отдельная добавка обычно не нужна. Потери при рвоте и других заболеваниях требуют оценки причины и водно-электролитного баланса.', 'A separate supplement is usually unnecessary. Losses from vomiting or illness require assessment of the cause and fluid-electrolyte balance.'], ordinaryFood, noComplex,
    ['https://www.nationalacademies.org/read/10925/chapter/8']),
  profile('iodine', ['Йод', 'Iodine'], 'RDA', 'mcg', [intake(150)],
    ['В беременности и при грудном вскармливании действуют другие нормы, не включённые в этот обзор.', 'Pregnancy and lactation use different references, not included in this overview.'],
    ['Йодид хорошо усваивается. Содержание в водорослях сильно колеблется; количество в йодированной соли сверяйте по этикетке.', 'Iodide is well absorbed. Seaweed content varies widely; check iodized salt labels.'],
    ['Оценивайте надёжные пищевые источники. Не увеличивайте количество соли ради йода; недостаток и избыток вредят щитовидной железе.', 'Assess reliable food sources. Do not increase salt intake for iodine; both deficiency and excess can harm the thyroid.'],
    ['При заболеваниях щитовидной железы, приёме антитиреоидных средств или амиодарона добавки требуют индивидуальной оценки.', 'Thyroid disease, antithyroid medicines or amiodarone require individual assessment before supplementation.'], noComplex, [ods('Iodine')]),
  profile('chromium', ['Хром (III)', 'Chromium (III)'], 'AI', 'mcg', [intake(35, 25, 19, 50), intake(30, 20, 51)],
    ['AI США установлен в 2001 году и не пересматривался FNB. EFSA в 2014 году не нашла убедительных доказательств незаменимости хрома и не установила норму. Это не рекомендация принимать добавку.', 'The US AI was set in 2001 and has not been reassessed by FNB. In 2014 EFSA found no convincing evidence of essentiality and set no intake reference. This is not a supplement recommendation.'],
    ['Усвоение низкое; пиколинат не доказан как клинически лучший вариант для каждого человека. Количество в продуктах сильно варьирует.', 'Absorption is low; picolinate is not proven clinically superior for everyone. Food content varies widely.'],
    ['Избыток углеводов сам по себе не является показанием. Убедительной пользы для набора мышц и значимого похудения нет.', 'High carbohydrate intake alone is not an indication. Convincing benefits for muscle gain or meaningful weight loss are lacking.'],
    ['Возможны взаимодействия с инсулином, сахароснижающими средствами и левотироксином. Данные об усвоении не обосновывают обязательный комплекс с C или B3.', 'Interactions can occur with insulin, glucose-lowering medicines and levothyroxine. Absorption data do not justify a required C or B3 combination.'], noComplex, [ods('Chromium')]),
  profile('copper', ['Медь', 'Copper'], 'RDA', 'mcg', [intake(900)],
    ['900 мкг = 0,9 мг. Единицы важны при сравнении с этикетками.', '900 mcg = 0.9 mg. Units matter when comparing labels.'],
    ['Достоверных оснований считать одну форму добавки универсально лучшей недостаточно.', 'Evidence is insufficient to call one supplement form universally superior.'], noRoutine,
    ['Длительный приём высоких доз цинка может вызвать дефицит меди. Это не запрет сочетать обычные пищевые источники цинка и меди.', 'Long-term high-dose zinc can cause copper deficiency. This does not prohibit combining ordinary dietary zinc and copper sources.'], noComplex, [ods('Copper')]),
  profile('fluoride', ['Фторид (фтор)', 'Fluoride'], 'AI', 'mg', [intake(4, 3)],
    ['Учитывают общее поступление, включая воду. Фторид — ион фтора, а не элементарный фтор.', 'Total intake includes water. Fluoride is the ionic form, not elemental fluorine.'],
    ['Вода и чай могут быть важнее большинства продуктов; содержание зависит от воды и происхождения чая.', 'Water and tea can contribute more than most foods; content depends on water and tea origin.'],
    ['Доказано применение фторидов для профилактики кариеса. Пероральная добавка взрослому не назначается автоматически; выбор зависит от стоматологической оценки и воды.', 'Fluorides have evidence for caries prevention. Oral adult supplementation is not automatic; selection depends on dental assessment and water.'],
    ['Избыток вреден; детские схемы и средства для местного применения нельзя переводить в пищевые дозы по этой таблице.', 'Excess is harmful; child regimens and topical products cannot be converted to dietary doses using this table.'], noComplex, [ods('Fluoride')]),
  profile('iron', ['Железо', 'Iron'], 'RDA', 'mg', [intake(8, 18, 19, 50), intake(8, 8, 51)],
    ['Потребность до 51 года различается по полу. Беременность, кровопотери и лечение анемии оценивают отдельно.', 'Requirements below age 51 differ by sex. Pregnancy, blood loss and anemia treatment need separate assessment.'],
    ['Витамин C улучшает усвоение негемового железа; фитаты и полифенолы могут его уменьшать. Гемовое железо мяса усваивается лучше.', 'Vitamin C improves nonheme iron absorption; phytates and polyphenols can reduce it. Meat heme iron is better absorbed.'],
    ['Кишечные жалобы сами по себе не являются показанием. Дефицит и его причину устанавливают клинически и лабораторно; лечебная доза отличается от пищевой нормы.', 'Gut symptoms alone are not an indication. Deficiency and its cause require clinical and laboratory assessment; treatment doses differ from dietary references.'],
    ['Большие дозы кальция и железа в добавках могут взаимодействовать. Общего запрета пищевых сочетаний с марганцем нет; учитывайте левотироксин и антибиотики.', 'Large calcium and iron supplement doses can interact. There is no general ban on dietary combinations with manganese; account for levothyroxine and antibiotics.'], noComplex, [ods('Iron')]),
  profile('manganese', ['Марганец', 'Manganese'], 'AI', 'mg', [intake(2.3, 1.8)],
    ['Кофактор ферментов; пищевой дефицит у людей встречается редко.', 'An enzyme cofactor; dietary deficiency in humans is rare.'],
    ['Форма добавки не имеет доказанного универсального преимущества. Цельные злаки, орехи и бобовые являются пищевыми источниками.', 'No supplement form has a proven universal advantage. Whole grains, nuts and legumes are dietary sources.'], noRoutine,
    ['Обмен связан с железом, но обычные продукты не требуют разделения. Избыток марганца может повреждать нервную систему; болезни печени увеличивают риск накопления.', 'Metabolism is linked to iron, but ordinary foods need no separation. Excess manganese can harm the nervous system; liver disease increases accumulation risk.'], noComplex, [ods('Manganese')]),
  profile('molybdenum', ['Молибден', 'Molybdenum'], 'RDA', 'mcg', [intake(45)],
    ['Кофактор ферментов. Приобретённый дефицит крайне редок.', 'An enzyme cofactor. Acquired deficiency is extremely rare.'],
    ['Сравнительных исследований биодоступности разных форм добавок нет. Содержание в растениях зависит от почвы.', 'Comparative studies of supplement-form bioavailability are lacking. Plant content depends on soil.'], noRoutine,
    ['Убедительной схемы обязательных сочетаний для здоровых людей нет. Высокие количества могут иметь нежелательные эффекты; профилактический приём не обоснован.', 'There is no convincing required-combination regimen for healthy people. High amounts can have adverse effects; routine preventive use is unsupported.'], noComplex, [ods('Molybdenum')]),
  profile('selenium', ['Селен', 'Selenium'], 'RDA', 'mcg', [intake(55)],
    ['Содержание в растениях и бразильских орехах зависит от почвы; каждый орех не содержит одинаковую дозу.', 'Plant and Brazil-nut content depends on soil; individual nuts do not contain identical doses.'],
    ['Распространённые пищевые и добавочные формы хорошо усваиваются; лучшее усвоение не доказывает дополнительную пользу без дефицита.', 'Common food and supplement forms are well absorbed; better absorption does not prove extra benefit without deficiency.'], noRoutine,
    ['Избыток вызывает селеноз. Не складывайте несколько комплексов и большие порции богатых источников, считая их безусловно полезными.', 'Excess causes selenosis. Do not assume that stacking products and large portions of rich sources is always beneficial.'], noComplex, [ods('Selenium')]),
  profile('zinc', ['Цинк', 'Zinc'], 'RDA', 'mg', [intake(11, 8)],
    ['Анализ крови оценивают вместе с питанием, симптомами и клинической ситуацией; он не является единственным критерием.', 'Blood testing is interpreted with diet, symptoms and clinical context; it is not the sole criterion.'],
    ['Фитаты растительной пищи уменьшают усвоение. Универсальное преимущество одной формы для каждого человека не установлено.', 'Plant-food phytates reduce absorption. Universal superiority of one form for everyone is not established.'], noRoutine,
    ['Высокие дозы цинка снижают усвоение меди; большие дозы железа в добавках могут снижать усвоение цинка. Обычный пищевой магний не запрещён.', 'High zinc doses reduce copper absorption; large supplemental iron doses can reduce zinc absorption. Ordinary dietary magnesium is not prohibited.'], noComplex, [ods('Zinc')]),
];

export function mineralIntake(id: string, age: number): MineralIntake | null {
  if (!Number.isInteger(age) || age < 19) return null;
  return MINERAL_PROFILES.find(item => item.id === id)?.intakes.find(row => age >= row.minAge && (row.maxAge === null || age <= row.maxAge)) ?? null;
}

const extraIds = new Set(['sodium', 'chloride', 'chromium', 'fluoride', 'manganese', 'molybdenum']);
const extraRoles: Record<string, ReferenceText> = {
  sodium: ['Основной внеклеточный катион; участвует в водном балансе, нервной передаче и работе мышц.', 'The main extracellular cation; supports fluid balance, nerve transmission and muscle function.'],
  chloride: ['Основной внеклеточный анион; участвует в водном и кислотно-основном балансе, входит в состав желудочного сока.', 'The main extracellular anion; supports fluid and acid-base balance and is a component of gastric juice.'],
  chromium: ['Трёхвалентный хром изучается в связи с действием инсулина. Его незаменимость для человека остаётся спорной; токсичный шестивалентный хром сюда не относится.', 'Trivalent chromium is studied in relation to insulin action. Its essentiality in humans remains disputed; toxic hexavalent chromium is not included.'],
  fluoride: ['Ион фтора, участвующий в защите зубов от кариеса. Пищевое поступление и местные стоматологические средства оценивают раздельно.', 'The ionic form of fluorine, involved in protecting teeth against caries. Dietary intake and topical dental products are assessed separately.'],
  manganese: ['Кофактор ферментов, участвующих в обмене веществ, формировании костей и антиоксидантной защите.', 'A cofactor for enzymes involved in metabolism, bone formation and antioxidant defense.'],
  molybdenum: ['Компонент молибденового кофактора ферментов, участвующих в обмене серосодержащих соединений и пуринов.', 'A component of the molybdenum enzyme cofactor involved in sulfur-compound and purine metabolism.'],
};
export const ADDITIONAL_MINERAL_REFERENCES: SupplementReference[] = MINERAL_PROFILES.filter(item => extraIds.has(item.id)).map(item => ({
  id: item.id, name: item.name, path: ['Минералы', ['sodium', 'chloride'].includes(item.id) ? 'Макроэлементы' : 'Микроэлементы'],
  substance: extraRoles[item.id], evidence: item.supplementation, limits: item.note, cautions: item.interactions,
  sources: item.sources, reviewedAt: '2026-10-25',
}));
