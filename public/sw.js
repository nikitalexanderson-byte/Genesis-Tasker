const SCOPE = self.registration.scope;
importScripts(new URL("./habit-reminder-worker.js", SCOPE).href);
importScripts(new URL("./advice-notification-worker.js", SCOPE).href);
const ASSETS_PATH = new URL("./assets/", SCOPE).pathname;
try {
  importScripts(new URL("./precache-manifest.js", SCOPE).href);
} catch {
  self.__GENESIS_PRECACHE_VERSION = "fallback";
  self.__GENESIS_PRECACHE = [];
}
const CACHE_PREFIX = "genesis-shell-";
const CACHE_VERSION = typeof self.__GENESIS_PRECACHE_VERSION === "string" ? self.__GENESIS_PRECACHE_VERSION : "fallback";
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const PRECACHE = Array.isArray(self.__GENESIS_PRECACHE) ? self.__GENESIS_PRECACHE : [];
const MONTH_ART = Array.from({ length: 13 }, (_, index) => `./month-art-v4/month-${String(index + 1).padStart(2, "0")}.webp`);
const LUNAR_MONTH_ART = [
  "./lunar-month-art-v1/month-01.webp",
  "./lunar-month-art-v1/month-02.webp",
  "./lunar-month-art-v1/month-03.webp",
  "./lunar-month-art-v1/month-04.webp",
  "./lunar-month-art-v1/month-05.webp",
  "./lunar-month-art-v1/month-06.webp",
  "./lunar-month-art-v1/month-07.webp",
  "./lunar-month-art-v1/month-08.webp",
  "./lunar-month-art-v1/month-09.webp",
  "./lunar-month-art-v1/month-10.webp",
  "./lunar-month-art-v1/month-11.webp",
  "./lunar-month-art-v1/month-12.webp",
  "./lunar-month-art-v1/month-13.webp",
];
const WEEKDAY_ART = [
  "./weekday-art/lunar-artemis-v326.webp",
  "./weekday-art/lunar-selene-v326.webp",
  "./weekday-art/lunar-hecate-v326.webp",
  "./weekday-art/weekday-0-sunday-apollo.webp",
  "./weekday-art/weekday-1-monday-lunar-goddesses.webp",
  "./weekday-art/weekday-2-tuesday-ares.webp",
  "./weekday-art/weekday-3-wednesday-hermes.webp",
  "./weekday-art/weekday-4-thursday-zeus-hera.webp",
  "./weekday-art/weekday-5-friday-aphrodite-hestia-dionysus.webp",
  "./weekday-art/weekday-6-saturday-cronus.webp",
];
const ACHIEVEMENT_ART = [
  "./achievement-art/first-step.png",
  "./achievement-art/three-day-rhythm.png",
  "./achievement-art/seven-sunrises.png",
  "./achievement-art/fortnight-rhythm.png",
  "./achievement-art/perfect-day.png",
  "./achievement-art/habit-thirty.png",
  "./achievement-art/century.png",
  "./achievement-art/iron-rhythm.png",
  "./achievement-art/fifty-sunrises.png",
  "./achievement-art/hundred-day-path.png",
  "./achievement-art/perfect-week.png",
  "./achievement-art/perfect-month.png",
  "./achievement-art/half-year-circle.png",
  "./achievement-art/full-revolution.png",
  "./achievement-art/five-hundred-sunrises.png",
  "./achievement-art/thousand-day-path.png",
  "./achievement-art/comeback.png",
  "./achievement-art/consistency.png",
];
const HABIT_REWARD_ART = [
  "./habit-reward-art/hestia-spark.png",
  "./habit-reward-art/comeback.png",
];
const PHYSIS_EXERCISE_ART = [
  "./physis-art/exercises/nordic-curl-human-v2.webp",
  "./physis-art/exercises/nordic-curl-poster-human-v2.webp",
  "./physis-art/exercises/sissy-machine-squat-human-v2.webp",
  "./physis-art/exercises/sissy-machine-squat-poster-human-v2.webp",
  "./physis-art/exercises/sumo-deadlift-human-v2.webp",
  "./physis-art/exercises/sumo-deadlift-poster-human-v2.webp",
  "./physis-art/exercises/single-leg-rdl-one-dumbbell-human-v2.webp",
  "./physis-art/exercises/single-leg-rdl-one-dumbbell-poster-human-v2.webp",
  "./physis-art/exercises/back-extension-human-v2.webp",
  "./physis-art/exercises/back-extension-poster-human-v2.webp",
  "./physis-art/exercises/reverse-hyper-machine-human-v2.webp",
  "./physis-art/exercises/reverse-hyper-machine-poster-human-v2.webp",
  "./physis-art/exercises/reverse-hyper-plate-human-v1.webp",
  "./physis-art/exercises/reverse-hyper-plate-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-kettlebell-human-v2.webp",
  "./physis-art/exercises/standing-calf-kettlebell-poster-human-v2.webp",
  "./physis-art/exercises/standing-calf-smith-human-v1.webp",
  "./physis-art/exercises/standing-calf-smith-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-machine-human-v2.webp",
  "./physis-art/exercises/standing-calf-machine-poster-human-v2.webp",
  "./physis-art/exercises/seated-calf-barbell-human-v2.webp",
  "./physis-art/exercises/seated-calf-barbell-poster-human-v2.webp",
  "./physis-art/exercises/smith-squat-human-v2.webp",
  "./physis-art/exercises/smith-squat-poster-human-v2.webp",
  "./physis-art/exercises/pullover-plate-human-v2.webp",
  "./physis-art/exercises/pullover-plate-poster-human-v2.webp",
  "./physis-art/exercises/pec-deck-human-v2.webp",
  "./physis-art/exercises/pec-deck-poster-human-v2.webp",
  "./physis-art/exercises/crossover-low-human-v2.webp",
  "./physis-art/exercises/crossover-low-poster-human-v2.webp",
  "./physis-art/exercises/stepup-human-v2.webp",
  "./physis-art/exercises/stepup-poster-human-v2.webp",
  "./physis-art/exercises/cossack-dumbbells-human-v1.webp",
  "./physis-art/exercises/cossack-dumbbells-poster-human-v1.webp",
  "./physis-art/exercises/cossack-barbell-human-v1.webp",
  "./physis-art/exercises/cossack-barbell-poster-human-v1.webp",
  "./physis-art/exercises/cossack-landmine-human-v1.webp",
  "./physis-art/exercises/cossack-landmine-poster-human-v1.webp",
  "./physis-art/exercises/hip-thrust-human-v1.webp",
  "./physis-art/exercises/hip-thrust-poster-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-poster-human-v1.webp",
  "./physis-art/exercises/lateral-lunge-human-v1.webp",
  "./physis-art/exercises/lateral-lunge-poster-human-v1.webp",
  "./physis-art/exercises/single-leg-rdl-human-v1.webp",
  "./physis-art/exercises/single-leg-rdl-poster-human-v1.webp",
  "./physis-art/exercises/front-squat-human-v1.webp",
  "./physis-art/exercises/front-squat-poster-human-v1.webp",
  "./physis-art/exercises/plie-squat-human-v1.webp",
  "./physis-art/exercises/plie-squat-poster-human-v1.webp",
  "./physis-art/exercises/overhead-squat-human-v1.webp",
  "./physis-art/exercises/overhead-squat-poster-human-v1.webp",
  "./physis-art/exercises/smith-squat-human-v1.webp",
  "./physis-art/exercises/smith-squat-poster-human-v1.webp",
  "./physis-art/exercises/kettlebell-goblet-squat-human-v1.webp",
  "./physis-art/exercises/kettlebell-goblet-squat-poster-human-v1.webp",
  "./physis-art/exercises/sandbag-front-squat-human-v1.webp",
  "./physis-art/exercises/sandbag-front-squat-poster-human-v1.webp",
  "./physis-art/exercises/walking-lunge-bodyweight-human-v1.webp",
  "./physis-art/exercises/walking-lunge-bodyweight-poster-human-v1.webp",
  "./physis-art/exercises/walking-lunge-dumbbell-human-v1.webp",
  "./physis-art/exercises/walking-lunge-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/walking-lunge-barbell-human-v1.webp",
  "./physis-art/exercises/walking-lunge-barbell-poster-human-v1.webp",
  "./physis-art/exercises/walking-lunge-kettlebell-human-v1.webp",
  "./physis-art/exercises/walking-lunge-kettlebell-poster-human-v1.webp",
  "./physis-art/exercises/walking-lunge-sandbag-human-v1.webp",
  "./physis-art/exercises/walking-lunge-sandbag-poster-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-bodyweight-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-bodyweight-poster-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-barbell-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-barbell-poster-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-kettlebell-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-kettlebell-poster-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-sandbag-human-v1.webp",
  "./physis-art/exercises/reverse-lunge-sandbag-poster-human-v1.webp",
  "./physis-art/exercises/bulgarian-split-squat-human-v1.webp",
  "./physis-art/exercises/bulgarian-split-squat-poster-human-v1.webp",
  "./physis-art/exercises/bulgarian-split-squat-bodyweight-human-v1.webp",
  "./physis-art/exercises/bulgarian-split-squat-bodyweight-poster-human-v1.webp",
  "./physis-art/exercises/sumo-deadlift-human-v1.webp",
  "./physis-art/exercises/sumo-deadlift-poster-human-v1.webp",
  "./physis-art/exercises/dowel-hinge-human-v1.webp",
  "./physis-art/exercises/dowel-hinge-poster-human-v1.webp",
  "./physis-art/exercises/single-leg-rdl-one-dumbbell-human-v1.webp",
  "./physis-art/exercises/single-leg-rdl-one-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/cossack-squat-human-v1.webp",
  "./physis-art/exercises/cossack-squat-poster-human-v1.webp",
  "./physis-art/exercises/jump-squat-human-v1.webp",
  "./physis-art/exercises/jump-squat-poster-human-v1.webp",
  "./physis-art/exercises/sissy-squat-human-v1.webp",
  "./physis-art/exercises/sissy-squat-poster-human-v1.webp",
  "./physis-art/exercises/sissy-machine-squat-human-v1.webp",
  "./physis-art/exercises/sissy-machine-squat-poster-human-v1.webp",
  "./physis-art/exercises/smith-hack-squat-human-v1.webp",
  "./physis-art/exercises/smith-hack-squat-poster-human-v1.webp",
  "./physis-art/exercises/hack-squat-machine-human-v1.webp",
  "./physis-art/exercises/hack-squat-machine-poster-human-v1.webp",
  "./physis-art/exercises/good-morning-barbell-human-v1.webp",
  "./physis-art/exercises/good-morning-barbell-poster-human-v1.webp",
  "./physis-art/exercises/good-morning-dumbbell-human-v1.webp",
  "./physis-art/exercises/good-morning-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/good-morning-kettlebell-human-v1.webp",
  "./physis-art/exercises/good-morning-kettlebell-poster-human-v1.webp",
  "./physis-art/exercises/good-morning-sandbag-human-v1.webp",
  "./physis-art/exercises/good-morning-sandbag-poster-human-v1.webp",
  "./physis-art/exercises/back-extension-human-v1.webp",
  "./physis-art/exercises/back-extension-poster-human-v1.webp",
  "./physis-art/exercises/reverse-hyper-machine-human-v1.webp",
  "./physis-art/exercises/reverse-hyper-machine-poster-human-v1.webp",
  "./physis-art/exercises/reverse-hyper-ghd-human-v1.webp",
  "./physis-art/exercises/reverse-hyper-ghd-poster-human-v1.webp",
  "./physis-art/exercises/glute-ham-raise-human-v1.webp",
  "./physis-art/exercises/glute-ham-raise-poster-human-v1.webp",
  "./physis-art/exercises/nordic-curl-human-v1.webp",
  "./physis-art/exercises/nordic-curl-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-machine-human-v1.webp",
  "./physis-art/exercises/standing-calf-machine-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-dumbbell-human-v1.webp",
  "./physis-art/exercises/standing-calf-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-barbell-human-v1.webp",
  "./physis-art/exercises/standing-calf-barbell-poster-human-v1.webp",
  "./physis-art/exercises/standing-calf-kettlebell-human-v1.webp",
  "./physis-art/exercises/standing-calf-kettlebell-poster-human-v1.webp",
  "./physis-art/exercises/seated-calf-machine-human-v1.webp",
  "./physis-art/exercises/seated-calf-machine-poster-human-v1.webp",
  "./physis-art/exercises/seated-calf-dumbbell-human-v1.webp",
  "./physis-art/exercises/seated-calf-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/seated-calf-barbell-human-v1.webp",
  "./physis-art/exercises/seated-calf-barbell-poster-human-v1.webp",
  "./physis-art/exercises/floor-glute-bridge-barbell-human-v1.webp",
  "./physis-art/exercises/floor-glute-bridge-barbell-poster-human-v1.webp",
  "./physis-art/exercises/floor-glute-bridge-plate-human-v1.webp",
  "./physis-art/exercises/floor-glute-bridge-plate-poster-human-v1.webp",
  "./physis-art/exercises/pullup-bodyweight-human-v1.webp",
  "./physis-art/exercises/pullup-bodyweight-poster-human-v1.webp",
  "./physis-art/exercises/pullup-weighted-human-v1.webp",
  "./physis-art/exercises/pullup-weighted-poster-human-v1.webp",
  "./physis-art/exercises/pushup-weighted-human-v1.webp",
  "./physis-art/exercises/pushup-weighted-poster-human-v1.webp",
  "./physis-art/exercises/pushup-triceps-human-v1.webp",
  "./physis-art/exercises/pushup-triceps-poster-human-v1.webp",
  "./physis-art/exercises/incline-barbell-bench-human-v1.webp",
  "./physis-art/exercises/incline-barbell-bench-poster-human-v1.webp",
  "./physis-art/exercises/crossover-high-human-v1.webp",
  "./physis-art/exercises/crossover-high-poster-human-v1.webp",
  "./physis-art/exercises/crossover-low-human-v1.webp",
  "./physis-art/exercises/crossover-low-poster-human-v1.webp",
  "./physis-art/exercises/pec-deck-human-v1.webp",
  "./physis-art/exercises/pec-deck-poster-human-v1.webp",
  "./physis-art/exercises/dumbbell-fly-human-v1.webp",
  "./physis-art/exercises/dumbbell-fly-poster-human-v1.webp",
  "./physis-art/exercises/pullover-plate-human-v1.webp",
  "./physis-art/exercises/pullover-plate-poster-human-v1.webp",
  "./physis-art/exercises/pullover-dumbbell-human-v1.webp",
  "./physis-art/exercises/pullover-dumbbell-poster-human-v1.webp",
  "./physis-art/exercises/cable-pullover-ez-human-v1.webp",
  "./physis-art/exercises/cable-pullover-ez-poster-human-v1.webp",
  "./physis-art/exercises/squat-human-v1.webp",
  "./physis-art/exercises/squat-poster-human-v1.webp",
  "./physis-art/exercises/press-human-v1.webp",
  "./physis-art/exercises/press-poster-human-v1.webp",
  "./physis-art/exercises/hinge-human-v1.webp",
  "./physis-art/exercises/hinge-poster-human-v1.webp",
  "./physis-art/exercises/row-human-v1.webp",
  "./physis-art/exercises/row-poster-human-v1.webp",
  "./physis-art/exercises/pushup-human-v1.webp",
  "./physis-art/exercises/pushup-poster-human-v1.webp",
  "./physis-art/exercises/pullup-human-v1.webp",
  "./physis-art/exercises/pullup-poster-human-v1.webp",
  "./physis-art/exercises/lunge-human-v1.webp",
  "./physis-art/exercises/lunge-poster-human-v1.webp",
  "./physis-art/exercises/plank-human-v1.webp",
  "./physis-art/exercises/plank-poster-human-v1.webp",
  "./physis-art/exercises/run-human-v1.webp",
  "./physis-art/exercises/run-poster-human-v1.webp",
  "./physis-art/exercises/walk-human-v1.webp",
  "./physis-art/exercises/walk-poster-human-v1.webp",
  "./physis-art/exercises/bodyweight-squat-human-v1.webp",
  "./physis-art/exercises/bodyweight-squat-poster-human-v1.webp",
  "./physis-art/exercises/goblet-squat-human-v1.webp",
  "./physis-art/exercises/goblet-squat-poster-human-v1.webp",
  "./physis-art/exercises/split-squat-human-v1.webp",
  "./physis-art/exercises/split-squat-poster-human-v1.webp",
  "./physis-art/exercises/stepup-human-v1.webp",
  "./physis-art/exercises/stepup-poster-human-v1.webp",
  "./physis-art/exercises/glute-bridge-human-v1.webp",
  "./physis-art/exercises/glute-bridge-poster-human-v1.webp",
  "./physis-art/exercises/legpress-human-v1.webp",
  "./physis-art/exercises/legpress-poster-human-v1.webp",
  "./physis-art/exercises/legcurl-human-v1.webp",
  "./physis-art/exercises/legcurl-poster-human-v1.webp",
  "./physis-art/exercises/legextension-human-v1.webp",
  "./physis-art/exercises/legextension-poster-human-v1.webp",
  "./physis-art/exercises/calfraise-human-v1.webp",
  "./physis-art/exercises/calfraise-poster-human-v1.webp",
  "./physis-art/exercises/deadlift-human-v1.webp",
  "./physis-art/exercises/deadlift-poster-human-v1.webp",
  "./physis-art/exercises/dumbbell-bench-human-v1.webp",
  "./physis-art/exercises/dumbbell-bench-poster-human-v1.webp",
  "./physis-art/exercises/incline-bench-human-v1.webp",
  "./physis-art/exercises/incline-bench-poster-human-v1.webp",
  "./physis-art/exercises/shoulderpress-human-v1.webp",
  "./physis-art/exercises/shoulderpress-poster-human-v1.webp",
  "./physis-art/exercises/lateralraise-human-v1.webp",
  "./physis-art/exercises/lateralraise-poster-human-v1.webp",
  "./physis-art/exercises/rear-delt-fly-human-v1.webp",
  "./physis-art/exercises/rear-delt-fly-poster-human-v1.webp",
  "./physis-art/exercises/latpulldown-human-v1.webp",
  "./physis-art/exercises/latpulldown-poster-human-v1.webp",
  "./physis-art/exercises/seatedrow-human-v1.webp",
  "./physis-art/exercises/seatedrow-poster-human-v1.webp",
  "./physis-art/exercises/bicepscurl-human-v1.webp",
  "./physis-art/exercises/bicepscurl-poster-human-v1.webp",
  "./physis-art/exercises/hammercurl-human-v1.webp",
  "./physis-art/exercises/hammercurl-poster-human-v1.webp",
  "./physis-art/exercises/tricepspushdown-human-v1.webp",
  "./physis-art/exercises/tricepspushdown-poster-human-v1.webp",
  "./physis-art/exercises/deadbug-human-v1.webp",
  "./physis-art/exercises/deadbug-poster-human-v1.webp",
  "./physis-art/exercises/birddog-human-v1.webp",
  "./physis-art/exercises/birddog-poster-human-v1.webp",
];
const HERO_RANK_BANNER_ART = [
  "./habit-ranks/heroic-ranks.webp",
  "./physis-art/apollo-artemis-v1.webp",
  "./physis-art/apollo-artemis-mobile-v1.webp",
  "./physis-art/landscape-v2.webp",
  "./physis-art/apollo-artemis-cutout-v2.webp",
];
const CALENDAR_ART = [
  "./calendar-art/saturn-cronus.webp",
  "./calendar-art/genesis-sacred-calendar-v8.svg",
];
const HERO_PATH_ICON_FILES = [
  "01_tantal",
  "02_sisyphus",
  "03_cyclops",
  "04_icarus",
  "05_lionheart",
  "06_poison_conqueror",
  "07_golden_horn_pathfinder",
  "08_mountain_tamer",
  "09_lord_of_the_flow",
  "10_bronze_wing",
  "11_tamer_of_might",
  "12_iron_charioteer",
  "13_bearer_of_royal_honor",
  "14_guardian_of_the_western_border",
  "15_keeper_of_the_golden_garden",
  "16_risen_from_the_abyss",
  "17_amphora_of_aspiration",
  "18_amphora_of_endurance",
  "19_amphora_of_mastery",
  "20_amphora_of_abyss",
];
const HERO_PATH_ART = HERO_PATH_ICON_FILES.flatMap((fileName) => [
  `./hero-path/256/${fileName}.webp`,
  `./hero-path/512/${fileName}.webp`,
]);
const THEOKYKLOS_ART = [
  "./theokyklos-art/northwest-apollo.webp",
  "./theokyklos-art/north-athena.webp",
  "./theokyklos-art/northeast-artemis.webp",
  "./theokyklos-art/west-poseidon-amphitrite.webp",
  "./theokyklos-art/center-dionysus-ariadne.webp",
  "./theokyklos-art/east-hermes-peitho.webp",
  "./theokyklos-art/southwest-demeter.webp",
  "./theokyklos-art/south-ares-aphrodite.webp",
  "./theokyklos-art/southeast-hephaestus-aglaea.webp",
  "./theokyklos-art/zenith-zeus-hera.webp",
  "./theokyklos-art/hearth-hestia.webp",
  "./theokyklos-art/nadir-hades-persephone.webp",
  "./theokyklos-art/entrance-aether-hemera.webp",
  "./theokyklos-art/exit-eros-psyche.webp",
];
const THEOKYKLOS_SYMBOL_ART = [
  "./theokyklos-symbols/northwest-apollo.png",
  "./theokyklos-symbols/north-athena.png",
  "./theokyklos-symbols/northeast-artemis.png",
  "./theokyklos-symbols/west-poseidon-amphitrite.png",
  "./theokyklos-symbols/center-dionysus-ariadne.png",
  "./theokyklos-symbols/east-hermes-peitho.png",
  "./theokyklos-symbols/southwest-demeter.png",
  "./theokyklos-symbols/south-ares-aphrodite.png",
  "./theokyklos-symbols/southeast-hephaestus-aglaea.png",
  "./theokyklos-symbols/zenith-zeus-hera.png",
  "./theokyklos-symbols/hearth-hestia.png",
  "./theokyklos-symbols/nadir-hades-persephone.png",
  "./theokyklos-symbols/entrance-aether-hemera.png",
  "./theokyklos-symbols/exit-eros-psyche.png",
  "./theokyklos-symbols/olympian-zeus-v313.png",
  "./theokyklos-symbols/olympian-hera-v313.png",
  "./theokyklos-symbols/olympian-poseidon-v313.png",
  "./theokyklos-symbols/olympian-demeter-v313.png",
  "./theokyklos-symbols/olympian-athena-v313.png",
  "./theokyklos-symbols/olympian-apollo-v313.png",
  "./theokyklos-symbols/olympian-artemis-v313.png",
  "./theokyklos-symbols/olympian-ares-v313.png",
  "./theokyklos-symbols/olympian-aphrodite-v313.png",
  "./theokyklos-symbols/olympian-hephaestus-v313.png",
  "./theokyklos-symbols/olympian-hermes-v313.png",
  "./theokyklos-symbols/olympian-hestia-v313.png",
  "./theokyklos-symbols/olympian-dionysus-v313.png",
  "./theokyklos-symbols/olympian-kronos-v324.png",
];
const WEB_BRAND_ICONS = ["green", "blue", "burgundy", "violet"].flatMap(palette => ["light", "dark"].map(mode => `./icons/jade-facets-${palette}-${mode}.svg`));
const CORE = ["./", "./manifest.webmanifest", "./manifest.en.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", ...WEB_BRAND_ICONS, "./genesis-hero.png", ...MONTH_ART, ...LUNAR_MONTH_ART, ...WEEKDAY_ART, ...ACHIEVEMENT_ART, ...HABIT_REWARD_ART, ...HERO_RANK_BANNER_ART, ...PHYSIS_EXERCISE_ART, ...CALENDAR_ART, ...HERO_PATH_ART, ...THEOKYKLOS_ART, ...THEOKYKLOS_SYMBOL_ART]
  .map((path) => new URL(path, SCOPE).href);
