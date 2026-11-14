import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Preserve the approved web mark's paths, transforms and palette colors exactly.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const res = path.join(root, 'android/app/src/main/res');
const ns = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const circle = r => `M${-r},0 A${r},${r} 0,1 0,${r},0 A${r},${r} 0,1 0,${-r},0 Z`;
const write = (name, content) => { const target = path.join(res, name); mkdirSync(path.dirname(target), {recursive:true}); writeFileSync(target, content + '\n'); };
const colors = [];
for (const palette of ['green', 'blue', 'burgundy', 'violet']) for (const mode of ['light', 'dark']) {
  const id = `${palette}_${mode}`;
  const svg = readFileSync(path.join(root, `public/icons/jade-facets-${palette}-${mode}.svg`), 'utf8');
  const background = svg.match(/id="background" fill="([^"]+)"/)[1];
  const ring = svg.match(/id="outer-ring"[^>]*stroke="([^"]+)"/)[1];
  const rays = svg.match(/id="solar-rays" fill="([^"]+)"/)[1];
  const paths = [...svg.matchAll(/<path ([^>]+)\/>/g)].map(([, attrs]) => {
    const get = name => attrs.match(new RegExp(`(?:^| )${name}="([^"]*)"`))?.[1];
    const transform = get('transform');
    let body = `<path android:fillColor="${get('fill') ?? rays}" android:pathData="${get('d')}"/>`;
    const parts = [...transform.matchAll(/(rotate|translate|scale)\(([^)]+)\)/g)];
    for (const [, type, values] of parts.reverse()) {
      const [x, y] = values.split(/[ ,]+/).map(Number);
      const properties = type === 'rotate' ? `android:rotation="${x}"` : type === 'translate'
        ? `android:translateX="${x}" android:translateY="${y ?? 0}"`
        : `android:scaleX="${x}" android:scaleY="${y ?? x}"`;
      body = `<group ${properties}>${body}</group>`;
    }
    return body;
  }).join('\n');
  const emblem = `<path android:fillColor="#00000000" android:strokeColor="${ring}" android:strokeWidth="26" android:pathData="${circle(389)}"/>\n${paths}\n<path android:fillColor="${rays}" android:pathData="${circle(154)}"/>`;
  const vector = (launcher, mono = false) => {
    let body = emblem;
    if (mono) body = body.replace(/android:(fillColor|strokeColor)="(#[^\"]+)"/g, (all, key, value) => value === '#00000000' ? all : `android:${key}="#FFFFFFFF"`);
    const viewport = launcher ? 1536 : 1024, center = viewport / 2;
    const bg = !launcher && !mono ? `<path android:fillColor="${background}" android:pathData="M0,512 A512,512 0,1 0,1024,512 A512,512 0,1 0,0,512 Z"/>` : '';
    return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from public/icons/jade-facets-${palette}-${mode}.svg. -->\n<vector ${ns} android:width="${launcher ? 108 : 48}dp" android:height="${launcher ? 108 : 48}dp" android:viewportWidth="${viewport}" android:viewportHeight="${viewport}">${bg}<group android:translateX="${center}" android:translateY="${center}">${body}</group></vector>`;
  };
  write(`drawable/genesis_brand_${id}.xml`, vector(false));
  write(`drawable/genesis_launcher_${id}.xml`, vector(true));
  colors.push(`<color name="genesis_brand_${id}_background">${background}</color>`);
  const adaptive = mono => `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon ${ns}><background android:drawable="@color/genesis_brand_${id}_background"/><foreground android:drawable="@drawable/genesis_launcher_${id}"/>${mono ? '<monochrome android:drawable="@drawable/genesis_launcher_monochrome"/>' : ''}</adaptive-icon>`;
  write(`mipmap-anydpi-v26/ic_launcher_${id}.xml`, adaptive(false));
  write(`mipmap-anydpi-v33/ic_launcher_${id}.xml`, adaptive(true));
  if (id === 'green_light') {
    write('mipmap-anydpi-v26/ic_launcher.xml', adaptive(false));
    write('mipmap-anydpi-v33/ic_launcher.xml', adaptive(true));
    write('drawable/genesis_brand_monochrome.xml', vector(false, true));
    write('drawable/genesis_launcher_monochrome.xml', vector(true, true));
  }
}
write('values/brand_icon_colors.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>${colors.join('\n')}</resources>`);
write('drawable/ic_notification.xml', `<inset ${ns} android:drawable="@drawable/genesis_brand_monochrome" android:inset="1dp"/>`);
write('drawable/ic_launcher_foreground.xml', `<inset ${ns} android:drawable="@drawable/genesis_launcher_green_light" android:inset="0dp"/>`);
