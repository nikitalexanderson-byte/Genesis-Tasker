/** Exact authored labels plus the SVG's numeric/compound labels; no user content enters this map. */
export function solarLabelTranslator(dictionary, language) {
  const normalized = value => value.replace(/\s+/gu, " ").trim();
  const key = value => normalized(value).toLocaleLowerCase("ru");
  const labels = new Map(Object.entries(dictionary).map(([source, target]) => [key(source), target]));
  const t = source => {
    const text = normalized(source), exact = labels.get(key(text));
    if (exact) return text === text.toLocaleUpperCase("ru") ? exact.toLocaleUpperCase(language) : exact;
    if (text.startsWith("5 ДНЕЙ — ПЯТА")) return `${t("5 ДНЕЙ")} — ${t("ПЯТА")} · ${t("6 ПЯТ")} — ${t("МЕСЯЦ")} · ${t("3 МЕСЯЦА")} — ${t("СЕЗОН")} · ${t("Апейрон")}: ${t("5 ДНЕЙ")} + ${t("НЕЯВНЫЙ ДЕНЬ")}`;
    if (text.includes(" · ")) return text.split(" · ").map(t).join(" · ");
    const pentad = /^ПЯТА ([IVX]+)$/u.exec(text);
    if (pentad) return `${t("ПЯТА")} ${pentad[1]}`;
    const date = /^(\d+–\d+) (МАРТА|ИЮНЯ|СЕНТЯБРЯ|ДЕКАБРЯ)$/u.exec(text);
    if (date) {
      const month = ["МАРТА", "ИЮНЯ", "СЕНТЯБРЯ", "ДЕКАБРЯ"].indexOf(date[2]) * 3 + 2;
      return `${date[1]} ${new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month, 1))).toLocaleUpperCase(language)}`;
    }
    if (text.startsWith("GENESIS — сакральный календарь")) return `GENESIS · ${t("360 ДНЕЙ")}`;
    if (text.startsWith("Сакральный календарь GENESIS:")) return `GENESIS · ${t("12 МЕСЯЦЕВ")} · ${t("72 ПЯТЫ")} · ${t("360 ДНЕЙ")} · ${t("Апейрон")}`;
    if (text === "Конец года — Хаос") return `${t("КОНЕЦ ГОДА")} — ${t("Хаос")}`;
    if (/^(Фанес|Эрос) — начало Арейоса$/u.test(text)) return `${t(text.split(" — ")[0])} — ${t("НАЧАЛО ГОДА")}: ${t("Арейос")}`;
    return source;
  };
  return t;
}

/** Localize the existing vector, including labels drawn one letter at a time along arcs. */
export function localizeSolarModel(svg, translate, language) {
  if (language === "ru") return;
  const ns = "http://www.w3.org/2000/svg";
  const canvas = svg.ownerDocument.createElement("canvas");
  const measure = canvas.getContext("2d");
  const normalized = value => value.replace(/\s+/gu, " ").trim();
  const label = value => translate(normalized(value));
  for (const group of svg.querySelectorAll(".curved-label")) {
    const original = group.getAttribute("aria-label");
    if (!original) continue;
    const text = label(original);
    const letters = [...group.querySelectorAll("text")];
    if (text === original || !letters.length) continue;
    const points = letters.map(node => /translate\(([-\d.]+)[ ,]+([-\d.]+)\) rotate\(([-\d.]+)\)/u.exec(node.getAttribute("transform") || ""));
    if (points.some(point => !point)) continue;
    const first = points[0], last = points[points.length - 1];
    const radius = Math.hypot(Number(first[1]) - 2500, Number(first[2]) - 2500);
    const angle = Math.atan2(Number(first[2]) - 2500, Number(first[1]) - 2500);
    const sweep = (Number(last[3]) - Number(first[3])) * Math.PI / 180;
    const direction = Math.sign(sweep) || 1;
    const size = Number(group.getAttribute("font-size") || 24);
    const tracking = Number(group.getAttribute("letter-spacing") || 0);
    if (measure) measure.font = `${group.getAttribute("font-weight") || "normal"} ${size}px Georgia, serif`;
    const width = char => (measure?.measureText(char).width || size * .65) + tracking;
    const available = Math.abs(sweep * radius) + width(letters[letters.length - 1].textContent || " ");
    const glyphs = typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(language, { granularity: "grapheme" }).segment(text)].map(part => part.segment) : [...text];
    const widths = glyphs.map(width), total = widths.reduce((sum, value) => sum + value, 0);
    const scale = Math.min(1, available / Math.max(1, total));
    let offset = (available - total * scale) / 2;
    const fragment = svg.ownerDocument.createDocumentFragment();
    glyphs.forEach((char, index) => {
      const theta = angle + direction * offset / radius;
      const node = svg.ownerDocument.createElementNS(ns, "text");
      node.textContent = char;
      node.setAttribute("text-anchor", "start");
      node.setAttribute("font-size", String(size * scale));
      node.setAttribute("transform", `translate(${2500 + radius * Math.cos(theta)} ${2500 + radius * Math.sin(theta)}) rotate(${Number(first[3]) + direction * offset / radius * 180 / Math.PI})`);
      fragment.append(node); offset += widths[index] * scale;
    });
    group.replaceChildren(fragment); group.setAttribute("aria-label", text);
  }
  for (const node of svg.querySelectorAll("text, title, desc")) {
    if (node.closest(".curved-label")) continue;
    const original = node.textContent || "";
    const translated = label(original);
    if (original !== translated) {
      node.textContent = translated;
      // Keep translated labels inside their original sector rather than crossing neighbours.
      if (node.tagName.toLowerCase() === "text" && original.length > 2 && translated.length > original.length) {
        const size = Number(node.getAttribute("font-size") || 0);
        if (size) node.setAttribute("font-size", String(size * Math.max(.65, original.length / translated.length)));
      }
    }
  }
  for (const node of svg.querySelectorAll("[data-kind]")) {
    const kind = node.dataset.kind;
    const prefix = translate(kind === "pentad" ? "ПЯТА" : kind === "day" ? "День" : "МЕСЯЦ");
    node.setAttribute("aria-label", `${prefix} ${node.dataset.month} ${node.dataset.day || node.dataset.first || ""}`.trim());
  }
  svg.setAttribute("lang", language);
}
