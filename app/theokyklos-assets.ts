import type { TheokyklosSegmentId } from "./theokyklos-data";

export const THEOKYKLOS_DETAIL_ART: Readonly<Record<TheokyklosSegmentId, string>> = {
  north: "/theokyklos-art/north-athena.webp",
  northeast: "/theokyklos-art/northeast-artemis.webp",
  east: "/theokyklos-art/east-hermes-peitho.webp",
  southeast: "/theokyklos-art/southeast-hephaestus-aglaea.webp",
  south: "/theokyklos-art/south-ares-aphrodite.webp",
  southwest: "/theokyklos-art/southwest-demeter.webp",
  west: "/theokyklos-art/west-poseidon-amphitrite.webp",
  northwest: "/theokyklos-art/northwest-apollo.webp",
  zenith: "/theokyklos-art/zenith-zeus-hera.webp",
  nadir: "/theokyklos-art/nadir-hades-persephone.webp",
  hearth: "/theokyklos-art/hearth-hestia.webp",
  center: "/theokyklos-art/center-dionysus-ariadne.webp",
  entrance: "/theokyklos-art/entrance-aether-hemera.webp",
  exit: "/theokyklos-art/exit-eros-psyche.webp",
};

export const THEOKYKLOS_SYMBOL_ART: Readonly<Record<TheokyklosSegmentId, string>> = {
  north: "/theokyklos-symbols/north-athena.png",
  northeast: "/theokyklos-symbols/northeast-artemis.png",
  east: "/theokyklos-symbols/east-hermes-peitho.png",
  southeast: "/theokyklos-symbols/southeast-hephaestus-aglaea.png",
  south: "/theokyklos-symbols/south-ares-aphrodite.png",
  southwest: "/theokyklos-symbols/southwest-demeter.png",
  west: "/theokyklos-symbols/west-poseidon-amphitrite.png",
  northwest: "/theokyklos-symbols/northwest-apollo.png",
  zenith: "/theokyklos-symbols/zenith-zeus-hera.png",
  nadir: "/theokyklos-symbols/nadir-hades-persephone.png",
  hearth: "/theokyklos-symbols/hearth-hestia.png",
  center: "/theokyklos-symbols/center-dionysus-ariadne.png",
  entrance: "/theokyklos-symbols/entrance-aether-hemera.png",
  exit: "/theokyklos-symbols/exit-eros-psyche.png",
};

export const THEOKYKLOS_SYMBOL_COLORS: Readonly<Record<TheokyklosSegmentId, string>> = {
  north: "#d9c37a",
  northeast: "#a8d7cf",
  east: "#e8c16d",
  southeast: "#e09a62",
  south: "#d97a68",
  southwest: "#c9ad65",
  west: "#73b9c1",
  northwest: "#f0c55f",
  zenith: "#f2d57f",
  nadir: "#9a8dc2",
  hearth: "#ec9464",
  center: "#d6b36a",
  entrance: "#87c8ae",
  exit: "#d2a0c2",
};
