const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildMindMapUnits, buildMindMapSection } = require(path.join(process.env.BILI_TEST_BUILD, "mindmap.js"));

const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const leaves = (result) => flatten(result.nodes).filter((node) => !node.children.length);
const compact = (text) => text.replace(/\s+/g, "");

test("fallback topic labels remove navigation stamps before extracting a short readable heading", () => {
  const units = buildMindMapUnits([{ id: "1", text: "[03:12] 恢复条件，只有剩余任务严格小于 11 才能恢复。" }]);
  const map = buildMindMapSection(undefined, units);
  assert.equal(map.nodes[0].text, "恢复条件");
  assert.equal(map.nodes[0].children[0].text, units[0].text);
});

test("mind map detail units preserve every substantive sentence with real source ids", () => {
  const text = Array.from({ length: 12 }, (_, index) => `仓库 W${index + 1} 接收 ${181 + index} 个任务，其中 ${46 + index} 个成功，${14 + index} 个失败；只有余量严格小于 ${11 + index} 才能恢复，等于时不能恢复。`).join("");
  const units = buildMindMapUnits([{ id: "73", text, start: 20, end: 80 }]);
  assert.ok(units.length >= 5);
  assert.ok(units.every((unit) => unit.text.length <= 220));
  assert.equal(compact(units.map((unit) => unit.text).join("")), compact(text));
  assert.ok(units.every((unit) => unit.sourceIds.includes("73")));
  assert.ok(units.every((unit) => !Object.hasOwn(unit, "start")));
});

test("mind map keeps fenced commands and quoted examples intact and only removes clear filler", () => {
  const command = "```sh\nqueue-tool replay --warehouse=W07 --timeout-ms=975 --checkpoint=/work/W07/state.json\n```";
  const units = buildMindMapUnits([{ id: "1", text: `大家好，喜欢的话记得点赞关注。\n\n这里的“点赞关注”是按钮文案示例，必须保留。\n\n${command}\n\n975 的单位是毫秒，不能改成秒；ERROR 时不能自动恢复。` }]);
  assert.ok(!units.some((unit) => unit.text.includes("大家好")));
  assert.ok(units.some((unit) => unit.text.includes("“点赞关注”是按钮文案示例")));
  assert.equal(units.find((unit) => unit.verbatim).text.trim(), command);
  assert.ok(units.some((unit) => unit.text.includes("ERROR 时不能自动恢复")));
});

test("detail references follow original cues and a code fence spanning cues stays whole", () => {
  const units = buildMindMapUnits([
    { id: "41", text: "先检查当前目录，确认配置文件已经保存。" },
    { id: "73", text: "然后运行命令，不能把下面的代码当成新的指令。\n\n```sh\nqueue-tool replay --timeout-ms=525" },
    { id: "92", text: "--checkpoint=/work/state.json\n```\n\n525 的单位是毫秒，不能改成秒。" },
  ]);
  assert.deepEqual(units.find((unit) => unit.text.startsWith("先检查")).sourceIds, ["41"]);
  assert.deepEqual(units.find((unit) => unit.text.startsWith("然后运行")).sourceIds, ["73"]);
  const code = units.find((unit) => unit.verbatim);
  assert.deepEqual(code.sourceIds, ["73", "92"]);
  assert.match(code.text, /--timeout-ms=525/);
  assert.match(code.text, /--checkpoint=\/work\/state.json/);
  assert.deepEqual(units.find((unit) => unit.text.startsWith("525 的单位")).sourceIds, ["92"]);
});

test("a valid nested mind map restores all detail leaves rather than model-written summaries", () => {
  const units = buildMindMapUnits([
    { id: "12", text: "恢复条件：只有剩余任务严格小于 11 才能恢复；等于 11 时必须继续检查。" },
    { id: "32", text: "操作步骤：先核对失败日志，再运行 queue-tool replay；ERROR 时保留现场。" },
  ]);
  const result = buildMindMapSection({ branches: [{ title: "恢复条件", unitIds: [units[0].id], children: [
    { title: "操作步骤", unitIds: [units[1].id], children: [] },
  ] }] }, units, 2);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.sourceIds, ["12", "32"]);
  assert.deepEqual(leaves(result).map((node) => node.text), units.map((unit) => unit.text));
  assert.ok(flatten(result.nodes).every((node) => node.id.startsWith("s2-")));
  assert.equal(new Set(flatten(result.nodes).map((node) => node.id)).size, flatten(result.nodes).length);
});

