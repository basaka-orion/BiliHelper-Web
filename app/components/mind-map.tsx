"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Markmap } from "markmap-view";
import { ChevronDown, Expand, FileDown, ListTree, Minus, Plus, Search, X } from "lucide-react";
import type { MindMapNode } from "../../lib/mindmap";
import { flattenMindMap, mindMapMarkdown, mindMapNodeText, mindMapViewData } from "../../lib/mindmap-view";
import { markdownFileName } from "../../lib/full-document";

type RuntimeNode = NonNullable<Markmap["state"]["data"]>;
const mapCss = ".mindmap-node-label{display:block;border:0;padding:3px 1px;background:transparent;color:inherit;text-align:left;font:inherit;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer}.mindmap-node-label:focus-visible{outline:2px solid #aaa5ff;outline-offset:2px}.markmap-foreign>div>div{max-width:280px}";
const colors = ["#b7aaff", "#7fd3c4", "#e6c787", "#91bbf1", "#efa4ba", "#c8b7ed"];

async function readableView(map: Markmap) {
  await map.fit(1);
  const svg = map.svg.node();
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const { x1, x2, y1, y2 } = map.state.rect;
  const scale = Math.min(width / (x2 - x1) * map.options.fitRatio, height / (y2 - y1) * map.options.fitRatio, 1);
  // Keep default text legible on large maps; the overview button can still fit everything.
  if (scale > 0 && scale < 0.85) await map.rescale(0.85 / scale);
}

function saveFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function OutlineNode({ node, depth, onSelect, expanded }: {
  node: MindMapNode; depth: number; onSelect: (node: MindMapNode) => void; expanded: boolean;
}) {
  return <li>
    {node.children.length ? <details open={expanded || depth < 1}>
      <summary>{mindMapNodeText(node)}</summary>
      {!!node.sourceIds.length && <button className="text-button" onClick={() => onSelect(node)}>查看这部分依据</button>}
      <ul>{node.children.map((child) => <OutlineNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} expanded={expanded} />)}</ul>
    </details> : <button className="outline-detail" onClick={() => onSelect(node)}>{mindMapNodeText(node)}</button>}
  </li>;
}

