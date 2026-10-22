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
export const FULL_SECTION_TARGET_CHARACTERS = 3500;
export const FULL_SECTION_MAX_CHARACTERS = 4500;
export const MAX_TRANSCRIPT_CHARACTERS = 240000;
export const MAX_SOURCE_CUES = 60000;
export const MAX_SECTION_REQUEST_CHARACTERS = 30000;

export function sourceCharacterCount(cues: SourceCue[]): number {
  return cues.map((cue) => cue.text).join("\n").length;
}

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

/** Validate cues sent by the client for one full-document section. */
export function readSourceCues(
  value: unknown,
  maximum = MAX_SECTION_REQUEST_CHARACTERS,
): SourceCue[] {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_CUES)
    throw new Error("本次来源片段数量无效，请重新整理完整文档。");
  const cues: SourceCue[] = [];
  const ids = new Set<string>();
  let characters = 0;
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("本次来源片段格式无效，请重新整理完整文档。");
    const item = row as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !/^[1-9]\d{0,5}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.text !== "string" ||
      !item.text.trim()
    )
      throw new Error("本次来源片段格式无效，请重新整理完整文档。");
    characters += item.text.length;
    if (characters > maximum)
      throw new Error("本次来源片段超出单段整理范围，请重新分段。");
    const cue: SourceCue = { id: item.id, text: item.text };
    if (seconds(item.start) !== undefined) cue.start = item.start as number;
    if (
      seconds(item.end) !== undefined &&
      (cue.start === undefined || (item.end as number) >= cue.start)
    )
      cue.end = item.end as number;
    cues.push(cue);
    ids.add(cue.id);
  }
  if (!cues.length)
    throw new Error("本次来源没有可分析的文字，请检查字幕后重试。");
  return cues;
}

/** Re-number cues and split very long blocks so each model request stays bounded. */
export function normalizeFullSourceCues(
  cues: SourceCue[],
  maximum = FULL_SECTION_MAX_CHARACTERS,
): SourceCue[] {
  const normalized: SourceCue[] = [];
  let nextId = 1;
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    if (text.length <= maximum) {
      normalized.push({
        id: String(nextId++),
        text,
        ...(cue.start !== undefined ? { start: cue.start } : {}),
        ...(cue.end !== undefined ? { end: cue.end } : {}),
      });
      continue;
    }
    for (let offset = 0; offset < text.length; offset += maximum) {
      const part = text.slice(offset, offset + maximum);
      const first = offset === 0;
      const last = offset + maximum >= text.length;
      normalized.push({
        id: String(nextId++),
        text: part,
        ...(first && cue.start !== undefined ? { start: cue.start } : {}),
        ...(last && cue.end !== undefined ? { end: cue.end } : {}),
      });
    }
  }
  if (!normalized.length)
    throw new Error("字幕中没有可整理的文字，请检查内容后重试。");
  if (normalized.length > MAX_SOURCE_CUES)
    throw new Error(
      `字幕片段过多（${normalized.length} 条），请减少空行后重新粘贴，或分段整理。`,
    );
  const characters = sourceCharacterCount(normalized);
  if (characters > MAX_TRANSCRIPT_CHARACTERS)
    throw new Error(
      `本次字幕共 ${characters} 字符，超过完整整理上限 ${MAX_TRANSCRIPT_CHARACTERS} 字符。请分段粘贴后分别整理。`,
    );
  return normalized;
}

/** Split normalized cues into ordered model requests without dropping or duplicating text. */
export function chunkSourceCues(
  cues: SourceCue[],
  target = FULL_SECTION_TARGET_CHARACTERS,
  maximum = FULL_SECTION_MAX_CHARACTERS,
): SourceCue[][] {
  if (!Number.isSafeInteger(target) || target < 1000)
    throw new Error("分段大小无效。");
  if (!Number.isSafeInteger(maximum) || maximum < target)
    throw new Error("分段上限无效。");
  const chunks: SourceCue[][] = [];
  let current: SourceCue[] = [];
  let characters = 0;
  for (const cue of cues) {
    if (cue.text.length > maximum)
      throw new Error("存在超长字幕片段，请重新读取字幕后重试。");
    const addition = cue.text.length + (current.length ? 1 : 0);
    if (current.length && characters + addition > maximum) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(cue);
    characters += cue.text.length + (current.length > 1 ? 1 : 0);
    if (characters >= target) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
  }
  if (current.length) chunks.push(current);
  if (!chunks.length) throw new Error("字幕中没有可整理的文字。");
  return chunks;
}

/** Full evidence keeps every supplied cue so every citation and the export can be checked. */
export function buildFullEvidence(
  cues: SourceCue[],
  kind: SourceEvidence["kind"],
  label: string,
): SourceEvidence {
  const total = sourceCharacterCount(cues);
  if (!total) throw new Error("字幕中没有可分析的文字，请检查内容后重试。");
  if (cues.length > MAX_SOURCE_CUES)
    throw new Error(
      `字幕片段过多（${cues.length} 条），请减少空行后重试，或分段整理。`,
    );
  if (total > MAX_TRANSCRIPT_CHARACTERS)
    throw new Error(
      `本次字幕共 ${total} 字符，超过完整整理上限 ${MAX_TRANSCRIPT_CHARACTERS} 字符。`,
    );
  return {
    kind,
    label,
    coverage: "full",
    totalCharacters: total,
    analyzedCharacters: total,
    limitation:
      "已整理当前所提供的全部字幕；字幕是否覆盖整段视频仍取决于来源，且未核验视频画面。",
    cues,
  };
}

/** Evidence sent for one section; ids stay global so citations remain unique in the final document. */
export function buildFullSectionEvidence(
  cues: SourceCue[],
  kind: SourceEvidence["kind"],
  label: string,
  index: number,
  totalSections: number,
): SourceEvidence {
  const total = sourceCharacterCount(cues);
  if (!total) throw new Error("本段没有可分析的文字。");
  const single = totalSections === 1;
  return {
    kind,
    label,
    coverage: single ? "full" : "partial",
    totalCharacters: total,
    analyzedCharacters: total,
    limitation: single
      ? "本次整理覆盖当前提供的全部字幕。"
      : `本段是完整文档的第 ${index}/${totalSections} 段，仅覆盖本段所提供的字幕。`,
    cues,
  };
}

export function cuesToPlainText(cues: SourceCue[]): string {
  return cues.map((cue) => cue.text).join("\n");
}

function srtClock(secondsValue: number): string {
  const milliseconds = Math.max(0, Math.round(secondsValue * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

/** Export SRT only when every cue has real timing; never invent timestamps. */
export function cuesToSrt(cues: SourceCue[]): string | undefined {
  if (!cues.length || cues.some((cue) => cue.start === undefined || cue.end === undefined)) return;
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtClock(cue.start!)} --> ${srtClock(cue.end!)}\n${cue.text}`,
    )
    .join("\n\n");
}
