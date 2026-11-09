import type { DailyAdvice } from './daily-advice';
import { philosopherQuoteParts } from './philosopher-quote.ts';
import { compactAdviceBody } from './advice-text.ts';

export const ADVICE_APPLICATION_URL = 'https://genesiscalendar.com';

/** Break at words where possible and at Unicode code points for words wider than the image. */
export function wrapAdviceText(text: string, width: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (measure(line + word) <= width) { line += word; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      if (measure(word) <= width) { line = word.trimStart(); continue; }
      for (const point of word) {
        if (line && measure(line + point) > width) { lines.push(line); line = ''; }
        line += point;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export async function renderAdviceShare(advice: DailyAdvice): Promise<File> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ADVICE_SHARE_CANVAS_UNAVAILABLE');
  let image: HTMLImageElement | null = null;
  if (advice.image) {
    image = new Image(); image.src = advice.image;
    await image.decode();
  }
  ctx.font = '600 48px Inter, sans-serif';
  const title = wrapAdviceText(advice.title ?? '', 952, value => ctx.measureText(value).width);
  ctx.font = '36px Inter, sans-serif';
  const philosophy = advice.collection === 'philosophers' ? philosopherQuoteParts(advice.body, advice.sources[0]?.author ?? '') : null;
  const bodyText = philosophy ? [philosophy.context, compactAdviceBody(philosophy.quote), philosophy.author ? `(${philosophy.author})` : ''].filter(Boolean).join('\n\n') : compactAdviceBody(advice.body);
  const body = wrapAdviceText(bodyText, 952, value => ctx.measureText(value).width);
  ctx.font = '26px Inter, sans-serif';
  const sources = advice.sources.flatMap(source => wrapAdviceText([philosophy?.author ? '' : source.author, source.work, source.reference].filter(Boolean).join(' · '), 952, value => ctx.measureText(value).width));
  const artHeight = image ? 532 : 0;
  const height = 64 + artHeight + title.length * 62 + body.length * 48 + sources.length * 36 + 244;
  if (height > 20_000) throw new Error('ADVICE_SHARE_TOO_LARGE');
  canvas.height = height;
  ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 64;
  if (image) {
    const scale = Math.min(952 / image.naturalWidth, 500 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    ctx.drawImage(image, (1080 - width) / 2, y, width, image.naturalHeight * scale);
    y += artHeight;
  }
  ctx.textBaseline = 'top'; ctx.fillStyle = '#132426';
  const draw = (lines: string[], font: string, lineHeight: number) => {
    ctx.font = font;
    for (const line of lines) { ctx.fillText(line, 64, y); y += lineHeight; }
    y += 24;
  };
  draw(title, '600 48px Inter, sans-serif', 62);
  draw(body, '36px Inter, sans-serif', 48);
  if (sources.length) draw(sources, '26px Inter, sans-serif', 36);
  ctx.strokeStyle = '#255b59'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(64, height - 140); ctx.lineTo(1016, height - 140); ctx.stroke();
  ctx.fillStyle = '#255b59'; ctx.font = '600 38px Inter, sans-serif';
  ctx.fillText('GENESIS', 64, height - 120);
  ctx.font = '28px Inter, sans-serif'; ctx.fillText(ADVICE_APPLICATION_URL, 64, height - 62);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('ADVICE_SHARE_PNG_FAILED')), 'image/png'));
  return new File([blob], 'GENESIS-advice.png', { type: 'image/png' });
}
