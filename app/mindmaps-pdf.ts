import { mapSvg, visibleNodes, type MapNode, type MapView, type Mindmap } from "./mindmaps-model";
import { getRuntimeLanguage, translateText } from "./i18n";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Vector overview plus a paginated, readable outline. No canvas bitmap or network. */
export function mindmapPrintHtml(map: Mindmap, title: (node: MapNode) => string, view: MapView) {
  const titles = new Map(map.nodes.map(node => [node.id, title(node)]));
  const text = (node: MapNode) => titles.get(node.id) || "";
  const rows = visibleNodes(map, { mode: "structure", collapsed: [], focus: null, zoom: 1 });
  const structure = rows.map(({ node, depth }) => `<section class="node" style="margin-inline-start:${Math.min(depth, 4) * 12}px;border-color:${node.style?.border || "#255b59"}"><h3>${escape(text(node))}</h3>${node.presentation?.image ? `<img src="${escape(node.presentation.image.data)}" alt="${escape(node.presentation.image.alt||text(node))}" style="display:block;max-width:240px;max-height:160px;margin-bottom:8px">` : ""}${node.note ? `<p>${escape(node.note)}</p>` : ""}${node.refId ? `<small>${escape(node.kind === "task" ? translateText("Задача GENESIS") : translateText("Проект GENESIS"))} · ${escape(node.refId)}${node.occurrenceDate ? ` · ${escape(node.occurrenceDate)}` : ""}</small>` : ""}</section>`).join("");
  const links = map.links.map(link => `<p>${escape(titles.get(link.from) || "")} — ${escape(link.label)} — ${escape(titles.get(link.to) || "")}</p>`).join("");
  const svg = mapSvg(map, text, view);
  const dimensions = svg.match(/width="([\d.]+)" height="([\d.]+)"/)!;
  const vector = svg.replace("<svg ", `<svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 ${dimensions[1]} ${dimensions[2]}" `);
  return `<!doctype html><html lang="${getRuntimeLanguage()}"><head><meta charset="utf-8"><title>${escape(map.title)} · GENESIS</title><style>
    @page { size:A3 landscape; margin:14mm; } * { box-sizing:border-box; } body { margin:0; color:#132426; background:white; font:11pt/1.5 Arial,sans-serif; overflow-wrap:anywhere; } h1 { font-size:22pt; margin:0 0 8mm; } h2 { font-size:17pt; margin:0 0 6mm; } h3 { font-size:12pt; margin:0 0 2mm; } p { white-space:pre-wrap; margin:0 0 3mm; } small { font-size:9pt; } .overview { height:255mm; break-after:page; } .overview svg { width:100%; height:230mm; display:block; } .node { padding:3mm 4mm; margin-bottom:4mm; border:1px solid; border-radius:3mm; break-inside:avoid; } .links { break-before:page; } @media screen { body { padding:20px; max-width:1400px; margin:auto; } .overview { height:auto; } }
  </style></head><body><article class="overview"><h1>${escape(map.title)}</h1>${vector}</article><article><h2>${escape(translateText("Структура карты"))}</h2>${structure}</article>${links ? `<article class="links"><h2>${escape(translateText("Смысловые связи"))}</h2>${links}</article>` : ""}</body></html>`;
}

export function printMindmap(map: Mindmap, title: (node: MapNode) => string, view: MapView) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Разрешите окно экспорта PDF в браузере и повторите.");
  popup.opener = null;
  const html = mindmapPrintHtml(map, title, view);
  popup.document.open(); popup.document.write(html); popup.document.close();
  // Printing requires the complete local document and fonts; keep the window for retry/cancel.
  void popup.document.fonts.ready.then(() => {
    popup.requestAnimationFrame(() => { popup.focus(); popup.print(); });
  });
}
