import { tutorialMarkdown } from "./markdown";

// A navigation time has at least minutes and seconds. Dates, durations such as
// “1250 毫秒”, and clock times in prose are deliberately outside these rules.
const time = String.raw`\d{1,3}:[0-5]\d(?::[0-5]\d)?(?:[.,]\d{1,3})?(?![\d:]|[.,]\d)`;
const range = new RegExp(String.raw`^\s*\[?${time}\s*(?:-->|→|–|—|-)\s*${time}\]?\s*(?:align:|position:|line:|size:|vertical:).*$|^\s*\[?${time}\s*(?:-->|→|–|—|-)\s*${time}\]?\s*$`, "i");
const stamp = new RegExp(String.raw`^${time}$`);
const decoratedPrefix = new RegExp(String.raw`^(\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-+*]|\d+[.)])\s+)?)\*{0,2}\[${time}\]\*{0,2}\s*(?:[-–—·|：:]\s*)?`);
const rangePrefix = new RegExp(String.raw`^(\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-+*]|\d+[.)])\s+)?)[\[（(]?${time}\s*(?:-->|→|–|—|-)\s*${time}[\]）)]?\s*(?:[·|：:]\s*)?`);
const chapterPrefix = new RegExp(String.raw`^(\s*#{1,6}\s+)\*{0,2}(?:\[|\()?${time}(?:\]|\))?\*{0,2}\s*(?:[-–—·|：:]\s*)?`);
const chapterSuffix = new RegExp(String.raw`\s*[\[（(]${time}[\]）)]\s*$`);
const timelinePrefix = new RegExp(String.raw`^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)\*{0,2}(?:\[|\()?${time}(?:\]|\))?\*{0,2}\s*(?:[-–—·|：:]\s*)?`);
const boldPrefix = new RegExp(String.raw`^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\*\*${time}\*\*\s*(?:[-–—·|：:]\s*)?`);

function factualTimeLabel(text: string): boolean {
  return /(?:比例|配比|稀释|比分|时刻|开会|会议|钟点|时间格式|字符串|ratio|dilution|meeting|clock)/i.test(text);
}

