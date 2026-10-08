export interface SourceCue {
  id: string;
  text: string;
  start?: number;
  end?: number;
}

export interface SourceEvidence {
  kind: "manual" | "subtitle" | "automatic";
  label: string;
  coverage: "full" | "partial" | "unknown";
  totalCharacters?: number;
  analyzedCharacters?: number;
  limitation?: string;
  cues: SourceCue[];
}

export const SOURCE_CHUNK_CHARACTERS = 20000;

function seconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function clock(value: string): number | undefined {
  const match = value.match(/^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
    return undefined;
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number((match[4] || "").padEnd(3, "0")) / 1000
  );
}

function timing(line: string): { start: number; end: number } | undefined {
  const match = line.trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
  if (!match) return undefined;
  const start = clock(match[1]),
    end = clock(match[2]);
  return start !== undefined && end !== undefined && end >= start
    ? { start, end }
    : undefined;
}

function captionText(text: string): string {
  return text
    .replace(
      /<\/?(?:b|i|u|c(?:\.[\w-]+)*|v(?:\s+[^>]+)?|lang(?:\s+[^>]+)?)>/gi,
      "",
    )
    .replace(/<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "")
    .replace(
      /&(?:amp|lt|gt|nbsp|quot|#39);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
          "&quot;": '"',
          "&#39;": "'",
        })[entity] || entity,
    )
    .trim();
}

function addCue(
  cues: SourceCue[],
  text: string,
  time?: { start: number; end?: number },
) {
  const value = text.trim();
  if (!value) return;
  cues.push({ id: String(cues.length + 1), text: value, ...time });
}

/** Parse real SRT/VTT timing; ordinary text never receives an invented timestamp. */
export function parseTranscript(input: string): SourceCue[] {
  const text = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return [];
  const blocks = text.split(/\n[\t ]*\n+/);
  const timed = blocks.some((block) =>
    block.split("\n").some((line) => timing(line)),
  );
  const cues: SourceCue[] = [];
  for (const block of blocks) {
    if (timed && /^(?:NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block))
      continue;
    const lines = block.split("\n");
    if (timed && /^WEBVTT(?:\s|$)/.test(lines[0])) {
      const firstCue = lines.findIndex((line) => timing(line));
      if (firstCue < 0) continue;
      lines.splice(0, firstCue);
    }
    let foundTime = false;
    for (let index = 0; index < lines.length; index++) {
      const time = timing(lines[index]);
      if (!time) continue;
      foundTime = true;
      let end = index + 1;
      while (end < lines.length && !timing(lines[end])) end++;
      const body = lines.slice(index + 1, end);
      // Also accept SRT files whose numbered cues have no blank line between them.
      if (
        end < lines.length &&
        /^\d+$/.test(body[body.length - 1]?.trim() || "")
      )
        body.pop();
      addCue(cues, captionText(body.join("\n")), time);
      index = end - 1;
    }
    if (!foundTime) {
      // Keep malformed timestamp blocks as text, without claiming they are timed.
      addCue(cues, block);
    }
  }
  return cues;
}

/** Bilibili subtitle fields are seconds; discard invalid timing, never the words. */
export function platformSourceCues(body: unknown): SourceCue[] {
  if (!Array.isArray(body)) return [];
  const cues: SourceCue[] = [];
  for (const row of body) {
    if (!row || typeof row.content !== "string") continue;
    const start = seconds(row.from),
      end = seconds(row.to);
    addCue(
      cues,
      captionText(row.content),
      start === undefined
        ? undefined
        : { start, ...(end !== undefined && end >= start ? { end } : {}) },
    );
  }
  return cues;
}

/** BibiGPT's OpenAPI defines startTime and end in seconds. Do not infer other fields. */
export function automaticSourceCues(body: unknown): SourceCue[] {
  if (!Array.isArray(body)) return [];
  return platformSourceCues(
    body
      .filter((row) => row && typeof row.text === "string")
      .map((row) => ({ content: row.text, from: row.startTime, to: row.end })),
  );
}

export function validTranscriptOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value % SOURCE_CHUNK_CHARACTERS === 0
  );
}

/** Coverage describes the supplied subtitle text, not independently verified video coverage. */
export function buildSourceEvidence(
  cues: SourceCue[],
  kind: SourceEvidence["kind"],
  label: string,
  offset = 0,
): SourceEvidence {
  if (!validTranscriptOffset(offset))
    throw new Error("字幕范围无效，请重新选择分析片段。");
  const total = cues.map((cue) => cue.text).join("\n").length;
  if (!total) throw new Error("字幕中没有可分析的文字，请检查内容后重试。");
  if (offset >= total)
    throw new Error("所选片段超出了当前字幕范围，请选择前一段后重试。");
  const end = Math.min(total, offset + SOURCE_CHUNK_CHARACTERS);
  let cursor = 0;
  const selected: SourceCue[] = [];
  for (const cue of cues) {
    const cueEnd = cursor + cue.text.length;
    if (cueEnd > offset && cursor < end) {
      const text = cue.text.slice(
        Math.max(0, offset - cursor),
        Math.min(cue.text.length, end - cursor),
      );
      if (text.trim()) selected.push({ ...cue, text });
    }
    cursor = cueEnd + 1;
    if (cursor >= end) break;
  }
  const full = offset === 0 && end === total;
  return {
    kind,
    label,
    coverage: full ? "full" : "partial",
    totalCharacters: total,
    analyzedCharacters: end - offset,
    limitation: full
      ? "已分析当前所提供的全部字幕；字幕是否覆盖整段视频仍取决于来源。"
      : `本次仅分析所提供字幕的第 ${offset + 1}–${end} 字符（共 ${total} 字符），其余内容尚未分析。`,
    cues: selected,
  };
}

export function automaticSourceEvidence(): SourceEvidence {
  return {
    kind: "automatic",
    label: "自动提取的视频摘要",
    coverage: "unknown",
    limitation:
      "自动服务未提供本次摘要所依据的可核验原文，无法确认覆盖范围或定位具体片段。",
    cues: [],
  };
}

export function sourcePrompt(evidence: SourceEvidence): string {
  return JSON.stringify(
    evidence.cues.map(({ id, text, start, end }) => ({
      id,
      text,
      ...(start !== undefined ? { start, end } : {}),
    })),
  );
}
