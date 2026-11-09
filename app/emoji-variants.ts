import catalog from './emoji-full-catalog.json';
export type EmojiVariantGroup = { base: string; variants: string[] };
export const emojiVariantKey = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\uFE0F/gu, '');
export function groupEmojiVariants(emojis: readonly string[]): EmojiVariantGroup[] {
  const groups = new Map<string, EmojiVariantGroup>();
  for (const emoji of emojis) {
    const key = emojiVariantKey(emoji), group = groups.get(key);
    if (group) { if (!group.variants.includes(emoji)) group.variants.push(emoji); }
    else groups.set(key, {base: emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ''), variants: [emoji]});
  }
  return [...groups.values()].map(group => {
    const neutral = group.variants.find(emoji => !/[\u{1F3FB}-\u{1F3FF}]/u.test(emoji));
    const base = neutral ?? group.base;
    return {base, variants: [...new Set([base, ...group.variants])]};
  });
}
const allGroups = groupEmojiVariants(catalog.flatMap(category => category.emojis));
const lookup = new Map(allGroups.map(group => [emojiVariantKey(group.base), group]));
export const emojiVariants = (emoji: string) => lookup.get(emojiVariantKey(emoji))?.variants ?? [emoji];
export const groupedEmojiCatalog = catalog.map(category => ({...category, emojis: groupEmojiVariants(category.emojis).map(group => group.base)}));
