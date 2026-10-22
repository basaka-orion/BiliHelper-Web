import type { SourceCue } from "./learning-source";
import { buildArticleEditUnits, removeArticleFiller } from "./article-edit";
import { articleMarkdown } from "./article-export";

export interface MindMapNode {
  id: string;
  text: string;
  sourceIds: string[];
  children: MindMapNode[];
}

export interface MindMapSection {
  version: 1;
  nodes: MindMapNode[];
  sourceIds: string[];
  fallback: boolean;
}

export interface MindMapUnit {
  id: string;
  text: string;
  sourceIds: string[];
  verbatim?: true;
}

/** Short readable detail leaves. Quoted examples and inline code remain indivisible. */
function detailParts(text: string): string[] {
  const parts: string[] = [];
  const quotes: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』" };
  let start = 0, quote = "", ticks = "";
  const append = (end: number) => {
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (ticks) {
      if (text.startsWith(ticks, index) && text[index - 1] !== "`" && text[index + ticks.length] !== "`") {
        index += ticks.length - 1;
        ticks = "";
      }
      continue;
    }
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "`") {
      ticks = text.slice(index).match(/^`+/)![0];
      index += ticks.length - 1;
      continue;
    }
    if (quotes[character] && !(character === "'" && /[A-Za-z0-9]/.test(text[index - 1] || ""))) {
      quote = quotes[character];
      continue;
    }
    const length = index + 1 - start;
    const sentence = /[。！？!?；;]/.test(character) || (character === "." && (index + 1 === text.length || /\s/.test(text[index + 1])));
    const soft = /[，,、\n\t ]/.test(character);
    if ((character === "\n" && text[index + 1] === "\n") || (length >= 80 && sentence) || (length >= 150 && soft) ||
        (length >= 180 && !/[A-Za-z0-9_./:@%+~=-]/.test(character + (text[index + 1] || ""))))
      append(index + 1);
  }
  append(text.length);
  return parts;
}

/** Every substantive character comes from the actual source, never a model summary. */
export function buildMindMapUnits(cues: SourceCue[]): MindMapUnit[] {
  const units: MindMapUnit[] = [];
  let joined = "";
  const spans = cues.map((cue) => {
    if (joined) joined += "\n\n";
    const start = joined.length;
    joined += cue.text;
    return { id: cue.id, start, end: joined.length };
  });
  let cursor = 0, spanCursor = 0;
  for (const source of buildArticleEditUnits(cues)) {
    const sourceStart = joined.indexOf(source.text, cursor);
    let partCursor = sourceStart;
    for (const part of source.verbatim ? [source.text] : detailParts(source.text)) {
      const start = joined.indexOf(part, partCursor);
      const end = start + part.length;
      partCursor = end;
      const text = source.verbatim ? part : removeArticleFiller(part);
      if (!text.trim()) continue;
      while (spanCursor < spans.length && spans[spanCursor].end <= start) spanCursor++;
      const sourceIds: string[] = [];
      for (let index = spanCursor; index < spans.length && spans[index].start < end; index++)
        sourceIds.push(spans[index].id);
      units.push({ id: `u${units.length + 1}`, text, sourceIds,
        ...(source.verbatim ? { verbatim: true as const } : {}) });
    }
    cursor = sourceStart + source.text.length;
  }
  return units;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const unique = (values: string[]) => Array.from(new Set(values));
const compact = (value: string) => value.replace(/\s+/g, "");
const categories = new Set(["概念", "定义", "原理", "操作步骤", "步骤", "实例", "例子", "条件", "注意事项", "结论", "限制", "参数", "命令", "原因", "结果", "背景", "原文细节"]);

/** Validate only the model's organization; all detail leaves are restored from source. */
export function buildMindMapSection(
  value: unknown,
  units: MindMapUnit[],
  sectionIndex = 1,
): MindMapSection {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const position = new Map(units.map((unit, index) => [unit.id, index]));
  const used = new Set<string>();
  let fallback = false, sequence = 0, visited = 0;
  const id = () => `s${sectionIndex}-n${++sequence}`;
  const leaf = (unit: MindMapUnit): MindMapNode => ({ id: id(), text: unit.text,
    sourceIds: [...unit.sourceIds], children: [] });
  const label = (text: string) => articleMarkdown(text).replace(/^\s*(?:`{3,}|~{3,})[^\n]*\n/, "")
    .split(/[。！？!?；;，,:：\n]/).find((part) => part.trim())?.replace(/\s+/g, " ").slice(0, 36).trim() || "原文细节";
  const readBranch = (input: unknown, depth: number): { node: MindMapNode; first: number; unitIds: string[] } | undefined => {
    if (!record(input) || depth > 3 || ++visited > Math.max(40, units.length * 4)) {
      fallback = true;
      return;
    }
    if (Object.keys(input).some((key) => !["title", "unitIds", "children"].includes(key))) fallback = true;
    const direct: { node: MindMapNode; first: number; unitIds: string[] }[] = [];
    if (input.unitIds !== undefined && !Array.isArray(input.unitIds)) fallback = true;
    for (const rawId of Array.isArray(input.unitIds) ? input.unitIds : []) {
      if (typeof rawId !== "string" || !byId.has(rawId) || used.has(rawId)) { fallback = true; continue; }
      used.add(rawId);
      direct.push({ node: leaf(byId.get(rawId)!), first: position.get(rawId)!, unitIds: [rawId] });
    }
    if (input.children !== undefined && !Array.isArray(input.children)) fallback = true;
    for (const child of Array.isArray(input.children) ? input.children : []) {
      const branch = readBranch(child, depth + 1);
      if (branch) direct.push(branch);
    }
    direct.sort((a, b) => a.first - b.first);
    if (!direct.length) { fallback = true; return; }
    const unitIds = direct.flatMap((child) => child.unitIds);
    const original = unitIds.map((unitId) => byId.get(unitId)!.text).join("\n");
    const proposed = typeof input.title === "string" ? input.title.trim() : "";
    const grounded = proposed.length > 0 && proposed.length <= 60 &&
      (categories.has(proposed) || compact(original).includes(compact(proposed)));
    if (!grounded) fallback = true;
    return { node: { id: id(), text: grounded ? proposed : label(byId.get(unitIds[0])!.text),
      sourceIds: unique(direct.flatMap((child) => child.node.sourceIds)), children: direct.map((child) => child.node) },
      first: direct[0].first, unitIds };
  };
  const branches: { node: MindMapNode; first: number; unitIds: string[] }[] = [];
  if (!record(value) || !Array.isArray(value.branches)) fallback = units.length > 0;
  else {
    if (Object.keys(value).some((key) => key !== "branches")) fallback = true;
    for (const input of value.branches) {
      const branch = readBranch(input, 1);
      if (branch) branches.push(branch);
    }
  }
  const missing = units.filter((unit) => !used.has(unit.id));
  if (missing.length) {
    fallback = true;
    // Bounded source branches keep a failed model response navigable instead of hiding detail.
    for (let offset = 0; offset < missing.length; offset += 12) {
      const group = missing.slice(offset, offset + 12);
      branches.push({ node: { id: id(), text: label(group[0].text), sourceIds: unique(group.flatMap((unit) => unit.sourceIds)),
        children: group.map(leaf) }, first: position.get(group[0].id)!, unitIds: group.map((unit) => unit.id) });
    }
  }
  branches.sort((a, b) => a.first - b.first);
  return { version: 1, nodes: branches.map((branch) => branch.node),
    sourceIds: unique(units.flatMap((unit) => unit.sourceIds)), fallback };
}
