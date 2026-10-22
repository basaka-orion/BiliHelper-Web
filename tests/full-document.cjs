const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  assembleFullDocument,
  assemblePartialDocument,
  documentHeadings,
  markdownFileName,
} = require(path.join(process.env.BILI_TEST_BUILD, "full-document.js"));

const sections = [
  {
    index: 1,
    markdown: "## 第二步 · 保存文件\n\n输入文件名并保存。[查看原文](source:2)\n\n### 文件名限制\n\n不能包含斜杠。",
    cueIds: ["2"],
  },
  {
    index: 0,
    markdown: "# 第一步 · 新建项目\n\n从菜单新建。\n\n```python\nprint('## 代码里的标题不是目录')\n```",
    cueIds: ["1"],
  },
];

test("full document assembly orders sections, keeps all text and builds a real table of contents", () => {
  const markdown = assembleFullDocument({
    title: "Python 教程",
    partTitle: "新建并保存文件",
    videoUrl: "https://www.bilibili.com/video/BV1wD4y1o7AS?p=2",
    sourceLabel: "平台字幕",
    totalCharacters: 6180,
    sections,
    generatedAt: 1_700_000_000_000,
    page: 2,
    pageCount: 200,
    dateLabel: "2026/10/22",
  });
  assert.match(markdown, /^# 新建并保存文件\n/);
  assert.match(markdown, /完整整理 · 来源：平台字幕/);
  assert.match(markdown, /全文 6,180 字 · 分 2 段整理 · 2026\/10\/22 · P2 · 共 200 节/);
  assert.ok(markdown.indexOf("第一步 · 新建项目") < markdown.indexOf("第二步 · 保存文件"));
  assert.match(markdown, /- 第一步 · 新建项目/);
  assert.match(markdown, /- 第二步 · 保存文件/);
  assert.match(markdown, /  - 文件名限制/);
  const toc = markdown.split("## 文档目录")[1].split("\n\n---")[0];
  assert.doesNotMatch(toc, /代码里的标题不是目录/);
  assert.match(markdown, /print\('## 代码里的标题不是目录'\)/);
  assert.match(markdown, /输入文件名并保存。\[查看原文\]\(source:2\)/);
});

test("partial documents say they are incomplete; empty or missing sections fail explicitly", () => {
  const partial = assemblePartialDocument({
    title: "课程",
    partTitle: "第一节",
    videoUrl: "https://example.test/video",
    sourceLabel: "用户字幕",
    totalCharacters: 100,
    sections: [sections[0]],
    generatedAt: 1,
    dateLabel: "今天",
  });
  assert.match(partial, /文档尚未整理完成/);
  assert.throws(
    () =>
      assembleFullDocument({
        title: "课程",
        videoUrl: "https://example.test/video",
        sourceLabel: "字幕",
        totalCharacters: 0,
        sections: [{ index: 0, markdown: "   ", cueIds: [] }],
        generatedAt: 1,
      }),
    /没有可合并/,
  );
});

test("headings ignore fenced code and file names stay safe", () => {
  assert.deepEqual(documentHeadings("# 一级\n## 二级\n```md\n## 不是标题\n```\n### 三级 ###"), [
    { level: 2, title: "二级" },
    { level: 3, title: "三级" },
  ]);
  assert.equal(markdownFileName('a/b:c*?"<>|', "完整文档"), "a_b_c______-完整文档.md");
});

test("a final document refuses missing or truncated sections instead of claiming completeness", () => {
  const input = {
    title: "课程", videoUrl: "https://example.test/video", sourceLabel: "原文", totalCharacters: 10,
    generatedAt: 1,
  };
  assert.throws(() => assembleFullDocument({ ...input, sections: [sections[0]] }), /缺失或未完整输出/);
  assert.throws(() => assembleFullDocument({ ...input, sections: [{ ...sections[1], warning: "输出达到长度限制" }] }), /缺失或未完整输出/);
});