const REQUIRED_SHELL = [...new Set([...CORE, ...PRECACHE.map((path) => new URL(path, SCOPE).href)])];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(REQUIRED_SHELL.map((url) => new Request(url, { cache: "reload" })));
    // SPA fallback can return HTTP 200 HTML while hashed assets are being deployed.
    // Such a response must never become an installed offline JavaScript module.
    for (const url of REQUIRED_SHELL.filter((url) => new URL(url).pathname.startsWith(ASSETS_PATH))) {
      const response = await cache.match(url);
      if (!response || response.headers.get("Content-Type")?.includes("text/html")) {
        await cache.delete(url);
        throw new Error("GENESIS asset precache received an HTML fallback");
      }
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  if (url.pathname.includes("/downloads/")) return;

  // Versioned bundles are immutable. Keep serving the current page's cached
  // modules while a newer worker waits for all open tabs to close.
  if (url.pathname.startsWith(ASSETS_PATH)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached && !cached.headers.get("Content-Type")?.includes("text/html")) return cached;
        const response = await fetch(request);
        if (response.headers.get("Content-Type")?.includes("text/html")) {
          // Also protect clients still behind a stale SPA rewrite configuration.
          return new Response("Module unavailable", { status: 404, headers: {
            "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
          } });
        }
        if (response.ok) {
          void cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(SCOPE, copy));
          return response;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        // A transient CDN failure must not replace an already saved illustration.
        if (request.destination === "image" && (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/"))) {
          const saved = await caches.match(request) || await caches.match(request, { ignoreSearch: true });
          if (saved?.ok && saved.headers.get("Content-Type")?.startsWith("image/")) return saved;
          return response;
        }
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => await caches.match(request) || (request.destination === "image" ? caches.match(request, { ignoreSearch: true }) : undefined)),
  );
});

