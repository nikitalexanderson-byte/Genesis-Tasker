const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const russian = /^(?:Europe\/(?:Moscow|Kaliningrad)|Asia\/(?:Yekaterinburg|Novosibirsk|Krasnoyarsk|Irkutsk|Yakutsk|Vladivostok))$/.test(zone ?? "")
  || (!zone && navigator.language.startsWith("ru"));
if (!russian) {
  document.documentElement.lang = "en";
  document.title = "GENESIS — new address";
  document.getElementById("heading").textContent = "We have moved";
  document.getElementById("description").textContent = "The GENESIS website and app now use our new address.";
  document.getElementById("destination").textContent = "Open genesiscalendar.com";
}
