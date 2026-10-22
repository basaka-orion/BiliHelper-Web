import { tutorialMarkdown } from "./markdown";

export interface FullDocumentSection {
  index: number;
  markdown: string;
  cueIds: string[];
  warning?: string;
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

export function assembleFullDocument(input: FullDocumentInput): string {
  const sections = input.sections
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((section) => ({ ...section, markdown: cleanSection(section.markdown) }))
    .filter((section) => section.markdown);
  if (!sections.length) throw new Error("还没有可合并的文档段落。");
  if (!input.partial && sections.some((section, index) => section.index !== index || !!section.warning))
    throw new Error("文档包含缺失或未完整输出的段落，请继续整理后再合并。");
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

/** Stable human-readable name for a downloaded Markdown file. */
export function markdownFileName(title: string, suffix: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "视频";
  return `${safe}-${suffix}.md`;
}
