export interface SrtEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

/**
 * Parses an SRT formatted string into structured SrtEntry objects.
 */
export function parseSrt(srtText: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const line0 = lines[0];
    if (!line0) continue;

    // Check if first line is ID (number)
    const idMatch = line0.trim().match(/^(\d+)$/);
    if (!idMatch) continue;

    const rawId = idMatch[1];
    if (!rawId) continue;

    const id = Number.parseInt(rawId, 10);
    const timeLineIndex = 1;
    const timeLine = lines[timeLineIndex];
    if (!timeLine) continue;

    const timeMatch = timeLine.match(
      /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );

    if (!timeMatch) continue;

    const rawStart = timeMatch[1];
    const rawEnd = timeMatch[2];
    if (!rawStart || !rawEnd) continue;

    const startTime = rawStart.replace(".", ",");
    const endTime = rawEnd.replace(".", ",");
    const text = lines
      .slice(timeLineIndex + 1)
      .join("\n")
      .trim();

    entries.push({ id, startTime, endTime, text });
  }

  return entries;
}

/**
 * Converts structured SrtEntry objects back into an SRT formatted string.
 */
export function stringifySrt(entries: SrtEntry[]): string {
  return `${entries
    .map((entry, index) => {
      const id = entry.id || index + 1;
      return `${id}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`;
    })
    .join("\n\n")}\n`;
}
