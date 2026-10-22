import type { MindMapNode } from "./mindmap";
import { articleMarkdown } from "./article-export";
import { buildArticleEditUnits } from "./article-edit";
import type { SourceCue } from "./learning-source";

type ViewNode = MindMapNode & { verbatim?: true };

export function mindMapRoot(title: string, nodes: MindMapNode[], source: SourceCue[] = []): MindMapNode {
  // Use the whole source to recognize code split across API sections. A detail
  // leaf alone may not contain its opening fence, so cannot safely be cleaned.
  const protectedText = source.some((cue) => cue.text.trim()) ? buildArticleEditUnits(source).filter((unit) => unit.verbatim).map((unit) => unit.text) : [];
  const protect = (node: MindMapNode): ViewNode => ({ ...node,
    ...(node.text && protectedText.some((text) => text.includes(node.text)) ? { verbatim: true as const } : {}),
    children: node.children.map(protect) });
  return { id: "map-root", text: articleMarkdown(`# ${title}`).replace(/^#\s*/, "").trim(), sourceIds: [], children: nodes.map(protect) };
}

export function flattenMindMap(root: MindMapNode): MindMapNode[] {
  const result: MindMapNode[] = [];
  const walk = (node: MindMapNode) => { result.push(node); node.children.forEach(walk); };
  walk(root);
  return result;
}

export function mindMapNodeText(node: ViewNode): string {
  return node.verbatim ? node.text : articleMarkdown(node.text).trim();
}

export function escapeMapHtml(text: string): string {
  return text.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
}

/** Node content is HTML in Markmap; only our own escaped button markup may enter it. */
export function mindMapViewData(node: MindMapNode, foldDepth = 1, depth = 0) {
  return {
    content: `<button type="button" tabindex="-1" class="mindmap-node-label" data-map-node="${escapeMapHtml(node.id)}">${escapeMapHtml(mindMapNodeText(node))}</button>`,
    payload: { mapId: node.id, fold: node.children.length && depth >= foldDepth ? 1 : 0 },
    children: node.children.map((child) => mindMapViewData(child, foldDepth, depth + 1)),
  };
}

/** A portable outline containing all detail, independent of the current SVG folds. */
export function mindMapMarkdown(root: MindMapNode): string {
  const literal = (node: MindMapNode) => mindMapNodeText(node)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_\[\]#])/g, "\\$1");
  const lines = [`# ${literal(root).replace(/\n+/g, " ")}`, ""];
  const walk = (node: MindMapNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const text = literal(node).replace(/\n/g, `\n${indent}  `);
    if (text) lines.push(`${indent}- ${text}`);
    node.children.forEach((child) => walk(child, depth + 1));
  };
  root.children.forEach((node) => walk(node, 0));
  return lines.join("\n") + "\n";
}
