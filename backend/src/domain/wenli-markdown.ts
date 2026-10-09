interface OpenFence {
  marker: "`" | "~";
  length: number;
}

interface FenceLine {
  prefix: string;
  marker: "`" | "~";
  length: number;
  suffix: string;
  ending: string;
}

/**
 * Repair the one malformed fence suffix observed from generated Wenli JSON.
 *
 * The repair is intentionally narrow: it only changes a lone `n`/`\\n`
 * after a matching fence when there is no later valid CommonMark close. Human
 * messages never pass through this function.
 */
export function normalizeGeneratedWenliMarkdown(source: string): string {
  const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)?.filter(Boolean) ?? [];
  let open: OpenFence | null = null;

  return lines.map((line, index) => {
    const fence = parseFenceLine(line);
    if (!fence) return line;

    if (!open) {
      if (fence.marker === "`" && fence.suffix.includes("`")) return line;
      open = { marker: fence.marker, length: fence.length };
      return line;
    }

    if (fence.marker !== open.marker || fence.length < open.length) return line;
    if (fence.suffix.trim() === "") {
      open = null;
      return line;
    }

    if ((fence.suffix.trim() === "n" || fence.suffix.trim() === "\\n") &&
        !hasValidClosingFence(lines, index + 1, open)) {
      open = null;
      return `${fence.prefix}${fence.marker.repeat(fence.length)}${fence.ending}`;
    }
    return line;
  }).join("");
}

function hasValidClosingFence(lines: string[], start: number, open: OpenFence): boolean {
  let sawProse = false;
  let paragraphBreak = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = parseFenceLine(line);
    if (!fence || fence.marker !== open.marker || fence.length < open.length) {
      if (/[。！？]\s*$/u.test(line)) sawProse = true;
      else if (sawProse && line.trim() === "") paragraphBreak = true;
      continue;
    }
    const suffix = fence.suffix.trim();
    if (suffix !== "") {
      // A new language-labelled block after prose is not the old block's close.
      if (sawProse && suffix !== "n" && suffix !== "\\n") return false;
      continue;
    }
    if (sawProse && paragraphBreak && lines.slice(index + 1).some(later => {
      const candidate = parseFenceLine(later);
      return !!candidate && candidate.marker === open.marker && candidate.length >= open.length && candidate.suffix.trim() === "";
    })) return false;
    return true;
  }
  return false;
}

function parseFenceLine(line: string): FenceLine | null {
  const ending = /\r\n$/u.test(line) ? "\r\n" : /[\r\n]$/u.test(line) ? line.slice(-1) : "";
  const body = ending ? line.slice(0, -ending.length) : line;
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(body);
  if (!match) return null;
  const markerRun = match[2]!;
  return {
    prefix: match[1]!,
    marker: markerRun[0] as "`" | "~",
    length: markerRun.length,
    suffix: match[3]!,
    ending,
  };
}
