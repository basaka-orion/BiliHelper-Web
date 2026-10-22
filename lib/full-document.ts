import { tutorialMarkdown } from "./markdown";

export interface FullDocumentSection {
  index: number;
  markdown: string;
  cueIds: string[];
  warning?: string;
  omitted?: true;
}

export interface FullDocumentInput {
  title: string;
  partTitle?: string;
  videoUrl: string;
  sourceLabel: string;
  totalCharacters: number;
  sections: FullDocumentSection[];
  generatedAt: number;
  platform?: string;
  page?: number;
  pageCount?: number;
  dateLabel?: string;
  partial?: boolean;
}

function cleanSection(input: string): string {
  let text = tutorialMarkdown(input.replace(/^\uFEFF/, "")).trim();
  // A model may still return one top-level heading; keep the document hierarchy.
  text = text.replace(/^#\s+/, "## ");
  text = text.replace(/^---+\s*\n/, "").replace(/\n\s*---+\s*$/, "").trim();
  return text;
}

/** Collect ## / ### headings outside fenced code blocks. */
export function documentHeadings(markdown: string): { level: 2 | 3; title: string }[] {
  const headings: { level: 2 | 3; title: string }[] = [];
  let fenced = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const title = match[2].replace(/\[([^\]]+)\]\(source:\d+\)/g, "$1").trim();
    if (title) headings.push({ level: match[1].length as 2 | 3, title });
  }
  return headings;
}

function tocFor(sections: FullDocumentSection[]): string {
  const lines: string[] = [];
  for (const section of sections.slice().sort((a, b) => a.index - b.index)) {
    for (const heading of documentHeadings(cleanSection(section.markdown))) {
      lines.push(
        `${heading.level === 2 ? "" : "  "}- ${heading.title}`,
      );
      if (lines.length >= 240) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

function assertContinuousSections(sections: FullDocumentSection[]): void {
  if (sections.some((section, index) => section.index !== index || !!section.warning))
    throw new Error("文档包含缺失或未完整输出的段落，请继续整理后再合并。");
}

export function assembleFullDocument(input: FullDocumentInput): string {
  const sections = input.sections
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((section) => ({ ...section, markdown: cleanSection(section.markdown) }))
    .filter((section) => section.markdown);
  if (!sections.length) throw new Error("还没有可合并的文档段落。");
  if (!input.partial) assertContinuousSections(sections);
  const title = (input.partTitle?.trim() || input.title.trim() || "视频完整文档")
    .replace(/\s+/g, " ");
  const date =
    input.dateLabel ||
    new Date(input.generatedAt).toLocaleDateString("zh-CN");
  const page = input.page && input.page > 1 ? ` · P${input.page}` : "";
  const pages =
    input.pageCount && input.pageCount > 1
      ? ` · 共 ${input.pageCount} 节`
      : "";
  const toc = tocFor(sections);
  const metadata = [
    `> 完整整理 · 来源：${input.sourceLabel || "视频字幕"}`,
    `> 全文 ${input.totalCharacters.toLocaleString("zh-CN")} 字 · 分 ${sections.length} 段整理 · ${date}${page}${pages}`,
    `> 原视频：${input.videoUrl}`,
    input.title && input.title.trim() !== title
      ? `> 所属视频：${input.title.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("  \n");
  const body = sections
    .map((section) => section.markdown)
    .join("\n\n---\n\n");
  const status = input.partial ? "\n\n> 文档尚未整理完成，以上是已经完成的部分。" : "";
  return `# ${title}\n\n${metadata}\n\n## 文档目录\n\n${toc || "- 正在整理"}\n\n---\n\n${body}${status}\n`;
}

/** Live preview while sections are still arriving. */
export function assemblePartialDocument(
  input: Omit<FullDocumentInput, "partial">,
): string {
  return assembleFullDocument({ ...input, partial: true });
}

/** Remove accidental citation decoration without touching code or link labels that are prose. */
function articleSection(markdown: string, title: string): string {
  let fence: { marker: string; length: number } | undefined;
  let inlineTicks = 0;
  const trimBlankLines = (value: string) => value.replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
  const lines = trimBlankLines(tutorialMarkdown(markdown.replace(/^\uFEFF/, ""))).split("\n");
  const cleaned = lines.map((line) => {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (boundary && boundary[1][0] === fence.marker &&
          boundary[1].length >= fence.length && !boundary[2].trim()) fence = undefined;
      return line;
    }
    if (boundary && !inlineTicks) {
      fence = { marker: boundary[1][0], length: boundary[1].length };
      return line;
    }
    if (/^(?: {4}|\t)/.test(line)) return line;
    if (!inlineTicks) {
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading && heading[2].trim() === title) return "";
      if (heading?.[1] === "#") line = `#${line}`;
    }
    // Inline code can cross a line and can use a run of several backticks.
    let output = "", position = 0;
    const tokens = /`+|\[([^\]\n]+)\]\(source:[1-9]\d{0,5}\)/g;
    for (const match of Array.from(line.matchAll(tokens))) {
      output += line.slice(position, match.index);
      if (match[0][0] === "`") {
        if (!inlineTicks) inlineTicks = match[0].length;
        else if (inlineTicks === match[0].length) inlineTicks = 0;
        output += match[0];
      } else if (inlineTicks) output += match[0];
      else {
        const label = match[1].trim();
        output += /^(?:查看原文|查看来源|回看|回看原文|原文|来源|source)(?:\s*\d+)?$/i.test(label)
          ? "" : match[1];
      }
      position = (match.index || 0) + match[0].length;
    }
    return output + line.slice(position);
  });
  // Section separators belong to the processing job, not to the article's prose.
  return trimBlankLines(trimBlankLines(cleaned.join("\n")).replace(/^ {0,3}---+[ \t]*\r?\n/, "")
    .replace(/\n {0,3}---+[ \t]*$/, ""));
}

/** Join already-written article sections directly; never summarize them a second time. */
export function assembleArticle(input: FullDocumentInput): string {
  const sections = input.sections.slice().sort((a, b) => a.index - b.index);
  if (!sections.length) throw new Error("还没有可合并的文稿段落。");
  // Check every acquired range before omitting advertising-only sections.
  if (!input.partial) assertContinuousSections(sections);
  if (sections.some((section) => section.omitted ? !!section.markdown.trim() : !section.markdown.trim()))
    throw new Error("文稿包含缺失或未完整输出的段落，请继续整理后再合并。");
  const title = (input.partTitle?.trim() || input.title.trim() || "视频完整文稿")
    .replace(/\s+/g, " ");
  const body = sections.filter((section) => !section.omitted)
    .map((section) => articleSection(section.markdown, title)).filter(Boolean)
    .join("\n\n");
  if (!body) throw new Error("原文只有寒暄/广告/重复，没有可生成的文稿正文");
  const status = input.partial ? "\n\n> 文稿尚未整理完成，以上是已经完成的部分。" : "";
  return `# ${title}\n\n${body}${status}\n`;
}

export function assemblePartialArticle(
  input: Omit<FullDocumentInput, "partial">,
): string {
  return assembleArticle({ ...input, partial: true });
}

/** Stable human-readable name for a downloaded Markdown file. */
export function markdownFileName(title: string, suffix: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "视频";
  return `${safe}-${suffix}.md`;
}
