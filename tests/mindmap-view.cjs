const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mindMapRoot, flattenMindMap, mindMapViewData, mindMapNodeText, mindMapMarkdown } = require(path.join(process.env.BILI_TEST_BUILD, "mindmap-view.js"));

test("untrusted source HTML is inert in SVG node markup and every detail survives a folded view", () => {
  const root = mindMapRoot("测试", [{ id: 'x\" onclick=\"bad()', text: '[03:12] <img src=x onerror=bad()> 实际内容', sourceIds: ["1"], children: [{ id: "detail", text: "超时 1250 毫秒，只有 READY 才能恢复。", sourceIds: ["1"], children: [] }] }]);
  const data = mindMapViewData(root);
  assert.ok(data.children[0].content.includes("&lt;img"));
  assert.ok(data.children[0].content.includes("x&quot; onclick=&quot;bad()"));
  assert.equal(data.children[0].payload.fold, 1);
  assert.equal(data.children[0].children[0].payload.mapId, "detail");
  assert.equal(flattenMindMap(root).length, 3);
  const markdown = mindMapMarkdown(root);
  assert.match(markdown, /1250 毫秒，只有 READY 才能恢复/);
  assert.doesNotMatch(markdown, /\[03:12\]/);
  assert.doesNotMatch(markdown, /<img/);
  assert.doesNotMatch(mindMapNodeText(root.children[0]), /\[03:12\]/);
});

test("map Markdown exports complete nested details without view state or navigation metadata", () => {
  const root = mindMapRoot("主题", [{ id: "a", text: "## 03:12 计算", sourceIds: ["1"], children: [{ id: "b", text: "事实日期2026-10-22，任务数103−28−8=67。", sourceIds: ["1"], children: [] }] }]);
  const text = mindMapMarkdown(root);
  assert.ok(text.startsWith("# 主题\n"));
  assert.ok(text.includes("  - 事实日期2026-10-22，任务数103−28−8=67。"));
  assert.doesNotMatch(text, /03:12|source:|generatedAt/);
});
