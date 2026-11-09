// Alphabet symbols remain Greek; authored words follow the interface's script.
export function formatGreekTerms(text: string, language: string): string {
  if (language === "el") return text;
  const cyrillic = ["ru", "uk", "sr"].includes(language);
  const alphabet = "αβγδεζηθικλμνξοπρστυφχψως";
  const latin = ["a","b","g","d","e","z","e","th","i","k","l","m","n","x","o","p","r","s","t","y","ph","ch","ps","o","s"];
  const cyrillicLetters = ["а","б","г","д","е","з","е","т","и","к","л","м","н","кс","о","п","р","с","т","и","ф","х","пс","о","с"];
  return text.replace(/\p{Script=Greek}[\p{Script=Greek}\p{M}]+/gu, word => {
    const plain = word.normalize("NFD").replace(/\p{M}/gu, "");
    const letters = cyrillic ? cyrillicLetters : latin;
    let converted = [...plain.toLowerCase()].map(letter => letters[alphabet.indexOf(letter)] ?? letter).join("");
    if (plain[0] !== plain[0].toLowerCase()) converted = converted[0].toUpperCase() + converted.slice(1);
    return converted;
  });
}
