const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { articleMarkdown } = require(path.join(process.env.BILI_TEST_BUILD, "article-export.js"));

test("article export removes SRT/VTT structure while retaining each sentence and numbered facts", () => {
  const source = "WEBVTT\nKind: captions\nLanguage: zh-CN\n\n1\n00:00:01.000 --> 00:00:04.200 align:start position:0%\n第一段，等待 1250 毫秒。\n\n2\n00:00:04,200 --> 00:00:09,000\n第二段，2026 年 10 月 22 日 08:30 开会。\n\n42\n\n这是试验的答案。";
  assert.equal(articleMarkdown(source), "第一段，等待 1250 毫秒。\n\n第二段，2026 年 10 月 22 日 08:30 开会。\n\n42\n\n这是试验的答案。\n");
});

test("article export removes chapter times and playback links without discarding their meaningful labels", () => {
  const source = "# 视频文章\n\n## 00:12 · 准备环境\n\n[01:20] 先安装工具。\n\n## 测试连接（02:31）\n\n再查看[02:34 安装步骤](https://www.bilibili.com/video/BV123?t=154)，按[参数说明](source:4)操作。[回看 03:42](https://youtu.be/abc?t=222)[查看原文](source:5)\n\n参考[官方文档](https://example.com/manual?t=12)。\n\n![00:13](https://example.com/image.png)";
  const result = articleMarkdown(source);
  assert.match(result, /## 准备环境/);
  assert.match(result, /## 测试连接/);
  assert.match(result, /先安装工具。/);
  assert.match(result, /再查看安装步骤，按参数说明操作。/);
  assert.doesNotMatch(result, /00:12|01:20|02:31|02:34|03:42|source:|回看/);
  assert.match(result, /\[官方文档\]\(https:\/\/example.com\/manual\?t=12\)/);
  assert.match(result, /!\[00:13\]/);
});

test("article export removes a named timeline shell but retains all chapter substance", () => {
  const source = "# 严谨文章\n\n## 章节时间线\n\n- 00:10 开始之前先验证边界。\n- **01:23** · 参数必须小于 11；等于 11 不允许。\n\n## 结论\n\n08:30 开会，09:00 提交材料。\n- 12:30 讨论预算。";
  assert.equal(articleMarkdown(source), "# 严谨文章\n\n- 开始之前先验证边界。\n- 参数必须小于 11；等于 11 不允许。\n\n## 结论\n\n08:30 开会，09:00 提交材料。\n- 12:30 讨论预算。\n");
});

test("article export removes workbench metadata and only source footnotes", () => {
  const source = "# 文章\n\n正文说明。[原文](source:1)[^source-1]另有必要的注释[^meaning]。\n\n> 完整整理 · 来源：平台字幕\n> 全文 6,180 字 · 分 2 段整理 · 2026/10/22\n> 原视频：https://example.com/video\n> 来源：https://example.com/video\n> 整理方式：完整文稿 · 3 段\n> 生成时间：2026/10/22 08:30:00\n> 依据：用户字幕\n> 覆盖：全部原文\n\n[^source-1]: [00:01] 原句。\n    [回看](https://www.bilibili.com/video/BV123?t=1)\n\n[^meaning]: 1250 毫秒是超时时间。\n\n> 来源：太阳辐射是此处的能量来源。\n\n后续论证保留。";
  const result = articleMarkdown(source);
  assert.doesNotMatch(result, /source-1|原句|回看|生成时间|分 2 段整理|原视频|依据：|覆盖：/);
  assert.match(result, /必要的注释\[\^meaning\]/);
  assert.match(result, /\[\^meaning\]: 1250 毫秒/);
  assert.match(result, /> 来源：太阳辐射/);
  assert.match(result, /后续论证保留/);
});

test("article export preserves fenced, nested, indented and multiline inline code byte for byte", () => {
  const fenced = "````md\n## 00:12 教学数据\n```srt\n1\n00:00:01,000 --> 00:00:02,000\n[回看](source:1)\n```\n\n\n[00:13]\n````";
  const tilde = "~~~txt\n> 生成时间：2026/10/22\n[00:31]\n~~~";
  const indented = "    [00:42]\n    00:00:01 --> 00:00:02";
  const inline = "``[00:12]\n[查看原文](source:1)\n00:00:01 --> 00:00:02``";
  const source = `# 文章\n\n${fenced}\n\n${tilde}\n\n${indented}\n\n时间字符串示例 ${inline} 必须保持原样。\n\n[02:34] 最后一个正文事实。`;
  const result = articleMarkdown(source);
  for (const code of [fenced, tilde, indented, inline]) assert.ok(result.includes(code), code);
  assert.match(result, /最后一个正文事实。/);
  assert.doesNotMatch(result, /\[02:34\]/);
});

test("article export leaves factual quantities, dates, ratio examples, links and clock times intact", () => {
  const source = "# 时间格式的例子\n\n会议在 08:30 开始，视频长度为 1 小时 23 分钟。数据采集于 2026-10-22。\n\n- 12:30 是午餐集合时间。\n- 比例 1:20 需要复核。\n\n解析器把字符串 `[00:01]` 识别为时间码，`00:00:01 --> 00:00:02` 是范围。\n\n独立答案为 42；参数 timeout=1250，速率为 2.5 倍。\n\n> 时间 10:30 是约定，不是播放位置。";
  assert.equal(articleMarkdown(source), source + "\n");
});

test("article export is idempotent, empty-safe and unwraps a provider Markdown wrapper", () => {
  const source = "```markdown\n# 文章\n\n[00:12] 事实。\n```";
  const result = articleMarkdown(source);
  assert.equal(result, "# 文章\n\n事实。\n");
  assert.equal(articleMarkdown(result), result);
  assert.equal(articleMarkdown(""), "");
});

test("article export removes quoted and trailing cue times and ranges, retaining each cue's content", () => {
  const source = "# 文章\n\n> [00:12] 条件必须成立。\n\n[01:20 --> 01:30] 计算 181−46−14=121，重试后为 135。\n\n另一个事实。[02:34][02:36]\n\n上限依然为 11[03:45]。\n\n教学格式 [00:01] 的分隔符是冒号。";
  assert.equal(articleMarkdown(source), "# 文章\n\n> 条件必须成立。\n\n计算 181−46−14=121，重试后为 135。\n\n另一个事实。\n\n上限依然为 11。\n\n教学格式 [00:01] 的分隔符是冒号。\n");
});

test("article export preserves CRLF inside real code", () => {
  const code = "```srt\r\n1\r\n00:00:01 --> 00:00:02\r\n```";
  const inline = "`[00:01]\r\n[查看原文](source:1)`";
  const result = articleMarkdown(`# 文章\r\n\r\n${code}\r\n\r\n格式 ${inline} 保留。\r\n\r\n[02:34] 正文。`);
  assert.ok(result.includes(code));
  assert.ok(result.includes(inline));
  assert.doesNotMatch(result, /\[02:34\]/);
});

test("article export keeps substantive coverage, evidence and method statements outside a metadata block", () => {
  const source = "# 文章\n\n> 覆盖：本次业务覆盖了 12 个国家。\n> 依据：181−46−14=121 是本次的计算结果。\n> 整理方式：先观察，再提出假说。\n\n正文继续。";
  assert.equal(articleMarkdown(source), source + "\n");
});

test("article export distinguishes factual heading times and ratios from navigation markers", () => {
  for (const source of ["## 1:20 稀释比例", "## 1:200 稀释比例", "## 08:30 开会时间", "## 开会时间（08:30）", "## 08:30-09:30 开会时间"]) {
    assert.equal(articleMarkdown(source), source + "\n");
  }
  assert.equal(articleMarkdown("按[1:20 稀释比例](source:1)配制。"), "按1:20 稀释比例配制。\n");
  assert.equal(articleMarkdown("- **00:12** 安装环境"), "- 安装环境\n");
});
