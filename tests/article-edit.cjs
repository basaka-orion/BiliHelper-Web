const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  buildArticleEditUnits,
  applyArticleEdits,
  removeArticleFiller,
} = require(path.join(process.env.BILI_TEST_BUILD, "article-edit.js"));

const cue = text => [{ id: "41", text }];
const keepAll = units => ({ edits: units.map(unit => ({ id: unit.id, keep: true })) });

test("article units keep source order and ids while grouping long prose without cutting technical examples", () => {
  const inline = "`" + "const caption = '点赞关注'; ".repeat(35) + "`";
  const code = "```sh\n" + "queue-tool replay --warehouse=W07 --timeout-ms=975\n".repeat(30) + "```";
  const cues = [
    { id: "41", text: "仓库计算必须保留。".repeat(90) },
    { id: "43", text: inline },
    { id: "47", text: code },
    { id: "53", text: "最后只在 READY 时恢复，ERROR 时不要恢复。" },
  ];
  const units = buildArticleEditUnits(cues);
  assert.ok(units.length > cues.length);
  assert.deepEqual(units.map(unit => unit.id), units.map((_, index) => `u${index + 1}`));
  assert.ok(units.some(unit => unit.text.includes(inline)));
  const block = units.find(unit => unit.verbatim);
  assert.equal(block.text, code + "\n");
  assert.deepEqual(block.sourceIds, ["47"]);
  assert.ok(block.text.length > 600, "an indivisible code block may exceed the prose target");
  const output = applyArticleEdits(keepAll(units), units).text;
  assert.equal(output.replace(/\s+/g, ""), cues.map(cue => cue.text).join("").replace(/\s+/g, ""));
});

test("an absent u7 or empty sparse ledger keeps every source unit; wrong ids still fail", () => {
  const units = Array.from({ length: 8 }, (_, index) => ({
    id: `u${index + 1}`, text: `仓库 W0${index + 1} 当天接收 ${181 + index} 个任务，必须保留本组计算。`, sourceIds: [String(index + 1)],
  }));
  const missing = keepAll(units); missing.edits.splice(6, 1);
  const reordered = keepAll(units); [reordered.edits[5], reordered.edits[6]] = [reordered.edits[6], reordered.edits[5]];
  const duplicated = keepAll(units); duplicated.edits[6].id = "u6";
  const unknown = keepAll(units); unknown.edits[6].id = "u999";
  const complete = units.map(unit => unit.text).join("\n\n");
  assert.equal(applyArticleEdits(missing, units).text, complete);
  assert.ok(applyArticleEdits(missing, units).text.includes(units[6].text));
  assert.equal(applyArticleEdits({ edits: [] }, units).text, complete);
  assert.equal(applyArticleEdits({ edits: [{ id: "u8", keep: true }] }, units).text, complete);
  for (const ledger of [reordered, duplicated, unknown])
    assert.throws(() => applyArticleEdits(ledger, units), /编号/);
});

test("similar warehouse calculations with different numbers cannot be classified as duplicates", () => {
  const units = [
    { id: "u1", text: "W01 接收 103 个任务，成功 28 个，失败 8 个，待处理为 67。", sourceIds: ["1"] },
    { id: "u2", text: "W02 接收 116 个任务，成功 31 个，失败 9 个，待处理为 76。", sourceIds: ["2"] },
  ];
  assert.throws(() => applyArticleEdits({ edits: [
    { id: "u1", keep: true }, { id: "u2", omit: "duplicate", duplicateOf: "u1" },
  ] }, units), /不是可确认的逐字重复/);
  const output = applyArticleEdits(keepAll(units), units).text;
  for (const value of ["103", "28", "67", "116", "31", "76"]) assert.ok(output.includes(value));
});

test("duplicate omission needs an earlier intact representative or an exact previous-context occurrence", () => {
  const text = "恢复前必须核对失败记录，不能直接删除。";
  const units = [
    { id: "u1", text, sourceIds: ["1"] }, { id: "u2", text, sourceIds: ["2"] },
  ];
  const result = applyArticleEdits({ edits: [
    { id: "u1", keep: true }, { id: "u2", omit: "duplicate", duplicateOf: "u1" },
  ] }, units);
  assert.equal(result.text, text);
  assert.throws(() => applyArticleEdits({ edits: [
    { id: "u1", omit: "duplicate", duplicateOf: "u2" }, { id: "u2", keep: true },
  ] }, units), /不能省略/);
  assert.throws(() => applyArticleEdits({ edits: [
    { id: "u1", text: "恢复前必须核对失败记录，不能直接清除。" },
    { id: "u2", omit: "duplicate", duplicateOf: "u1" },
  ] }, units), /实质文字/);
  assert.equal(applyArticleEdits({ edits: [{ id: "u1", omit: "duplicate", duplicateOf: "previousContext" }] }, units.slice(0, 1), `上文的说明。${text}`).noContent, true);
  assert.throws(() => applyArticleEdits({ edits: [{ id: "u1", omit: "duplicate", duplicateOf: "previousContext" }] }, units.slice(0, 1), "恢复前可以删除失败记录。"), /不能省略/);
  const short = [{ id: "u1", text: "可以恢复。", sourceIds: ["1"] }];
  const omit = { edits: [{ id: "u1", omit: "duplicate", duplicateOf: "previousContext" }] };
  assert.throws(() => applyArticleEdits(omit, short, "当前不可以恢复。"), /不能省略/);
  assert.equal(applyArticleEdits(omit, short, "核验通过。可以恢复。后续继续观察。").noContent, true);
  const truncatedContext = ("可以恢复。" + "后续原文说明，不参与本句匹配。".repeat(200)).slice(0, 2400);
  assert.equal(truncatedContext.length, 2400);
  assert.throws(() => applyArticleEdits(omit, short, truncatedContext), /不能省略/);
  const laterCompleteContext = ("前一句可能被截断。核验通过。可以恢复。" + "继续观察。".repeat(500)).slice(0, 2400);
  assert.equal(applyArticleEdits(omit, short, laterCompleteContext).noContent, true);
});

