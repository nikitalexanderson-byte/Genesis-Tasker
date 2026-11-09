import copy from './diary-copy.json';
export function diaryCopy(language: string): typeof copy.ru {
  return (copy as Record<string, typeof copy.ru>)[language] ?? copy.en;
}