const SHARED_PUSH_RECEIPTS = "genesis-shared-push-receipts-v1";
let sharedPushChain = Promise.resolve();
let sharedPushReceived = 0;
self.addEventListener("push", (event) => {
  let id;
  try { const payload = event.data?.json(); if (payload?.channel === "habit" || payload?.channel === "advice") return; id = payload?.deliveryId; } catch { return; }
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return;
  const receive = async () => {
    const receipts = await caches.open(SHARED_PUSH_RECEIPTS);
    const receiptUrl = new URL(`./__shared-push-receipt/${id}`, SCOPE).href;
    if (await receipts.match(receiptUrl)) return;
    // Cookies and current access are required even when the browser receives a valid encrypted push.
    const response = await fetch(new URL(`./api/shared/push-deliveries/${encodeURIComponent(id)}`, SCOPE).href, { credentials: "include", cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json(), message = result.message;
    if (!result.displayAllowed || !message || message.deliveryId !== id || typeof message.body !== "string") return;
    const target = new URL(message.url, SCOPE);
    if (target.origin !== new URL(SCOPE).origin || !target.pathname.startsWith(new URL(SCOPE).pathname)) return;
    await self.registration.showNotification("GENESIS", { body: message.body, lang: message.lang, tag: `genesis-shared-${id}`, renotify: false,
      data: { url: target.href, sharedDeliveryId: id } });
    await receipts.put(receiptUrl, new Response(JSON.stringify({ receivedAt: Date.now() }), { headers: { "Content-Type": "application/json" } }));
    // Keep receipts beyond the provider TTL. Only old opaque IDs are removed, never current unread content.
    if (++sharedPushReceived % 50 === 0) for (const key of await receipts.keys()) {
      const old = await receipts.match(key); let receivedAt;
      try { receivedAt = (await old.json()).receivedAt; } catch { continue; }
      if (typeof receivedAt === "number" && receivedAt < Date.now() - 172800000) await receipts.delete(key);
    }
  };
  sharedPushChain = sharedPushChain.catch(() => undefined).then(receive).catch(() => undefined);
  event.waitUntil(sharedPushChain);
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification.data?.habitDeliveryId || event.notification.data?.habitTarget) return;
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || "./#today", SCOPE),scope = new URL(SCOPE);
  if(target.origin!==scope.origin||!target.pathname.startsWith(scope.pathname))return;
  const targetUrl=target.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const visibleClient = clients.find((client) => "focus" in client);
      if (visibleClient) {
        visibleClient.postMessage({
          type: "GENESIS_NOTIFICATION_OPENED",
          notificationId: data.genesisNotificationId,
          kind: data.kind,
          variant: data.variant,
        });
        await visibleClient.focus();
        if ("navigate" in visibleClient) await visibleClient.navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    }),
  );
});
