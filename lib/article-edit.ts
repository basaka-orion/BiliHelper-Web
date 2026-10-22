import type { SourceCue } from "./learning-source";

export interface ArticleEditUnit {
  id: string;
  text: string;
  sourceIds: string[];
  verbatim?: true;
}

interface ProtectedRange {
  start: number;
  end: number;
  block?: true;
}

/** Protect examples before considering punctuation or removable speech. */
function protectedRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (let index = 0; index < text.length;) {
    if (index === 0 || text[index - 1] === "\n") {
      const opening = text.slice(index).match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
      if (opening) {
        const marker = opening[1][0];
        const width = opening[1].length;
        let end = index + opening[0].length;
        while (end < text.length) {
          const next = text.indexOf("\n", end);
          const lineEnd = next < 0 ? text.length : next + 1;
          const closing = text.slice(end, lineEnd).match(/^ {0,3}(`+|~+)[ \t]*(?:\n|$)/);
          if (closing && closing[1][0] === marker && closing[1].length >= width) {
            end = lineEnd;
            break;
          }
          end = lineEnd;
        }
        ranges.push({ start: index, end, block: true });
        index = end;
        continue;
      }
    }
    if (text[index] === "`") {
      const marker = text.slice(index).match(/^`+/)![0];
      let end = index + marker.length;
      let closing = -1;
      while ((closing = text.indexOf(marker, end)) >= 0) {
        end = closing + marker.length;
        if (text[closing - 1] !== "`" && text[end] !== "`") break;
      }
      end = closing < 0 ? text.length : end;
      ranges.push({ start: index, end });
      index = end;
      continue;
    }
    const quotes: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』" };
    const quote = quotes[text[index]];
    if (quote && !(text[index] === "'" && /[A-Za-z0-9]/.test(text[index - 1] || ""))) {
      let end = index + 1;
      while (end < text.length && (text[end] !== quote || text[end - 1] === "\\")) end++;
      // An unmatched quote may be an incomplete technical example; preserve the rest.
      end = Math.min(end + 1, text.length);
      ranges.push({ start: index, end });
      index = end;
      continue;
    }
    index++;
  }
  return ranges;
}

function sentences(text: string): { start: number; end: number }[] {
  const ranges = protectedRanges(text);
  const result: { start: number; end: number }[] = [];
  let start = 0;
  let rangeIndex = 0;
  for (let index = 0; index < text.length; index++) {
    const range = ranges[rangeIndex];
    if (range && index >= range.start) {
      index = range.end - 1;
      rangeIndex++;
      continue;
    }
    const punctuation = /[。！？!?；;]/.test(text[index]) ||
      (text[index] === "." && (index + 1 === text.length || /\s/.test(text[index + 1])));
    const paragraph = text[index] === "\n" && text[index + 1] === "\n";
    if (punctuation || paragraph) {
      const end = index + (paragraph ? 2 : 1);
      result.push({ start, end });
      start = end;
      if (paragraph) index++;
    }
  }
  if (start < text.length) result.push({ start, end: text.length });
  return result;
}

function pureFiller(text: string): boolean {
  if (protectedRanges(text).length) return false;
  const clauses = text.trim().replace(/[。！？!?；;，,、\s]+$/g, "")
    .split(/[。！？!?；;，,、\n]+/).map((part) => part.trim()).filter(Boolean);
  if (!clauses.length) return false;
  return clauses.every((clause) => {
    const value = clause.replace(/^(?:先|也|再次|最后|那么|那)(?=谢谢|感谢|请|记得|欢迎)/, "");
    const promotionalContext = /喜欢|大家|各位|帮忙|帮我|给我|顺手|动动小手|一键三连|(?:点赞|点个赞|点一下赞).*(?:关注|订阅)|(?:关注|订阅).*点赞/.test(value);
    return /^(?:大家|各位|朋友们|同学们|观众朋友们|小伙伴们)好(?:啊|呀|哦)?$/.test(value) ||
      /^(?:谢谢|感谢)(?:大家|各位|你|您|你们)?(?:的)?(?:观看|收看|收听|支持|陪伴)$/.test(value) ||
      (promotionalContext && /^(?:如果)?(?:喜欢(?:这个视频|本期视频)?(?:的话)?)?(?:大家|各位)?(?:请|还请|记得|别忘了|欢迎|麻烦大家|希望大家)?(?:大家|各位)?(?:帮忙|帮我|给我|顺手|动动小手)?(?:点个赞|点一下赞|点赞|关注|订阅|转发|收藏|一键三连)(?:(?:并|和|再|及|加)?(?:点赞|关注|订阅|转发|收藏|一键三连))*(?:一下|哦|呀|吧|哟)?$/.test(value)) ||
      /^(?:我们)?(?:下期再见|下次见|再见|拜拜)$/.test(value) ||
      /^(?:本期视频|今天|这期视频)(?:就)?到这里$/.test(value) ||
      /^(?:嗯|啊|呃|额|哦|好的|那么|就是这样)+$/.test(value);
  });
}

/** Remove only whole, confidently empty sentences; quoted and code examples survive. */
export function removeArticleFiller(text: string): string {
  return sentences(text).map(({ start, end }) => {
    const sentence = text.slice(start, end);
    return pureFiller(sentence) ? "" : sentence;
  }).join("").trim();
}

/** Stable source order, with 400–600 character prose units and indivisible code blocks. */
export function buildArticleEditUnits(cues: SourceCue[]): ArticleEditUnit[] {
  let text = "";
  const sources: { id: string; start: number; end: number }[] = [];
  for (const cue of cues) {
    if (text) text += "\n\n";
    const start = text.length;
    text += cue.text;
    sources.push({ id: cue.id, start, end: text.length });
  }
  const blocks = protectedRanges(text).filter((range) => range.block);
  const units: ArticleEditUnit[] = [];
  const append = (start: number, end: number, verbatim = false) => {
    const raw = text.slice(start, end);
    const value = verbatim ? raw : raw.trim();
    if (!value.trim()) return;
    units.push({
      id: `u${units.length + 1}`,
      text: value,
      sourceIds: sources.filter((source) => source.start < end && source.end > start).map((source) => source.id),
      ...(verbatim ? { verbatim: true as const } : {}),
    });
  };
  const prose = (start: number, end: number) => {
    const parts = sentences(text.slice(start, end));
    let unitStart = start;
    let unitEnd = start;
    for (const part of parts) {
      const nextEnd = start + part.end;
      if (unitEnd > unitStart && nextEnd - unitStart > 600) {
        append(unitStart, unitEnd);
        unitStart = unitEnd;
      }
      unitEnd = nextEnd;
      if (unitEnd - unitStart >= 400) {
        append(unitStart, unitEnd);
        unitStart = unitEnd;
      }
    }
    append(unitStart, unitEnd);
  };
  let cursor = 0;
  for (const block of blocks) {
    prose(cursor, block.start);
    append(block.start, block.end, true);
    cursor = block.end;
  }
  prose(cursor, text.length);
  if (!units.length) throw new Error("没有可编辑的原文单元，请重新读取来源。");
  return units;
}

/** Normalize layout only; code, quotes, decimals, operators and case stay significant. */
function duplicateText(text: string): string {
  const ranges = protectedRanges(text);
  let result = "", cursor = 0;
  for (const range of ranges) {
    result += text.slice(cursor, range.start).replace(/\s+/g, "");
    result += text.slice(range.start, range.end);
    cursor = range.end;
  }
  return result + text.slice(cursor).replace(/\s+/g, "");
}

/** A substring inside a different sentence is not evidence that a full unit was retained. */
function previousContextContainsUnit(context: string, canonical: string): boolean {
  const parts = sentences(context).map(({ start, end }) => context.slice(start, end));
  // The client takes the last 2400 characters. Its first fragment may have lost a negation.
  if (context.length >= 2400) parts.shift();
  for (let start = 0; start < parts.length; start++) {
    let candidate = "";
    for (let end = start; end < parts.length; end++) {
      candidate += parts[end];
      const normalized = duplicateText(candidate);
      if (normalized === canonical) return true;
      if (normalized.length >= canonical.length) break;
    }
  }
  return false;
}

function protectedTokens(text: string): string[] {
  const tokens = protectedRanges(text).map((range) => `example:${text.slice(range.start, range.end)}`);
  const patterns = [
    /[+-]?\d+(?:\.\d+)*(?:[eE][+-]?\d+)?(?:%|‰)?(?:[ \t]*(?:毫秒|微秒|纳秒|分钟|小时|秒|天|MiB|GiB|KiB|MB|GB|KB|ms))?/g,
    /[A-Za-z_][A-Za-z0-9_./:@+%-]*(?:=[A-Za-z0-9_./:@+%-]+)?/g,
    /(?:https?:\/\/|\.{1,2}\/|~\/|\/|[A-Za-z]:\\)[A-Za-z0-9_./\\:@%+~=-]+/g,
    /--[A-Za-z0-9][A-Za-z0-9_-]*(?:=[^\s，。；;！!？?]+)?/g,
    /<=|>=|===|==|!==|!=|<|>|≤|≥|≠/g,
    /严格少于|严格大于|正好等于|不少于|不多于|至少|至多|只有|才能|才允许|必须|禁止|不得|不允许|不能|不包括|不是|而不是|不要|不保证|不等于|小于等于|大于等于|小于|大于|少于|超过|低于|高于|等于/g,
  ];
  patterns.forEach((pattern, index) => {
    for (const token of text.match(pattern) || [])
      tokens.push(`${index}:${index === 0 ? token.replace(/[ \t]+/g, "") : token}`);
  });
  return Array.from(new Set(tokens));
}

function assertEditedText(source: string, edited: string, id: string): void {
  const baseline = removeArticleFiller(source);
  const output = removeArticleFiller(edited);
  if (!output) throw new Error(`文稿单元 ${id} 被改成空白，尚未整理完整，请重试。`);
  const retained = new Set(protectedTokens(output));
  const missing = protectedTokens(baseline).find((token) => !retained.has(token));
  if (missing) throw new Error(`文稿单元 ${id} 丢失了原文中的数字、代码、命令或限制，尚未整理完整，请重试。`);
  const compact = (value: string) => value.replace(/[\s，,。.!！?？；;：:、]/g, "");
  if (compact(output) !== compact(baseline))
    throw new Error(`文稿单元 ${id} 的实质文字发生删改，只允许修正标点和分段，请保留原文后重试。`);
}

/** Validate the complete ledger before any model JSON or unchecked prose reaches the UI. */
export function applyArticleEdits(
  value: unknown,
  units: ArticleEditUnit[],
  previousContext = "",
): { text: string; noContent: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "edits") ||
      !Array.isArray((value as { edits?: unknown }).edits))
    throw new Error("文稿编辑账本格式无效，请重试当前段。");
  const edits = (value as { edits: unknown[] }).edits;
  if (edits.length !== units.length)
    throw new Error("文稿编辑账本遗漏了原文单元，尚未整理完整，请重试当前段。");
  const rendered: string[] = [];
  const kept = new Map<string, string>();
  for (let index = 0; index < units.length; index++) {
    const unit = units[index], edit = edits[index];
    if (!edit || typeof edit !== "object" || Array.isArray(edit))
      throw new Error("文稿编辑账本包含无效单元，请重试当前段。");
    const row = edit as Record<string, unknown>;
    if (row.id !== unit.id)
      throw new Error("文稿编辑账本的原文编号缺失、重复或顺序错误，请重试当前段。");
    const keys = Object.keys(row).filter((key) => key !== "id");
    let text = "";
    if (row.keep === true && keys.length === 1) {
      text = unit.verbatim ? unit.text : removeArticleFiller(unit.text);
    } else if (typeof row.text === "string" && row.text.length <= 60000 && keys.length === 1 && !unit.verbatim) {
      assertEditedText(unit.text, row.text, unit.id);
      text = removeArticleFiller(row.text);
    } else if (row.omit === "filler" && keys.length === 1 && !unit.verbatim && !removeArticleFiller(unit.text)) {
      text = "";
    } else if (row.omit === "duplicate" && keys.length === 2 && typeof row.duplicateOf === "string" && !unit.verbatim) {
      const canonical = duplicateText(removeArticleFiller(unit.text));
      const prior = kept.get(row.duplicateOf);
      const contextDuplicate = row.duplicateOf === "previousContext" && canonical &&
        previousContextContainsUnit(previousContext, canonical);
      if (!canonical || (!contextDuplicate && (!prior || duplicateText(prior) !== canonical)))
        throw new Error(`文稿单元 ${unit.id} 不是可确认的逐字重复，不能省略，请重试。`);
    } else {
      throw new Error(`文稿单元 ${unit.id} 的省略或编辑无法核验，尚未整理完整，请重试。`);
    }
    if (text) {
      rendered.push(text);
      // A future duplicate may only rely on an intact, actually retained representative.
      if (duplicateText(text) === duplicateText(removeArticleFiller(unit.text))) kept.set(unit.id, text);
    }
  }
  const text = rendered.join("\n\n");
  return { text, noContent: !text.trim() };
}
