import type { HeroicRankId } from "./habit-progress";

export type HeroPathImageAsset = {
  src: string;
  srcSet: string;
  sizes: string;
};

function heroPathImage(fileName: string, sizes: string): HeroPathImageAsset {
  const small = `/hero-path/256/${fileName}.webp`;
  const large = `/hero-path/512/${fileName}.webp`;
  return {
    src: small,
    srcSet: `${small} 256w, ${large} 512w`,
    sizes,
  };
}

const RANK_ICON_SIZES = "(max-width: 520px) 74px, 104px";
const AMPHORA_ICON_SIZES = "(max-width: 520px) 56px, 70px";

export const HEROIC_RANK_ICON_ASSETS: Partial<Record<HeroicRankId, HeroPathImageAsset>> = {
  tantalus: heroPathImage("01_tantal", RANK_ICON_SIZES),
  sisyphus: heroPathImage("02_sisyphus", RANK_ICON_SIZES),
  cyclops: heroPathImage("03_cyclops", RANK_ICON_SIZES),
  icarus: heroPathImage("04_icarus", RANK_ICON_SIZES),
  "lion-heart": heroPathImage("05_lionheart", RANK_ICON_SIZES),
  "venom-vanquisher": heroPathImage("06_poison_conqueror", RANK_ICON_SIZES),
  "golden-horn-pathfinder": heroPathImage("07_golden_horn_pathfinder", RANK_ICON_SIZES),
  "mountain-tamer": heroPathImage("08_mountain_tamer", RANK_ICON_SIZES),
  "lord-of-the-current": heroPathImage("09_lord_of_the_flow", RANK_ICON_SIZES),
  "bronze-wing": heroPathImage("10_bronze_wing", RANK_ICON_SIZES),
  "tamer-of-might": heroPathImage("11_tamer_of_might", RANK_ICON_SIZES),
  "iron-charioteer": heroPathImage("12_iron_charioteer", RANK_ICON_SIZES),
  "royal-honor-bearer": heroPathImage("13_bearer_of_royal_honor", RANK_ICON_SIZES),
  "western-verge-guardian": heroPathImage("14_guardian_of_the_western_border", RANK_ICON_SIZES),
  "golden-garden-keeper": heroPathImage("15_keeper_of_the_golden_garden", RANK_ICON_SIZES),
  "risen-from-the-abyss": heroPathImage("16_risen_from_the_abyss", RANK_ICON_SIZES),
};

export const HERO_PATH_CHECKPOINT_ICON_ASSETS: Partial<Record<HeroicRankId, HeroPathImageAsset>> = {
  icarus: heroPathImage("17_amphora_of_aspiration", AMPHORA_ICON_SIZES),
  "mountain-tamer": heroPathImage("18_amphora_of_endurance", AMPHORA_ICON_SIZES),
  "iron-charioteer": heroPathImage("19_amphora_of_mastery", AMPHORA_ICON_SIZES),
  "risen-from-the-abyss": heroPathImage("20_amphora_of_abyss", AMPHORA_ICON_SIZES),
};
