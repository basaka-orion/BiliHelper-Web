const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  assembleFullDocument,
  assemblePartialDocument,
  assembleArticle,
  assemblePartialArticle,
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

const articleInput = {
  title: "从视频到完整文章",
  videoUrl: "https://example.test/video",
  sourceLabel: "完整字幕",
  totalCharacters: 23522,
  generatedAt: 1,
};

test("article assembly keeps long sequential prose, unique details and examples without summary packaging", () => {
  const first = "首先确定输入的边界，参数 timeout=1250 不可省略。".repeat(180);
  const middle = "接着使用逐字模式整理，保留版本 v3.8.1 与例外条件。".repeat(180);
  const last = "最终保存为 report-final.md，并检查退出码 7 对应的恢复方法。".repeat(180);
  const markdown = assembleArticle({ ...articleInput, sections: [
    { index: 2, markdown: `# 从视频到完整文章\n\n${last}`, cueIds: ["3"] },
    { index: 0, markdown: `# 从视频到完整文章\n\n${first}\n\n## 真实主题\n\n\`\`\`sh\nrun --timeout=1250 --mode=verbatim\n\`\`\``, cueIds: ["1"] },
    { index: 1, markdown: `## 从视频到完整文章\n\n${middle}\n\n这里的完整示例跨越两个处理段。`, cueIds: ["2"] },
  ] });
  assert.match(markdown, /^# 从视频到完整文章\n\n首先/);
  assert.equal(markdown.split("从视频到完整文章").length - 1, 1);
  assert.ok(markdown.includes(first));
  assert.ok(markdown.includes(middle));
  assert.ok(markdown.includes(last));
  assert.ok(markdown.indexOf(first) < markdown.indexOf(middle));
  assert.ok(markdown.indexOf(middle) < markdown.indexOf(last));
  assert.ok(markdown.includes("run --timeout=1250 --mode=verbatim"));
  assert.match(markdown, /## 真实主题/);
  assert.doesNotMatch(markdown, /文档目录|完整整理 · 来源|全文 23,522|分 3 段整理|^---$|尚未整理完成/m);
});

test("article citations drop decoration but preserve prose labels and all fenced, indented and inline code", () => {
  const code = "````md\n# 从视频到完整文章\n[查看原文](source:4)\n```\n[真实字符串](source:5)\n```\n````";
  const inline = "``const x = `[查看原文](source:3)`;``";
  const indented = "    const x = '[查看原文](source:6)';";
  const markdown = assembleArticle({ ...articleInput, sections: [{
    index: 0, cueIds: ["1"],
    markdown: `${indented}\n\n正文保留[参数说明](source:1)，去掉装饰。[查看原文](source:1)[回看](source:2)\n\n${inline}\n\n${code}\n\n## 保留的自然章节\n\n全文结束。`,
  }] });
  assert.ok(markdown.includes(indented));
  assert.ok(markdown.includes(inline));
  assert.ok(markdown.includes(code));
  assert.match(markdown, /正文保留参数说明，去掉装饰。\n/);
  assert.match(markdown, /## 保留的自然章节/);
});

test("article titles are removed only on exact match and code spans can cross lines", () => {
  const markdown = assembleArticle({ ...articleInput, sections: [{
    index: 0, cueIds: ["1"], markdown: "# 从视频到完整文章的边界\n\n`const value = \n[查看原文](source:2)`\n\n正文。",
  }] });
  assert.match(markdown, /## 从视频到完整文章的边界/);
  assert.ok(markdown.includes("`const value = \n[查看原文](source:2)`"));
});

test("article assembly validates the complete sequence before skipping first, middle and last advertising sections", () => {
  const omitted = (index) => ({ index, markdown: "", cueIds: [String(index + 1)], omitted: true });
  const markdown = assembleArticle({ ...articleInput, sections: [
    omitted(0), { index: 1, markdown: "第一条真实信息。", cueIds: ["2"] }, omitted(2),
    { index: 3, markdown: "最后一条真实信息。", cueIds: ["4"] }, omitted(4),
  ] });
  assert.equal(markdown, "# 从视频到完整文章\n\n第一条真实信息。\n\n最后一条真实信息。\n");
  assert.throws(() => assembleArticle({ ...articleInput, sections: [omitted(0), omitted(1)] }), /原文只有寒暄\/广告\/重复，没有可生成的文稿正文/);
  assert.throws(() => assembleArticle({ ...articleInput, sections: [omitted(0), omitted(2)] }), /缺失或未完整输出/);
});

test("article completeness rejects gaps, output warnings and unmarked empty ranges; partial output says unfinished", () => {
  const section = { index: 0, markdown: "真正的正文。", cueIds: ["1"] };
  assert.throws(() => assembleArticle({ ...articleInput, sections: [{ ...section, index: 1 }] }), /缺失或未完整输出/);
  assert.throws(() => assembleArticle({ ...articleInput, sections: [{ ...section, warning: "长度截断" }] }), /缺失或未完整输出/);
  assert.throws(() => assembleArticle({ ...articleInput, sections: [section, { index: 1, markdown: "", cueIds: ["2"] }] }), /缺失或未完整输出/);
  assert.throws(() => assembleArticle({ ...articleInput, sections: [{ ...section, omitted: true }] }), /缺失或未完整输出/);
  assert.throws(() => assembleArticle({ ...articleInput, sections: [] }), /没有可合并/);
  const partial = assemblePartialArticle({ ...articleInput, sections: [section] });
  assert.match(partial, /真正的正文。/);
  assert.match(partial, /文稿尚未整理完成，以上是已经完成的部分/);
});
