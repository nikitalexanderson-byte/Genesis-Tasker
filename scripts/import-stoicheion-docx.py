"""Import the 24-letter Stoicheion catalogue from the author's DOCX source.

The current source intentionally contains 23 authored entries. Chi is kept as a
transparent editorial placeholder so the application always exposes the full
24-letter classical Greek alphabet.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from docx import Document


LETTERS = (
    ("alpha", "Альфа", "Α", "α", 1),
    ("beta", "Бета", "Β", "β", 2),
    ("gamma", "Гамма", "Γ", "γ", 3),
    ("delta", "Дельта", "Δ", "δ", 4),
    ("epsilon", "Эпсилон", "Ε", "ε", 5),
    ("zeta", "Дзета", "Ζ", "ζ", 7),
    ("eta", "Эта", "Η", "η", 8),
    ("theta", "Тэта", "Θ", "θ", 9),
    ("iota", "Йота", "Ι", "ι", 10),
    ("kappa", "Каппа", "Κ", "κ", 20),
    ("lambda", "Лямбда", "Λ", "λ", 30),
    ("mu", "Мю", "Μ", "μ", 40),
    ("nu", "Ню", "Ν", "ν", 50),
    ("xi", "Кси", "Ξ", "ξ", 60),
    ("omicron", "Омикрон", "Ο", "ο", 70),
    ("pi", "Пи", "Π", "π", 80),
    ("rho", "Ро", "Ρ", "ρ", 100),
    ("sigma", "Сигма", "Σ", "σ", 200),
    ("tau", "Тау", "Τ", "τ", 300),
    ("upsilon", "Ипсилон", "Υ", "υ", 400),
    ("phi", "Фи", "Φ", "φ", 500),
    ("chi", "Хи", "Χ", "χ", 600),
    ("psi", "Пси", "Ψ", "ψ", 700),
    ("omega", "Омега", "Ω", "ω", 800),
)

CHI_TAGLINE = "Шестисотный знак и недостающее звено основного ряда"
CHI_CONTENT = """Примечание к источнику
В предоставленном документе отдельное описание Хи отсутствует. Буква добавлена в каталог, чтобы основной греческий алфавит был представлен полностью: 24 буквы. Авторскую метафизическую трактовку для этой позиции предстоит дополнить.

Буквенный и числовой профиль
Хи (Χ, χ) - двадцать вторая буква основного греческого алфавита. В классической системе греческой исопсефии ее числовое значение равно 600, а Пифмен - числовой корень - равен 6.

Временная трактовка
Пока авторское описание не добавлено, Хи участвует в выборе буквы дня и в раскладе только как полноценный буквенный и числовой знак. Этот текст намеренно не приписывает ей дополнительные божества, цвета, телесные центры или магические практики."""


def numeric_root(value: int) -> int:
    return 0 if value == 0 else 1 + ((value - 1) % 9)


def ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-stoicheion-docx.py SOURCE.docx OUTPUT.ts")

    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    document = Document(source_path)
    authored: dict[str, tuple[str, str]] = {}

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        heading, _, body = text.partition("\n")
        name = heading.split(" - ", 1)[0].strip()
        tagline = heading.split(" - ", 1)[1].strip() if " - " in heading else heading
        if name in {item[1] for item in LETTERS}:
            authored[name] = (tagline, body.strip())

    if len(authored) != 23:
        raise ValueError(f"Expected 23 authored letter entries, found {len(authored)}")
    if "Хи" in authored:
        raise ValueError("The source now contains Chi; remove the editorial fallback before importing")

    rows: list[str] = []
    for order, (letter_id, name, symbol, lowercase, value) in enumerate(LETTERS, start=1):
        if name == "Хи":
            tagline, content, source = CHI_TAGLINE, CHI_CONTENT, "editorial-placeholder"
        else:
            tagline, content = authored[name]
            source = "author-document"
        rows.append(
            "  {\n"
            f"    id: {ts_string(letter_id)},\n"
            f"    order: {order},\n"
            f"    name: {ts_string(name)},\n"
            f"    symbol: {ts_string(symbol)},\n"
            f"    lowercase: {ts_string(lowercase)},\n"
            f"    value: {value},\n"
            f"    pythmen: {numeric_root(value)},\n"
            f"    tagline: {ts_string(tagline)},\n"
            f"    content: {ts_string(content)},\n"
            f"    source: {ts_string(source)},\n"
            "  },"
        )

    generated = f'''// Generated from {source_path.name} by scripts/import-stoicheion-docx.py.
// The source contains 23 authored entries; Chi is an explicit editorial placeholder.

export type StoicheionLetter = {{
  id: string;
  order: number;
  name: string;
  symbol: string;
  lowercase: string;
  value: number;
  pythmen: number;
  tagline: string;
  content: string;
  source: "author-document" | "editorial-placeholder";
}};

export const STOICHEION_SOURCE_COUNT = {len(authored)};
export const STOICHEION_TOTAL_COUNT = {len(LETTERS)};

export const STOICHEION_LETTERS = [
{chr(10).join(rows)}
] as const satisfies readonly StoicheionLetter[];
'''
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(generated, encoding="utf-8")
    print(
        f"Imported {len(authored)} authored entries and "
        f"{len(LETTERS) - len(authored)} placeholder into {output_path}"
    )


if __name__ == "__main__":
    main()
