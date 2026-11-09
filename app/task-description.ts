const GENESIS_BLOCK_MARKER = /^\s*[—–-]\s*GENESIS\s*[—–-]\s*$/iu;
const GENESIS_DATA_LINE = /^\s*GENESIS-DATA:[A-Za-z0-9_-]+\s*$/u;
const GENESIS_METADATA_LINE = /^\s*(?:(?:Приоритет|Priority|Срок|Due|Проект|Project|Теги|Tags|Связанных задач|Linked tasks)\s*:|(?:Создано в|Created in)\s+(?:GENESIS|Google Calendar|Google Tasks)\s*$)/iu;

/**
 * Removes metadata written by older GENESIS builds into visible Google notes.
 * The parser intentionally remains compatible with CRLF and partially edited
 * legacy blocks, while leaving ordinary user-authored text untouched.
 */
export function cleanTaskDescription(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const visible = value.replace(/^GENESIS-CREATE:[a-f0-9]{64}\r?\n?/gm, "");
  const lines = visible.replace(/\r\n?/g, "\n").split("\n");
  const markerIndex = lines.findIndex((line, index) => (
    GENESIS_BLOCK_MARKER.test(line)
    && lines.slice(index + 1).some((candidate) => GENESIS_DATA_LINE.test(candidate) || GENESIS_METADATA_LINE.test(candidate))
  ));
  if (markerIndex >= 0) return lines.slice(0, markerIndex).join("\n").trim();

  const dataIndex = lines.findIndex((line) => GENESIS_DATA_LINE.test(line));
  if (dataIndex < 0) return visible.trim();

  let blockStart = dataIndex;
  while (blockStart > 0) {
    const previous = lines[blockStart - 1];
    if (previous.trim() === "" || GENESIS_METADATA_LINE.test(previous) || GENESIS_BLOCK_MARKER.test(previous)) {
      blockStart -= 1;
      continue;
    }
    break;
  }
  return [...lines.slice(0, blockStart), ...lines.slice(dataIndex + 1)].join("\n").trim();
}
