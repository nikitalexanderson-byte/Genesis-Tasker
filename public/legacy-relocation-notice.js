const relocationCopy = {
  ru: {
    title: "GENESIS переезжает на genesiscalendar.com",
    intro: "Новый дизайн и дальнейшие обновления — на новом сайте. Этот сайт пока продолжает работать.",
    link: "Открыть новый сайт",
    footerTitle: "Объявление о переезде",
    footerText: "Основной адрес GENESIS — genesiscalendar.com. Сохраните его в закладках. Календарь на старом адресе остаётся доступным.",
  },
  en: {
    title: "GENESIS is moving to genesiscalendar.com",
    intro: "The new design and future updates are on our new website. This website continues to work for now.",
    link: "Open the new website",
    footerTitle: "New website address",
    footerText: "The main GENESIS address is genesiscalendar.com. Bookmark it. The calendar at the previous address remains available.",
  },
};
function updateRelocationCopy() {
  const copy = relocationCopy[document.documentElement.lang.startsWith("ru") ? "ru" : "en"];
  document.querySelectorAll(".genesis-relocation-notice [data-relocation-copy]").forEach(element => {
    element.textContent = copy[element.dataset.relocationCopy] ?? element.textContent;
  });
  document.getElementById("genesis-relocation-top")?.setAttribute("aria-label", copy.title);
  document.getElementById("genesis-relocation-bottom")?.setAttribute("aria-label", copy.footerTitle);
}
updateRelocationCopy();
new MutationObserver(updateRelocationCopy).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