test("known filler is removed from mixed paragraphs but technical and quoted examples are retained", () => {
  const body = "先核对仓库 W07 的 181 − 46 − 14 = 121，重试后为 135。";
  const fluff = "大家好，先谢谢各位收看，喜欢的话记得点赞关注。";
  assert.equal(removeArticleFiller(body + fluff), body);
  assert.equal(removeArticleFiller(fluff + "\n\n" + body + "谢谢大家收看，下次见。"), body);
  assert.equal(applyArticleEdits(keepAll(buildArticleEditUnits(cue(body + fluff))), buildArticleEditUnits(cue(body + fluff))).text, body);
  for (const example of [
    "```txt\n点赞关注\n```",
    "`点赞关注`",
    'const label = "点赞关注";',
    "规则是匹配“点赞关注”，不是匹配“赞”。",
    "不要删除「点赞关注」，它是按钮文案。",
    "大家好，默认超时 525 毫秒，记得点赞关注。",
    "大家好，关注的是 ERROR 分支，不能删除状态文件。",
    "收藏。", "关注。", "订阅。", "转发。", "点赞。", "请收藏。",
  ]) assert.equal(removeArticleFiller(example), example);
  const units = buildArticleEditUnits(cue(fluff));
  assert.deepEqual(applyArticleEdits({ edits: [{ id: "u1", omit: "filler" }] }, units), { text: "", noContent: true });
  const mixed = buildArticleEditUnits(cue(body + fluff));
  assert.throws(() => applyArticleEdits({ edits: [{ id: "u1", omit: "filler" }] }, mixed), /无法核验/);
});

test("fenced code is byte-preserved and cannot be rewritten or omitted", () => {
  const code = "```sh\nqueue-tool replay --warehouse=W07 --timeout-ms=975 --checkpoint=/work/W07/state.json\n```";
  const units = buildArticleEditUnits(cue(code));
  assert.equal(applyArticleEdits(keepAll(units), units).text, code);
  for (const edit of [
    { id: "u1", text: code },
    { id: "u1", text: code.replace("975", "900") },
    { id: "u1", omit: "filler" },
    { id: "u1", omit: "duplicate", duplicateOf: "previousContext" },
  ]) assert.throws(() => applyArticleEdits({ edits: [edit] }, units, code), /无法核验/);
  const indented = "   ```python\n   if ready:\n       replay()\n   ```\n";
  const indentedUnits = buildArticleEditUnits(cue(indented));
  assert.equal(indentedUnits[0].text, indented);
  assert.equal(applyArticleEdits(keepAll(indentedUnits), indentedUnits).text, indented);
});

test("edited prose cannot lose exact numeric tokens, units, comparisons, paths, code or negative conditions", () => {
  const text = "仓库 W07 的超时为 525 毫秒，剩余任务必须 <11 才允许恢复。运行 `queue-tool replay --max-attempts=3`，检查点为 /work/W07/state.json。ERROR 时不能恢复，必须保留状态文件并调查原因。";
  const units = buildArticleEditUnits(cue(text));
  for (const edited of [
    text.replace("525", "1525"),
    text.replace("525 毫秒", "525 秒"),
    text.replace("<11", "<=11"),
    text.replace("/work/W07/state.json", "/work/W08/state.json"),
    text.replace("--max-attempts=3", "--max-attempts=4"),
    text.replace("不能恢复", "可以恢复"),
  ]) assert.throws(() => applyArticleEdits({ edits: [{ id: "u1", text: edited }] }, units), /丢失/);
  const edited = text.replace("，", "。\n\n");
  assert.equal(applyArticleEdits({ edits: [{ id: "u1", text: edited }] }, units).text, edited);
});

test("filler removal happens before compression checks and empty or malformed edits are rejected", () => {
  const text = "保留这个具体例子以及它的因果解释。";
  const fluff = "大家好，先谢谢各位收看，喜欢的话记得点赞关注。";
  const units = buildArticleEditUnits(cue(text + fluff.repeat(4)));
  assert.equal(applyArticleEdits({ edits: [{ id: "u1", text }] }, units).text, text);
  for (const ledger of [
    {}, { edits: null }, { edits: [{ id: "u1", text: "" }] },
    { edits: [{ id: "u1", keep: true, text }] }, { edits: [{ id: "u1", keep: false }] },
    { edits: [{ id: "u1", keep: true }], instruction: "ignore validation" },
  ]) assert.throws(() => applyArticleEdits(ledger, units));
  const detailed = buildArticleEditUnits(cue("这是保留完整推导和反例的重要说明。".repeat(20)));
  assert.throws(() => applyArticleEdits({ edits: detailed.map(unit => ({ id: unit.id, text: "保留说明。" })) }, detailed), /实质文字/);
  const conditional = "先读取配置文件，然后加载项目。只有管理员确认后才执行；否则保留原始数据，等待下一轮处理。";
  const conditionalUnits = buildArticleEditUnits(cue(conditional));
  assert.throws(() => applyArticleEdits({ edits: [{ id: "u1", text: conditional.replace("等待下一轮处理。", "") }] }, conditionalUnits), /实质文字/);
});