export function MindMap({ root, complete, onSource }: {
  root: MindMapNode; complete: boolean; onSource: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<Markmap>();
  const shellRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [outline, setOutline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState("");
  const nodes = useMemo(() => flattenMindMap(root), [root]);
  const index = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = index.get(selectedId);
  const matches = query.trim() ? nodes.filter((node) => mindMapNodeText(node).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30) : [];
  const overviewDepth = root.children.length === 1 ? 2 : 1;

  useEffect(() => {
    if (!selectedId) return;
    detailRef.current?.scrollIntoView({ block: "nearest" });
    detailRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let disposed = false;
    const mm = Markmap.create(svg, {
      autoFit: false, duration: 0, initialExpandLevel: -1, maxWidth: 280,
      spacingHorizontal: 64, spacingVertical: 14, paddingX: 10, fitRatio: 0.9,
      maxInitialScale: 1, embedGlobalCSS: true, style: () => mapCss,
      color: (node) => colors[(Number(node.state.path.split(".")[1] || 1) - 1) % colors.length],
      scrollForPan: false,
    });
    mapRef.current = mm;
    setRenderError("");
    setSelectedId("");
    mm.setData(mindMapViewData(root, overviewDepth)).then(() => { if (!disposed) return readableView(mm); })
      .catch(() => { if (!disposed) { setRenderError("图形暂时无法显示，完整内容可在文字大纲中查看。"); setOutline(true); } });
    const observer = new ResizeObserver(() => { if (!disposed && svg.clientWidth) void readableView(mm).catch(() => {}); });
    observer.observe(svg);
    return () => { disposed = true; observer.disconnect(); mm.destroy(); if (mapRef.current === mm) mapRef.current = undefined; };
  }, [root, overviewDepth]);

  async function choose(node: MindMapNode) {
    setSelectedId(node.id); setActionError("");
    const mm = mapRef.current;
    if (!mm?.state.data) return;
    const path: RuntimeNode[] = [];
    const find = (current: RuntimeNode): boolean => {
      path.push(current);
      if (current.payload?.mapId === node.id) return true;
      if (current.children.some(find)) return true;
      path.pop(); return false;
    };
    if (find(mm.state.data)) {
      path.slice(0, -1).forEach((parent) => { parent.payload = { ...parent.payload, fold: 0 }; });
      try { await mm.renderData(); await mm.centerNode(path[path.length - 1]); await mm.setHighlight(path[path.length - 1]); }
      catch { /* The accessible detail panel remains available if positioning fails. */ }
    }
  }

  async function fold(all: boolean) {
    const mm = mapRef.current;
    if (!mm) return;
    setExpanded(all);
    try { await mm.setData(mindMapViewData(root, all ? Number.MAX_SAFE_INTEGER : overviewDepth)); await readableView(mm); }
    catch { setActionError("图形布局暂不可用，可切换文字大纲继续查看。"); }
  }

  async function exportSvg() {
    const mm = mapRef.current, svg = svgRef.current;
    if (!complete || !mm?.state.data || !svg) return;
    setExporting(true); setActionError("");
    const folds: { node: RuntimeNode; value: number | undefined }[] = [];
    const canvas = svg.parentElement!;
    const wasHidden = canvas.hidden;
    const expand = (node: RuntimeNode) => {
      folds.push({ node, value: node.payload?.fold }); node.payload = { ...node.payload, fold: 0 }; node.children.forEach(expand);
    };
    try {
      canvas.hidden = false;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expand(mm.state.data); await mm.renderData();
      // renderData schedules D3 transitions; fit resolves after their layout
      // frame so exported positions include every newly expanded leaf.
      await mm.fit(1);
      const box = mm.g.node()!.getBBox();
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("viewBox", `${box.x - 30} ${box.y - 30} ${box.width + 60} ${box.height + 60}`);
      clone.setAttribute("width", String(Math.ceil(box.width + 60)));
      clone.setAttribute("height", String(Math.ceil(box.height + 60)));
      clone.style.width = ""; clone.style.height = "";
      clone.querySelector(":scope > g")?.removeAttribute("transform");
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      for (const [key, value] of Object.entries({ x: box.x - 30, y: box.y - 30, width: box.width + 60, height: box.height + 60, fill: "#10121c" })) background.setAttribute(key, String(value));
      clone.insertBefore(background, clone.querySelector(":scope > g"));
      saveFile(new XMLSerializer().serializeToString(clone), markdownFileName(root.text, "思维导图").replace(/\.md$/, ".svg"), "image/svg+xml;charset=utf-8");
    } catch { setActionError("图片导出未完成，请重试；也可先导出导图 Markdown。"); }
    finally {
      folds.forEach(({ node, value }) => { node.payload = { ...node.payload, fold: value }; });
      try { await mm.renderData(); await readableView(mm); } catch {}
      canvas.hidden = wasHidden;
      setExporting(false);
    }
  }

  return <div className="mindmap-panel" ref={shellRef}>
    <div className="mindmap-heading"><div><h2>内容思维导图</h2><p>{nodes.length - 1} 个节点 · 先看主题，点圆点展开细节</p></div>
      <button className="text-button" onClick={() => setOutline(!outline)}><ListTree size={16} />{outline ? "查看图形" : "文字大纲"}</button></div>
    <div className="mindmap-toolbar" aria-label="思维导图工具">
      <button title="放大" aria-label="放大思维导图" onClick={() => void mapRef.current?.rescale(1.25)}><Plus size={17} /></button>
      <button title="缩小" aria-label="缩小思维导图" onClick={() => void mapRef.current?.rescale(0.8)}><Minus size={17} /></button>
      <button onClick={() => void mapRef.current?.fit(1)}><Expand size={15} />适应视图</button>
      <button onClick={() => void fold(!expanded)}><ChevronDown size={15} />{expanded ? "收起细节" : "展开全部"}</button>
      <label className="mindmap-search"><Search size={15} /><input aria-label="搜索导图节点" placeholder="搜索概念、例子或命令" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    {!!query.trim() && <div className="mindmap-matches" role="region" aria-label="导图搜索结果">
      {matches.length ? matches.map((node) => <button key={node.id} onClick={() => void choose(node)}>{mindMapNodeText(node).slice(0, 110)}{mindMapNodeText(node).length > 110 ? "…" : ""}</button>) : <p>没有匹配的节点。</p>}
      {matches.length === 30 && <small>显示前 30 项，可继续输入缩小范围。</small>}
    </div>}
    {renderError && <p className="notice">{renderError}</p>}
    <div className="mindmap-canvas" hidden={outline} onClick={(event) => {
      const target = (event.target as Element).closest?.("[data-map-node]");
      const node = target && index.get(target.getAttribute("data-map-node") || "");
      if (node) void choose(node);
    }}>
      <svg ref={svgRef} aria-label={`视频内容思维导图：${root.text}`} role="img" style={{ "--markmap-font": "400 15px/22px system-ui, sans-serif", "--markmap-text-color": "#edeef5", "--markmap-circle-open-bg": "#10121c" } as React.CSSProperties} />
    </div>
    {outline && <div className="mindmap-outline" aria-label="思维导图文字大纲"><h3>{root.text}</h3><ul>{root.children.map((node) => <OutlineNode key={node.id} node={node} depth={0} onSelect={(node) => void choose(node)} expanded={expanded} />)}</ul></div>}
    {selected && <aside ref={detailRef} tabIndex={-1} className="mindmap-detail" aria-label="节点详情"><div><strong>节点内容与依据</strong><button className="icon-button" aria-label="关闭节点详情" onClick={() => setSelectedId("")}><X size={16} /></button></div><p>{mindMapNodeText(selected)}</p><div>{selected.sourceIds.map((id) => <button className="text-button" key={id} onClick={() => onSource(id)}>查看原文 {id}</button>)}</div></aside>}
    {actionError && <p className="notice" role="status">{actionError}</p>}
    <div className="mindmap-exports"><span className="small muted">{complete ? "导出包含全部层级和细节" : "结构整理完成后可导出"}</span>
      <button className="text-button" disabled={!complete || exporting || !!renderError} onClick={() => void exportSvg()}><FileDown size={15} />{exporting ? "正在导出…" : "导出 SVG"}</button>
      <button className="text-button" disabled={!complete} onClick={() => saveFile(mindMapMarkdown(root), markdownFileName(root.text, "思维导图"), "text/markdown;charset=utf-8")}>导出导图 Markdown</button>
    </div>
  </div>;
}
