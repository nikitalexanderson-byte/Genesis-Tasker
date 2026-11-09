import { createElement } from 'react';
import icons from './health-icon-data.json';
import type { HealthIconName } from './health-icon-names';

export function HealthIcon({ name }: { name: HealthIconName }) {
  const icon = icons[name] ?? icons['sliders-horizontal'];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {icon.nodes.map((node, index) => createElement(node.tag, { ...node.attrs, key: index }))}
  </svg>;
}
export const healthIconLabel = (name: HealthIconName, language: string) => icons[name][language === 'ru' ? 'ru' : 'en'];