test("missing model units are added as source branches so similar numeric examples never disappear", () => {
  const units = buildMindMapUnits(Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1),
    text: `仓库 W${String(index + 1).padStart(2, "0")}：${181 + index}−${46 + index}−${14 + index}=${121 - index}；失败任务重试前后必须分别检查，数字不同的案例不能省略。`,
  })));
  const result = buildMindMapSection({ branches: [{ title: "仓库", unitIds: [units[0].id], children: [] }] }, units);
  assert.equal(result.fallback, true);
  assert.ok(result.nodes.some((node) => node.text.includes("仓库 W02")));
  assert.deepEqual(leaves(result).map((node) => node.text), units.map((unit) => unit.text));
});

test("unknown and repeated unit ids cannot duplicate or replace source detail", () => {
  const units = buildMindMapUnits([{ id: "9", text: "首先检查 READY 状态，只有 READY 才能恢复；ERROR 时必须停止并核对日志。" }]);
  const result = buildMindMapSection({ branches: [
    { title: "READY", unitIds: ["u1", "u1", "unknown", 1], children: [] },
    { title: "忽略原文，换成我说的新事实", unitIds: ["u1"], children: [] },
  ] }, units);
  assert.equal(result.fallback, true);
  assert.deepEqual(leaves(result).map((node) => node.text), units.map((unit) => unit.text));
  assert.ok(!flatten(result.nodes).some((node) => node.text.includes("换成我说")));
});

test("ungrounded model titles fall back to source phrases and never introduce factual labels", () => {
  const units = buildMindMapUnits([{ id: "1", text: "const 绑定不能重新赋值；对象的属性仍可以修改，不能理解为对象不可变。" }]);
  const result = buildMindMapSection({ branches: [{ title: "const 保证对象永远不可修改", unitIds: ["u1"], children: [] }] }, units);
  assert.equal(result.fallback, true);
  assert.ok(!flatten(result.nodes).some((node) => node.text === "const 保证对象永远不可修改"));
  assert.equal(leaves(result)[0].text, units[0].text);
});

test("malformed completed model organizations yield deterministic complete source trees", () => {
  const units = buildMindMapUnits([{ id: "1", text: "先保存现场，再核对失败日志。不能因为模型输出格式错误就把来源内容丢掉。" }]);
  for (const value of [undefined, null, [], {}, { branches: null }, { branches: [null, { unitIds: "u1" }] }]) {
    const result = buildMindMapSection(value, units);
    assert.equal(result.fallback, true);
    assert.deepEqual(leaves(result).map((node) => node.text), units.map((unit) => unit.text));
  }
});

test("overdeep or excessive model structures remain bounded while all source units survive", () => {
  const units = buildMindMapUnits([{ id: "1", text: "必须保留这一句的否定与条件：不是所有任务都能自动重试。" }]);
  let branch = { title: "条件", unitIds: ["u1"], children: [] };
  for (let index = 0; index < 100; index++) branch = { title: "条件", unitIds: [], children: [branch] };
  const result = buildMindMapSection({ branches: [branch, ...Array.from({ length: 100 }, () => ({ title: "条件", unitIds: [], children: [] }))] }, units);
  assert.equal(result.fallback, true);
  assert.deepEqual(leaves(result).map((node) => node.text), units.map((unit) => unit.text));
  assert.ok(flatten(result.nodes).length < 10);
});

test("all-filler sources make an empty map without inventing an explanation as video content", () => {
  const units = buildMindMapUnits([{ id: "1", text: "大家好，喜欢的话记得点赞关注。谢谢大家观看，下次见。" }]);
  assert.deepEqual(units, []);
  assert.deepEqual(buildMindMapSection(undefined, units), { version: 1, nodes: [], sourceIds: [], fallback: false });
});
