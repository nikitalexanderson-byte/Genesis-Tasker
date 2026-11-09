import type { SupplementReference } from './supplement-reference-data.ts';
const ods = (slug: string) => `https://ods.od.nih.gov/factsheets/${slug}-HealthProfessional/`;
/** Catalogs identify substances; independent references support the health descriptions. */
export const CATALOG_SUPPLEMENT_REFERENCES: SupplementReference[] = [
  {
    id: 'pyridoxal-5-phosphate', name: ['P-5-P — пиридоксаль-5-фосфат', 'P-5-P — pyridoxal-5-phosphate'], path: ['Витамины', 'Водорастворимые'],
    substance: ['Коферментная форма витамина B6; входит в общий учёт B6.', 'A coenzyme form of vitamin B6, counted toward total B6 intake.'],
    evidence: ['Коррекция недостаточной обеспеченности B6 по показаниям.', 'Correction of inadequate B6 status when indicated.'],
    limits: ['Не доказано универсальное преимущество перед другими формами B6 или улучшение памяти у обеспеченных людей.', 'Universal superiority over other B6 forms or memory benefits in adequately nourished people are not established.'],
    cautions: ['Избыток B6 может повреждать периферические нервы. Учитывайте все комплексы и лекарства; активная форма не отменяет риска.', 'Excess B6 can damage peripheral nerves. Count all products and medicines; an active form does not remove this risk.'],
    sources: [ods('VitaminB6')], reviewedAt: '2026-10-25',
  },
  {
    id: 'choline-bitartrate', name: ['Холин — битартрат', 'Choline bitartrate'], path: ['Витамины', 'Витаминоподобные'],
    substance: ['Источник холина — необходимого нутриента для мембран и транспорта липидов.', 'A source of choline, an essential nutrient for membranes and lipid transport.'],
    evidence: ['Помогает обеспечить потребность при недостаточном поступлении; дефицит может повреждать печень и мышцы.', 'Can help meet requirements when intake is inadequate; deficiency can damage the liver and muscles.'],
    limits: ['Улучшение интеллекта или памяти добавками у здоровых взрослых убедительно не показано. Масса соли не равна массе холина.', 'Supplements have not convincingly improved cognition in healthy adults. Salt mass is not choline mass.'],
    cautions: ['Избыток вызывает рыбный запах, потливость, снижение давления и другие нежелательные эффекты.', 'Excess can cause fishy odor, sweating, low blood pressure and other adverse effects.'],
    sources: [ods('Choline')], reviewedAt: '2026-10-25',
  },
  {
    id: 'st-johns-wort', name: ['Зверобой — стандартизированный экстракт', 'St. John’s wort — standardized extract'], path: ['Разгон мозга', 'Настроение'],
    substance: ['Экстракт Hypericum perforatum; состав зависит от стандартизации.', 'Hypericum perforatum extract; composition depends on standardization.'],
    evidence: ['Есть клинические данные для некоторых стандартизированных экстрактов при лёгкой и умеренной депрессии; применение требует медицинской оценки.', 'Clinical evidence supports some standardized extracts for mild or moderate depression; use requires clinical assessment.'],
    limits: ['Результаты нельзя переносить на любой порошок, здоровых людей, тяжёлую депрессию или длительное применение.', 'Results cannot be generalized to every powder, healthy people, severe depression or long-term use.'],
    cautions: ['Много серьёзных взаимодействий, включая антидепрессанты, контрацептивы, варфарин и иммунодепрессанты. Возможны фоточувствительность и мания; не сочетать самостоятельно.', 'Many serious interactions include antidepressants, contraceptives, warfarin and immunosuppressants. Photosensitivity and mania can occur; do not self-combine.'],
    sources: ['https://www.nccih.nih.gov/health/st-johns-wort'], reviewedAt: '2026-10-25',
  },
  {
    id: 'melatonin', name: ['Мелатонин', 'Melatonin'], path: ['Здоровый сон', 'Циркадные ритмы'],
    substance: ['Гормон, участвующий в регуляции суточных ритмов.', 'A hormone involved in circadian timing.'],
    evidence: ['Может уменьшать симптомы джетлага и помогать при задержке фазы сна; важны показание и время применения.', 'Can reduce jet-lag symptoms and help delayed sleep phase; indication and timing matter.'],
    limits: ['Эффект не универсален для любой бессонницы. Безопасность длительного приёма изучена недостаточно.', 'Benefits are not universal across insomnia. Long-term safety is insufficiently established.'],
    cautions: ['Возможны сонливость, головная боль и головокружение. Детям, при беременности, эпилепсии и приёме антикоагулянтов нужна отдельная медицинская оценка.', 'Drowsiness, headache and dizziness can occur. Children, pregnancy, epilepsy and anticoagulants require individual clinical review.'],
    sources: ['https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know'], reviewedAt: '2026-10-25',
  },
  {
    id: 'beta-alanine', name: ['Бета-аланин', 'Beta-alanine'], path: ['Спортивное питание', 'Высокоинтенсивная работа'],
    substance: ['Аминокислота — предшественник мышечного карнозина.', 'An amino acid precursor of muscle carnosine.'],
    evidence: ['Повышает карнозин; в некоторых протоколах интенсивной работы длительностью несколько минут даёт небольшой прирост работоспособности.', 'Raises carnosine; some protocols of intense effort lasting several minutes show small performance benefits.'],
    limits: ['Результаты неоднородны; рост мышц, максимальной силы и длительной выносливости не гарантирован. Это не мгновенный стимулятор.', 'Results vary; muscle growth, maximal strength and prolonged endurance are not guaranteed. It is not an immediate stimulant.'],
    cautions: ['Характерны покалывание и зуд. Данных о длительной безопасности недостаточно; оценка спортивной задачи важнее рекламной смеси.', 'Tingling and itching are characteristic. Long-term safety data are limited; assess the sporting task rather than blend marketing.'],
    sources: [ods('ExerciseAndAthleticPerformance')], reviewedAt: '2026-10-25',
  },
];