function codeMask(markdown: string): { text: string; restore: (text: string) => string } {
  let prefix = "\u0001bili-article-code-";
  while (markdown.includes(prefix)) prefix += "x";
  const values: string[] = [];
  const save = (value: string) => `${prefix}${values.push(value) - 1}\u0002`;
  let text = "", position = 0;
  while (position < markdown.length) {
    const lineStart = position === 0 || markdown[position - 1] === "\n";
    if (lineStart) {
      const newline = markdown.indexOf("\n", position);
      const end = newline < 0 ? markdown.length : newline + 1;
      const line = markdown.slice(position, end).replace(/\r?\n$/, "");
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*$/);
      if (fence) {
        let cursor = end;
        while (cursor < markdown.length) {
          const nextNewline = markdown.indexOf("\n", cursor);
          const nextEnd = nextNewline < 0 ? markdown.length : nextNewline + 1;
          const boundary = markdown.slice(cursor, nextEnd).match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/);
          cursor = nextEnd;
          if (boundary && boundary[1][0] === fence[1][0] && boundary[1].length >= fence[1].length) break;
        }
        // Keep the final line break outside the token so neighbouring text
        // cannot become a heading or subtitle cue attached to the code token.
        const block = markdown.slice(position, cursor);
        const ending = block.endsWith("\n") ? "\n" : "";
        text += save(ending ? block.slice(0, -1) : block) + ending;
        position = cursor;
        continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        // Keep indentation visible so a continuation of a source footnote is
        // still recognized as belonging to that footnote, rather than prose.
        const indent = line.match(/^[ \t]+/)![0];
        text += indent + save(markdown.slice(position + indent.length, end).replace(/\n$/, "")) + (newline < 0 ? "" : "\n");
        position = end;
        continue;
      }
    }
    if (markdown[position] === "`" && !/(?:^|[^\\])(?:\\\\)*\\$/.test(markdown.slice(0, position))) {
      const ticks = markdown.slice(position).match(/^`+/)![0];
      let cursor = position + ticks.length, closing = -1;
      while (cursor < markdown.length) {
        const found = markdown.indexOf("`", cursor);
        if (found < 0) break;
        const run = markdown.slice(found).match(/^`+/)![0];
        if (run.length === ticks.length) { closing = found + run.length; break; }
        cursor = found + run.length;
      }
      if (closing >= 0) {
        text += save(markdown.slice(position, closing));
        position = closing;
        continue;
      }
    }
    text += markdown[position++];
  }
  return {
    text,
    restore: (value) => value.replace(new RegExp(`${prefix}(\\d+)\u0002`, "g"), (_, index) => values[Number(index)]),
  };
}

function playbackLabel(label: string): string {
  const normalized = label.trim().replace(/^\*\*|\*\*$/g, "");
  if (stamp.test(normalized) || range.test(normalized) || /^(?:回看|回到视频|查看原文|查看来源|回看原文|原文|来源|source)(?:\s*\d+)?(?:\s*[（(\[]?\d[\d:.,]*[）)\]]?)?$/i.test(normalized)) return "";
  return factualTimeLabel(normalized) ? normalized : normalized.replace(new RegExp(String.raw`^[\[（(]?${time}[\]）)]?\s*(?:[-–—·|：:]\s*)?`), "");
}

function isPlaybackUrl(destination: string): boolean {
  try {
    const url = new URL(destination.replace(/^<|>$/g, ""));
    return /(?:^|\.)(?:bilibili\.com|b23\.tv|youtube\.com|youtu\.be)$/i.test(url.hostname) &&
      (Array.from(url.searchParams.keys()).some((key) => /^(?:t|start|time_continue|timestamp)$/i.test(key)) || /^#(?:t=)?\d/.test(url.hash));
  } catch { return false; }
}

/** Export article prose, without subtitle/navigation times or workbench metadata.
 * Code and factual times in normal sentences remain verbatim. This also cleans
 * saved articles made before the article-generation prompt was introduced.
 */
export function articleMarkdown(markdown: string): string {
  const protectedCode = codeMask(tutorialMarkdown(markdown.replace(/^\uFEFF/, "")));
  const lines = protectedCode.text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let timeline = false, sourceFootnote = false;
  const hasSubtitleRanges = lines.some((line) => range.test(line));
  const metadataLines = new Set<number>();
  // “依据” and “覆盖” can also be meaningful prose. Treat them as export
  // metadata only inside a block bearing an unmistakable workbench marker.
  for (let begin = 0; begin < lines.length; begin++) {
    if (!/^\s*>/.test(lines[begin])) continue;
    let end = begin + 1;
    while (end < lines.length && /^\s*>/.test(lines[end])) end++;
    const block = lines.slice(begin, end);
    if (block.some((line) => /^\s*>\s*(?:完整整理\s*·\s*来源：|全文\s*[\d,]+\s*字\s*·\s*分\s*\d+\s*段整理|整理方式：(?:完整文稿|学习笔记|简短摘要)|生成时间：\s*\d{4}[年/.-])/.test(line))) {
      for (let cursor = begin; cursor < end; cursor++) {
        if (/^\s*>\s*(?:完整整理\s*·\s*来源：|全文\s*[\d,]+\s*字\s*·\s*分\s*\d+\s*段整理|(?:原视频|所属视频|整理方式|生成时间|覆盖|依据|来源)：)/.test(lines[cursor])) metadataLines.add(cursor);
      }
    }
    begin = end - 1;
  }
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (/^\[\^source-\d+\]:/.test(line)) { sourceFootnote = true; continue; }
    if (sourceFootnote) {
      if (/^(?: {2,}|\t)/.test(line)) continue;
      if (!line.trim()) continue;
      sourceFootnote = false;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      timeline = /^(?:视频|章节|内容)?(?:时间线|时间轴|时间导航|时间目录)(?:\s*[（(].*[）)])?$/.test(heading[1]);
      if (timeline) continue;
    }
    if (range.test(line)) continue;
    // SRT cue numbers are structural only when the following cue is timed.
    if (/^\s*\d+\s*$/.test(line)) {
      const next = lines.slice(index + 1).find((value) => value.trim());
      if (next !== undefined && range.test(next)) continue;
    }
    if (/^\s*WEBVTT(?:\s.*)?$/i.test(line) && hasSubtitleRanges) continue;
    if (hasSubtitleRanges && /^(?:Kind:\s*captions|Language:\s*[\w-]+)\s*$/i.test(line)) continue;
    if (metadataLines.has(index) || /^\s*>\s*(?:来源|原视频)：\s*https?:\/\//.test(line)) continue;
    if (/^\s*(?:生成时间|处理时间|整理时间)：\s*\d{4}[年/.-]/.test(line)) continue;
    line = line.replace(/(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g, (match, label: string, destination: string) => {
      if (/^source:\d+$/.test(destination) || isPlaybackUrl(destination)) return playbackLabel(label);
      if (stamp.test(label.trim()) && /^(?:回看|查看原文|原文)[:#]/.test(destination)) return "";
      return match;
    });
    line = line.replace(/\[\^source-\d+\]/g, "").replace(/[（(]原文\s+\d+[）)]/g, "");
    const factualHeading = !!heading && factualTimeLabel(heading[1]);
    if (!factualHeading) line = line.replace(rangePrefix, "$1").replace(chapterPrefix, "$1");
    line = line.replace(decoratedPrefix, "$1").replace(boldPrefix, "$1");
    if (heading && !factualHeading) line = line.replace(chapterSuffix, "");
    if (timeline) line = line.replace(timelinePrefix, "$1");
    // Citation-like times attached to sentence punctuation are navigation,
    // whereas a time format being discussed inside a sentence is substantive.
    line = line.replace(new RegExp(String.raw`([。！？.!?])(?:\s*\[${time}\](?!\())+`, "g"), "$1");
    line = line.replace(new RegExp(String.raw`\[${time}\](?=[。！？.!?](?:\s|$))`, "g"), "");
    if (new RegExp(String.raw`^\s*\[${time}\]\s*$`).test(line)) continue;
    if (/^\s*(?:#{1,6}|[-+*]|\d+[.)])\s*$/.test(line)) continue;
    result.push(line.replace(/[ \t]+$/, ""));
  }
  const cleaned = result.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  return protectedCode.restore(cleaned) + (cleaned ? "\n" : "");
}
