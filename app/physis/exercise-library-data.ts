import { EXPANDED_EXERCISE_GUIDES } from './exercise-expansion-data.ts';
import { UPPER_BODY_EXERCISE_GUIDES } from './exercise-upper-body-data.ts';

export type ExerciseGuide = {
  id: string; name: string; nameEn: string; muscles: string; movement: string;
  equipment: string; weightMode: 'total' | 'per-hand' | 'per-side' | 'bodyweight' | 'assisted';
  primary: string[]; steps: string[]; stepsEn: string[]; mistakes: string; mistakesEn: string;
  metric: 'strength' | 'time' | 'distance'; unilateral: boolean;
  aliases?: string[]; benchAngleDegrees?: number;
  purpose?: string; purposeEn?: string; sources?: string[];
};
export const EXERCISE_GUIDES: ExerciseGuide[] = [
  {
    "id": "squat",
    "name": "Приседание со штангой на плечах",
    "nameEn": "Barbell back squat",
    "muscles": "legs",
    "movement": "squat",
    "equipment": "barbell",
    "weightMode": "total",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Поставьте гриф на верх спины, устойчиво расположите стопы.",
      "Сгибайте таз и колени вместе; колени направляйте по линии носков.",
      "Поднимитесь через всю стопу, сохраняя управляемое положение корпуса."
    ],
    "stepsEn": [
      "Place the bar on your upper back and establish a stable stance.",
      "Bend hips and knees together while knees follow the toes.",
      "Stand through the whole foot while maintaining trunk control."
    ],
    "mistakes": "Отрыв пяток, сведение коленей и потеря контроля спины.",
    "mistakesEn": "Heels lifting, knees collapsing or loss of spinal control.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "hinge",
    "name": "Румынская тяга",
    "nameEn": "Romanian deadlift",
    "muscles": "posterior",
    "movement": "hinge",
    "equipment": "barbell",
    "weightMode": "total",
    "primary": [
      "hamstrings",
      "glutes"
    ],
    "steps": [
      "Держите гриф у бёдер, колени слегка согните.",
      "Отводите таз назад, ведите гриф близко к ногам, сохраняя спину нейтральной.",
      "Остановитесь в доступной амплитуде и разогните таз без отклонения назад."
    ],
    "stepsEn": [
      "Hold the bar near your thighs with softly bent knees.",
      "Hinge your hips back, keeping the bar close and the spine neutral.",
      "Reverse within your controlled range and stand without leaning back."
    ],
    "mistakes": "Округление поясницы, приседание вместо наклона, гриф далеко от тела.",
    "mistakesEn": "Rounding the back, turning the hinge into a squat or moving the bar away.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "press",
    "name": "Жим штанги лёжа",
    "nameEn": "Barbell bench press",
    "muscles": "chest",
    "movement": "push",
    "equipment": "barbell",
    "weightMode": "total",
    "primary": [
      "pectorals",
      "triceps",
      "front-delts"
    ],
    "steps": [
      "Упритесь стопами в пол, оставьте голову, лопатки и таз на скамье.",
      "Плавно опустите гриф к нижней-средней части груди, удерживая запястья над предплечьями.",
      "Выжмите гриф вверх без отскока; для тяжёлого веса используйте страховку."
    ],
    "stepsEn": [
      "Keep feet planted and head, shoulder blades and hips supported.",
      "Lower the bar toward the lower-middle chest with wrists stacked over forearms.",
      "Press without bouncing; use appropriate spotting for heavy loads."
    ],
    "mistakes": "Гриф к шее или лицу, отскок от груди, отрыв таза.",
    "mistakesEn": "Lowering toward the neck or face, bouncing or lifting the hips.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "row",
    "name": "Тяга гантели",
    "nameEn": "One-arm dumbbell row",
    "muscles": "back",
    "movement": "pull",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "lats",
      "mid-back",
      "biceps"
    ],
    "steps": [
      "Упритесь рукой и коленом в скамью, сохраните ровное положение корпуса.",
      "Подтяните гантель к тазу или нижним рёбрам, направляя локоть назад.",
      "Опустите вес под контролем, не разворачивая таз и плечи."
    ],
    "stepsEn": [
      "Support a hand and knee on the bench and hold the trunk steady.",
      "Row the dumbbell toward the hip or lower ribs, driving the elbow back.",
      "Lower with control without twisting the shoulders or hips."
    ],
    "mistakes": "Рывок, вращение корпуса, пожимание плечом.",
    "mistakesEn": "Jerking, trunk rotation or shrugging.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "pushup",
    "name": "Отжимание",
    "nameEn": "Push-up",
    "muscles": "chest",
    "movement": "push",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "pectorals",
      "triceps",
      "front-delts"
    ],
    "steps": [
      "Поставьте ладони под плечами или немного шире, вытяните корпус.",
      "Согните локти, опуская грудь к полу без провисания таза.",
      "Оттолкнитесь ладонями и вернитесь в прямое положение."
    ],
    "stepsEn": [
      "Place hands below or slightly wider than shoulders and brace the body.",
      "Lower the chest by bending elbows without sagging through the hips.",
      "Push through the hands to return to the start."
    ],
    "mistakes": "Провисание поясницы, локти резко в стороны, опускание одной головы.",
    "mistakesEn": "Sagging hips, excessive elbow flare or moving only the head.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "pullup",
    "name": "Подтягивание с противовесом",
    "nameEn": "Assisted pull-up",
    "muscles": "back",
    "movement": "pull",
    "equipment": "machine",
    "weightMode": "assisted",
    "primary": [
      "lats",
      "biceps"
    ],
    "steps": [
      "Настройте противовес и устойчиво встаньте коленями на опору.",
      "Подтягивайте корпус, направляя локти вниз и не раскачиваясь.",
      "Плавно опуститесь, сохраняя контроль плеч и опоры."
    ],
    "stepsEn": [
      "Set the assistance and position both knees securely on the pad.",
      "Pull upward by driving elbows down without swinging.",
      "Lower under control while maintaining shoulder and pad control."
    ],
    "mistakes": "Раскачивание, вытягивание шеи к перекладине, падение вниз.",
    "mistakesEn": "Swinging, craning the neck or dropping down.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "lunge",
    "name": "Выпад с гантелями",
    "nameEn": "Dumbbell forward lunge",
    "muscles": "legs",
    "movement": "lunge",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Держите гантели по бокам и сделайте устойчивый шаг вперёд.",
      "Согните оба колена, сохраняя всю переднюю стопу на полу.",
      "Оттолкнитесь передней ногой и вернитесь без удара задним коленом о пол."
    ],
    "stepsEn": [
      "Hold dumbbells at your sides and take a stable step forward.",
      "Bend both knees while keeping the whole front foot planted.",
      "Push through the front leg and return without hitting the rear knee."
    ],
    "mistakes": "Слишком узкая опора, завал колена внутрь, потеря равновесия.",
    "mistakesEn": "A tightrope stance, knee collapse or loss of balance.",
    "metric": "strength",
    "unilateral": true
  },
  {
    "id": "plank",
    "name": "Планка",
    "nameEn": "Forearm plank",
    "muscles": "core",
    "movement": "hold",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "abs",
      "obliques"
    ],
    "steps": [
      "Поставьте предплечья на пол, локти под плечами.",
      "Поднимите колени и удерживайте прямую линию корпуса, продолжая дышать.",
      "Завершите удержание, мягко вернув колени на пол."
    ],
    "stepsEn": [
      "Place forearms on the floor with elbows under shoulders.",
      "Lift the knees and hold a straight body line while breathing.",
      "Finish by gently lowering the knees."
    ],
    "mistakes": "Провисание поясницы, поднятый таз, задержка дыхания.",
    "mistakesEn": "Sagging back, raised hips or breath-holding.",
    "metric": "time",
    "unilateral": false
  },
  {
    "id": "run",
    "name": "Бег",
    "nameEn": "Running",
    "muscles": "whole",
    "movement": "locomotion",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "quads",
      "glutes",
      "calves"
    ],
    "steps": [
      "Выберите удобный темп и устойчивую поверхность.",
      "Ставьте стопу близко к проекции корпуса, двигайте руками свободно.",
      "Увеличивайте длительность и темп постепенно, учитывая восстановление."
    ],
    "stepsEn": [
      "Choose a comfortable pace and stable surface.",
      "Land near your body and let the arms swing naturally.",
      "Increase duration and pace gradually with adequate recovery."
    ],
    "mistakes": "Резкий рост объёма, чрезмерно длинный шаг, напряжённые плечи.",
    "mistakesEn": "Abrupt volume increases, overstriding or tense shoulders.",
    "metric": "distance",
    "unilateral": false
  },
  {
    "id": "walk",
    "name": "Ходьба",
    "nameEn": "Walking",
    "muscles": "whole",
    "movement": "locomotion",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "quads",
      "glutes",
      "calves"
    ],
    "steps": [
      "Выпрямитесь и выберите удобную длину шага.",
      "Переносите вес плавно, позволяя рукам двигаться навстречу ногам.",
      "Сохраняйте свободное дыхание и подходящий вам темп."
    ],
    "stepsEn": [
      "Stand tall and choose a comfortable step length.",
      "Transfer weight smoothly with a natural opposite arm swing.",
      "Maintain relaxed breathing and a suitable pace."
    ],
    "mistakes": "Неудобная обувь, чрезмерно длинный шаг, резкое увеличение дистанции.",
    "mistakesEn": "Unsuitable footwear, overstriding or abrupt distance increases.",
    "metric": "distance",
    "unilateral": false
  },
  {
    "id": "bodyweight-squat",
    "name": "Приседание без отягощения",
    "nameEn": "Bodyweight squat",
    "muscles": "legs",
    "movement": "squat",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Расположите стопы устойчиво, руки выведите вперёд для равновесия.",
      "Сгибайте колени и таз в доступной амплитуде без отрыва пяток.",
      "Поднимитесь через всю стопу, направляя колени по линии носков."
    ],
    "stepsEn": [
      "Stand steadily and extend arms forward for balance.",
      "Bend knees and hips through a controlled range with heels down.",
      "Stand through the whole foot while knees follow the toes."
    ],
    "mistakes": "Падение вниз, сведение коленей, потеря опоры стопы.",
    "mistakesEn": "Dropping quickly, knee collapse or loss of foot support.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "goblet-squat",
    "name": "Гоблет-приседание",
    "nameEn": "Goblet squat",
    "muscles": "legs",
    "movement": "squat",
    "equipment": "dumbbell",
    "weightMode": "total",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Держите одну гантель вертикально у груди двумя руками.",
      "Опуститесь между бёдер, не отрывая пятки и не отдаляя вес от корпуса.",
      "Поднимитесь, сохраняя устойчивые стопы и нейтральную спину."
    ],
    "stepsEn": [
      "Hold one dumbbell vertically close to the chest with both hands.",
      "Squat between your hips while keeping heels down and the load close.",
      "Stand with stable feet and a controlled neutral spine."
    ],
    "mistakes": "Гантель далеко от груди, отрыв пяток, потеря контроля поясницы.",
    "mistakesEn": "Holding the load away, lifting heels or losing spinal control.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "split-squat",
    "name": "Сплит-приседание с гантелями",
    "nameEn": "Dumbbell split squat",
    "muscles": "legs",
    "movement": "lunge",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Встаньте в устойчивую разножку; стопы остаются на месте.",
      "Опускайте таз вниз, сгибая оба колена без удара задним коленом о пол.",
      "Поднимитесь через переднюю стопу, сохраняя равновесие."
    ],
    "stepsEn": [
      "Establish a stable split stance and keep the feet in place.",
      "Lower by bending both knees without hitting the floor.",
      "Rise through the front foot while maintaining balance."
    ],
    "mistakes": "Слишком узкая опора, наклон и вращение корпуса, завал колена.",
    "mistakesEn": "A tightrope stance, trunk rotation or knee collapse.",
    "metric": "strength",
    "unilateral": true
  },
  {
    "id": "stepup",
    "name": "Зашагивание с гантелями",
    "nameEn": "Dumbbell step-up",
    "muscles": "legs",
    "movement": "step",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Поставьте всю ведущую стопу на устойчивую невысокую платформу.",
      "Поднимитесь усилием ведущей ноги, без прыжка с нижней стопы.",
      "Выпрямитесь, затем вернитесь вниз под контролем."
    ],
    "stepsEn": [
      "Place the whole lead foot on a stable low platform.",
      "Step up using the lead leg rather than jumping from the floor.",
      "Stand tall, then lower with control."
    ],
    "mistakes": "Неустойчивая опора, сильный толчок нижней ногой, падение при спуске.",
    "mistakesEn": "An unstable platform, excessive rear-leg push or uncontrolled descent.",
    "metric": "strength",
    "unilateral": true
  },
  {
    "id": "glute-bridge",
    "name": "Ягодичный мост",
    "nameEn": "Glute bridge",
    "muscles": "posterior",
    "movement": "hinge",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "glutes",
      "hamstrings"
    ],
    "steps": [
      "Лягте на спину, согните колени, стопы поставьте устойчиво.",
      "Поднимите таз до линии плечи–таз–колени без переразгибания поясницы.",
      "Плавно опустите таз, сохраняя контроль корпуса."
    ],
    "stepsEn": [
      "Lie on your back with bent knees and stable feet.",
      "Lift the hips into a shoulder-hip-knee line without arching the lower back.",
      "Lower smoothly with trunk control."
    ],
    "mistakes": "Переразгибание поясницы, толчок шеей, отрыв пяток.",
    "mistakesEn": "Overarching, pushing through the neck or lifting heels.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "legpress",
    "name": "Жим ногами",
    "nameEn": "Leg press",
    "muscles": "legs",
    "movement": "squat",
    "equipment": "machine",
    "weightMode": "total",
    "primary": [
      "quads",
      "glutes"
    ],
    "steps": [
      "Настройте сиденье и полностью поставьте стопы на платформу.",
      "Сгибайте ноги в амплитуде, где таз и спина остаются на опоре.",
      "Разогните ноги без жёсткого замыкания коленей."
    ],
    "stepsEn": [
      "Adjust the seat and plant the whole feet on the platform.",
      "Bend within a range that keeps hips and back supported.",
      "Extend without forcefully locking the knees."
    ],
    "mistakes": "Отрыв таза, чрезмерная глубина и блокировка коленей.",
    "mistakesEn": "Hips lifting, excessive depth or forced knee lockout.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "legcurl",
    "name": "Сгибание ног лёжа",
    "nameEn": "Lying leg curl",
    "muscles": "posterior",
    "movement": "knee-flexion",
    "equipment": "machine",
    "weightMode": "total",
    "primary": [
      "hamstrings"
    ],
    "steps": [
      "Лягте лицом вниз, поддерживайте таз на скамье и держитесь за рукоятки. Совместите ось тренажёра с коленом.",
      "Расположите валик сзади голеней над пятками. Сгибайте колени без отрыва таза.",
      "Медленно верните ноги, не бросая отягощение."
    ],
    "stepsEn": [
      "Lie face down with the hips supported and hold the handles. Align the machine axis with the knees.",
      "Place the roller behind the lower legs above the heels. Bend the knees without lifting the hips.",
      "Return slowly without letting the weight drop."
    ],
    "mistakes": "Отрыв таза, рывок, неверная настройка оси и валиков.",
    "mistakesEn": "Hips lifting, jerking or incorrect machine alignment.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "legextension",
    "name": "Разгибание ног сидя",
    "nameEn": "Seated leg extension",
    "muscles": "legs",
    "movement": "knee-extension",
    "equipment": "machine",
    "weightMode": "total",
    "primary": [
      "quads"
    ],
    "steps": [
      "Совместите ось тренажёра с коленом, валик расположите над голеностопом.",
      "Плавно разогните колени в комфортной амплитуде.",
      "Медленно вернитесь, оставляя таз и спину на опоре."
    ],
    "stepsEn": [
      "Align the machine axis with the knee and place the roller above the ankle.",
      "Extend the knees smoothly within a comfortable range.",
      "Return slowly while keeping hips and back supported."
    ],
    "mistakes": "Рывок, отрыв таза, неудобная настройка валика.",
    "mistakesEn": "Jerking, hips lifting or unsuitable roller placement.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "calfraise",
    "name": "Подъём на носки стоя",
    "nameEn": "Standing calf raise",
    "muscles": "calves",
    "movement": "plantar-flexion",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "calves"
    ],
    "steps": [
      "Встаньте устойчиво, при необходимости слегка придерживайтесь за опору.",
      "Поднимите пятки, сохраняя стопы направленными вперёд и колени мягкими.",
      "Опуститесь под контролем без пружинящих движений."
    ],
    "stepsEn": [
      "Stand steadily and lightly hold a support if needed.",
      "Lift the heels with soft knees and feet pointing forward.",
      "Lower under control without bouncing."
    ],
    "mistakes": "Раскачивание, рывки, завал стопы наружу.",
    "mistakesEn": "Swaying, jerking or rolling onto the outside of the feet.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "deadlift",
    "name": "Становая тяга",
    "nameEn": "Barbell deadlift",
    "muscles": "posterior",
    "movement": "hinge",
    "equipment": "barbell",
    "weightMode": "total",
    "primary": [
      "glutes",
      "quads",
      "hamstrings"
    ],
    "steps": [
      "Расположите гриф над серединой стопы и возьмитесь за него вне коленей.",
      "Напрягите корпус и поднимайте вес разгибанием ног и таза, ведя гриф близко к телу.",
      "Завершите подъём стоя и верните вес через управляемый наклон и сгибание коленей."
    ],
    "stepsEn": [
      "Set the bar over the midfoot and grip outside the knees.",
      "Brace and lift through the legs and hips with the bar close.",
      "Finish standing, then lower using a controlled hinge and knee bend."
    ],
    "mistakes": "Рывок с пола, округление спины, отклонение назад вверху.",
    "mistakesEn": "Jerking from the floor, rounding or leaning back at the top.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "dumbbell-bench",
    "name": "Жим гантелей лёжа",
    "nameEn": "Dumbbell bench press",
    "muscles": "chest",
    "movement": "push",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "pectorals",
      "triceps",
      "front-delts"
    ],
    "steps": [
      "Расположитесь устойчиво на скамье, держите гантели над грудью.",
      "Опустите веса по сторонам груди, сохраняя запястья над локтями.",
      "Выжмите вверх без удара гантелей и отрыва таза."
    ],
    "stepsEn": [
      "Set up steadily and hold the dumbbells above the chest.",
      "Lower beside the chest with wrists stacked over elbows.",
      "Press up without colliding the weights or lifting the hips."
    ],
    "mistakes": "Слишком широкие локти, нестабильные запястья, отрыв таза.",
    "mistakesEn": "Excessive elbow flare, unstable wrists or hips lifting.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "incline-bench",
    "benchAngleDegrees": 30,
    "name": "Жим гантелей на наклонной скамье",
    "nameEn": "Incline dumbbell press",
    "muscles": "chest",
    "movement": "push",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "pectorals",
      "front-delts",
      "triceps"
    ],
    "steps": [
      "Установите умеренный наклон скамьи и устойчиво поставьте стопы.",
      "Опустите гантели по сторонам верхней части груди, не теряя опору спины.",
      "Выжмите веса вверх под контролем без чрезмерного прогиба."
    ],
    "stepsEn": [
      "Set a moderate bench incline and plant the feet.",
      "Lower the dumbbells beside the upper chest while keeping back support.",
      "Press with control without excessive arching."
    ],
    "mistakes": "Слишком высокий наклон, отрыв таза, потеря контроля плеч.",
    "mistakesEn": "Excessive bench incline, hips lifting or loss of shoulder control.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "shoulderpress",
    "name": "Жим гантелей сидя",
    "nameEn": "Seated dumbbell shoulder press",
    "muscles": "shoulders",
    "movement": "push",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "front-delts",
      "side-delts",
      "triceps"
    ],
    "steps": [
      "Сядьте с опорой спины, расположите гантели на уровне плеч.",
      "Выжмите веса вверх в удобной плоскости, не прогибая поясницу.",
      "Плавно опустите их обратно к плечам."
    ],
    "stepsEn": [
      "Sit with back support and dumbbells near shoulder level.",
      "Press upward in a comfortable plane without arching the lower back.",
      "Lower smoothly to the shoulders."
    ],
    "mistakes": "Избыточный прогиб, удар гантелей, потеря опоры стоп.",
    "mistakesEn": "Excessive arching, colliding dumbbells or unstable feet.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "lateralraise",
    "name": "Подъём гантелей в стороны",
    "nameEn": "Dumbbell lateral raise",
    "muscles": "shoulders",
    "movement": "abduction",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "side-delts"
    ],
    "steps": [
      "Встаньте устойчиво, локти слегка согните, плечи расслабьте.",
      "Поднимите руки в стороны примерно до уровня плеч в комфортной плоскости.",
      "Опустите гантели медленно, не раскачивая корпус."
    ],
    "stepsEn": [
      "Stand steadily with softly bent elbows and relaxed shoulders.",
      "Raise the arms to about shoulder level in a comfortable plane.",
      "Lower slowly without swinging the trunk."
    ],
    "mistakes": "Мах корпусом, пожимание плечами, принудительное выворачивание кистей вниз.",
    "mistakesEn": "Swinging, shrugging or forcefully turning the wrists downward.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "rear-delt-fly",
    "name": "Разведение гантелей в наклоне",
    "nameEn": "Bent-over reverse fly",
    "muscles": "shoulders",
    "movement": "horizontal-abduction",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "rear-delts",
      "mid-back"
    ],
    "steps": [
      "Наклонитесь через таз и удерживайте корпус устойчиво.",
      "Разведите слегка согнутые руки в стороны без рывка и подъёма плеч к ушам.",
      "Верните гантели под контролем, сохраняя положение спины."
    ],
    "stepsEn": [
      "Hinge at the hips and hold the trunk steady.",
      "Open softly bent arms to the sides without jerking or shrugging.",
      "Return under control while maintaining the spine position."
    ],
    "mistakes": "Рывок, разгибание корпуса вместо движения рук, пожимание плечами.",
    "mistakesEn": "Jerking, lifting the trunk or shrugging.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "latpulldown",
    "name": "Тяга верхнего блока",
    "nameEn": "Lat pulldown",
    "muscles": "back",
    "movement": "pull",
    "equipment": "cable",
    "weightMode": "total",
    "primary": [
      "lats",
      "biceps"
    ],
    "steps": [
      "Зафиксируйте бёдра под опорой и возьмитесь за рукоять удобным хватом.",
      "Тяните рукоять к верхней части груди, направляя локти вниз.",
      "Верните вес вверх плавно без рывка и раскачивания."
    ],
    "stepsEn": [
      "Secure the thighs and take a comfortable grip.",
      "Pull the handle toward the upper chest, driving elbows down.",
      "Return smoothly without swinging or letting the weight drop."
    ],
    "mistakes": "Тяга за голову, сильное отклонение назад, падение веса.",
    "mistakesEn": "Pulling behind the neck, excessive backward lean or dropping the weight.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "seatedrow",
    "name": "Тяга горизонтального блока",
    "nameEn": "Seated cable row",
    "muscles": "back",
    "movement": "pull",
    "equipment": "cable",
    "weightMode": "total",
    "primary": [
      "lats",
      "mid-back",
      "biceps"
    ],
    "steps": [
      "Сядьте устойчиво, колени слегка согните, удерживайте нейтральную спину.",
      "Подтяните рукоять к нижним рёбрам, двигая локти назад.",
      "Выпрямите руки под контролем без округления поясницы."
    ],
    "stepsEn": [
      "Sit steadily with soft knees and a neutral spine.",
      "Row toward the lower ribs by driving the elbows back.",
      "Extend the arms with control without rounding the lower back."
    ],
    "mistakes": "Раскачивание корпусом, пожимание плечами, рывок поясницей.",
    "mistakesEn": "Rocking the trunk, shrugging or jerking through the lower back.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "bicepscurl",
    "name": "Сгибание рук с гантелями",
    "nameEn": "Dumbbell biceps curl",
    "muscles": "arms",
    "movement": "elbow-flexion",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "biceps"
    ],
    "steps": [
      "Держите гантели по бокам, локти рядом с корпусом.",
      "Согните руки, не раскачивая корпус и не уводя плечи вперёд.",
      "Медленно опустите гантели в исходное положение."
    ],
    "stepsEn": [
      "Hold the dumbbells at your sides with elbows near the trunk.",
      "Curl without swinging or pushing the shoulders forward.",
      "Lower slowly to the start."
    ],
    "mistakes": "Мах корпусом, движение локтей вперёд, резкое опускание веса.",
    "mistakesEn": "Swinging, moving elbows forward or dropping the weights.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "hammercurl",
    "name": "Молотковые сгибания",
    "nameEn": "Dumbbell hammer curl",
    "muscles": "arms",
    "movement": "elbow-flexion",
    "equipment": "dumbbell",
    "weightMode": "per-hand",
    "primary": [
      "brachialis",
      "biceps",
      "forearms"
    ],
    "steps": [
      "Держите гантели нейтральным хватом: ладони направлены к корпусу.",
      "Согните локти, сохраняя положение кистей и плеч.",
      "Опустите веса медленно, не отклоняя корпус назад."
    ],
    "stepsEn": [
      "Use a neutral grip with palms facing the body.",
      "Bend the elbows while keeping wrists and shoulders steady.",
      "Lower slowly without leaning backward."
    ],
    "mistakes": "Раскачивание, залом запястий, подъём плеч.",
    "mistakesEn": "Swinging, bending the wrists or shrugging.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "tricepspushdown",
    "name": "Разгибание рук на блоке",
    "nameEn": "Cable triceps pushdown",
    "muscles": "arms",
    "movement": "elbow-extension",
    "equipment": "cable",
    "weightMode": "total",
    "primary": [
      "triceps"
    ],
    "steps": [
      "Встаньте устойчиво у блока, локти держите рядом с корпусом.",
      "Разогните локти, опуская рукоять без движения плеч и корпуса.",
      "Верните предплечья вверх под контролем."
    ],
    "stepsEn": [
      "Stand steadily at the cable with elbows near the trunk.",
      "Extend the elbows without moving the shoulders or trunk.",
      "Return the forearms upward under control."
    ],
    "mistakes": "Давление всем корпусом, разведение локтей, рывок плечами.",
    "mistakesEn": "Pressing with the whole body, flared elbows or shoulder jerks.",
    "metric": "strength",
    "unilateral": false
  },
  {
    "id": "deadbug",
    "name": "Мёртвый жук",
    "nameEn": "Dead bug",
    "muscles": "core",
    "movement": "brace",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "abs",
      "obliques"
    ],
    "steps": [
      "Лягте на спину, поднимите руки и согнутые ноги над корпусом.",
      "Медленно отведите противоположные руку и ногу, сохраняя контроль поясницы.",
      "Вернитесь и повторите другой стороной, продолжая дышать."
    ],
    "stepsEn": [
      "Lie on your back with raised arms and bent legs.",
      "Slowly reach an opposite arm and leg away while controlling the lower back.",
      "Return and alternate sides while breathing."
    ],
    "mistakes": "Потеря контроля поясницы, быстрые махи, слишком большая амплитуда.",
    "mistakesEn": "Losing spinal control, swinging or using excessive range.",
    "metric": "strength",
    "unilateral": true
  },
  {
    "id": "birddog",
    "name": "Птица-собака",
    "nameEn": "Bird dog",
    "muscles": "core",
    "movement": "brace",
    "equipment": "bodyweight",
    "weightMode": "bodyweight",
    "primary": [
      "abs",
      "obliques",
      "glutes",
      "erectors"
    ],
    "steps": [
      "Встаньте на четвереньки: кисти под плечами, колени под тазом.",
      "Вытяните противоположные руку и ногу примерно до линии корпуса без вращения таза.",
      "Вернитесь плавно и смените сторону."
    ],
    "stepsEn": [
      "Start on hands and knees, hands below shoulders and knees below hips.",
      "Reach opposite arm and leg into the body line without rotating the pelvis.",
      "Return smoothly and alternate sides."
    ],
    "mistakes": "Переразгибание поясницы, разворот таза, слишком высокий подъём ноги.",
    "mistakesEn": "Overarching, rotating the hips or lifting the leg too high.",
    "metric": "strength",
    "unilateral": true
  },
  ...EXPANDED_EXERCISE_GUIDES,
  ...UPPER_BODY_EXERCISE_GUIDES
];
