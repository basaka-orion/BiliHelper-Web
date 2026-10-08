const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  parseTranscript,
  platformSourceCues,
  buildSourceEvidence,
  automaticSourceEvidence,
  sourcePrompt,
  validTranscriptOffset,
} = require(path.join(process.env.BILI_TEST_BUILD, "learning-source.js"));

test("manual SRT retains real timing and stable source ids", () => {
  const cues = parseTranscript(
    "\uFEFF1\r\n00:00:01,250 --> 00:00:03,600\r\n先安装 Python。\r\n\r\n2\r\n00:01:04,000 --> 00:01:08,500\r\n再打开终端。\r\n输入命令。",
  );
  assert.deepEqual(cues, [
    { id: "1", text: "先安装 Python。", start: 1.25, end: 3.6 },
    { id: "2", text: "再打开终端。\n输入命令。", start: 64, end: 68.5 },
  ]);
});

test("WebVTT supports cue settings and ignores metadata without inventing times", () => {
  const cues = parseTranscript(
    "WEBVTT\nKind: captions\n\nNOTE 这是注释\n不应进入字幕\n\nintro\n00:01.000 --> 00:03.500 align:start\n<v 老师><i>打开</i> &amp; 保存。\n\n00:04.000 --> 00:05.000\n第二步。",
  );
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], {
    id: "1",
    text: "打开 & 保存。",
    start: 1,
    end: 3.5,
  });
  assert.equal(cues[1].start, 4);
  assert.deepEqual(
    parseTranscript("WEBVTT\n00:01.000 --> 00:03.000\n没有额外空行。"),
    [{ id: "1", text: "没有额外空行。", start: 1, end: 3 }],
  );
});

test("plain text and malformed timing are retained as untimed source text", () => {
  const cues = parseTranscript(
    '安装 Python 后打开终端。\n\n尝试运行 print("你好")。',
  );
  assert.equal(cues.length, 2);
  assert.ok(
    cues.every((cue) => cue.start === undefined && cue.end === undefined),
  );
  for (const stamp of ["00:61.000 --> 00:62.000", "00:04.000 --> 00:03.000"]) {
    const malformed = parseTranscript(`${stamp}\n原文不会因为时间错误而消失。`);
    assert.equal(malformed[0].start, undefined);
    assert.match(malformed[0].text, /原文不会/);
  }
});

test("SRT with missing cue separators does not copy the next cue number into text", () => {
  assert.deepEqual(
    parseTranscript(
      "1\n00:00:01,000 --> 00:00:02,000\n第一段\n2\n00:00:03,000 --> 00:00:04,000\n第二段",
    ),
    [
      { id: "1", text: "第一段", start: 1, end: 2 },
      { id: "2", text: "第二段", start: 3, end: 4 },
    ],
  );
});

test("platform source keeps words while rejecting invalid timestamps", () => {
  const cues = platformSourceCues([
    { content: "开始", from: 0, to: 2.2 },
    { content: "无有效开始时间", from: -1, to: 5 },
    { content: "无有效结束时间", from: 9, to: 3 },
    { content: "非数值时间", from: "10", to: Infinity },
    { content: null, from: 1, to: 2 },
  ]);
  assert.deepEqual(cues, [
    { id: "1", text: "开始", start: 0, end: 2.2 },
    { id: "2", text: "无有效开始时间" },
    { id: "3", text: "无有效结束时间", start: 9 },
    { id: "4", text: "非数值时间" },
  ]);
});

test("source windows declare their exact coverage and keep citations stable across a boundary", () => {
  const cues = [
    { id: "1", text: "甲".repeat(19990), start: 0, end: 60 },
    { id: "2", text: "乙".repeat(20020), start: 60, end: 120 },
  ];
  const first = buildSourceEvidence(cues, "subtitle", "平台字幕");
  const second = buildSourceEvidence(cues, "subtitle", "平台字幕", 20000);
  const last = buildSourceEvidence(cues, "subtitle", "平台字幕", 40000);
  assert.equal(first.totalCharacters, 40011);
  assert.equal(first.analyzedCharacters, 20000);
  assert.equal(first.coverage, "partial");
  assert.equal(first.cues[1].text.length, 9);
  assert.equal(second.cues[0].id, "2");
  assert.equal(second.cues[0].start, 60);
  assert.equal(second.cues[0].text.length, 20000);
  assert.match(second.limitation, /20001–40000/);
  assert.equal(last.analyzedCharacters, 11);
  assert.equal(last.cues[0].text.length, 11);
  assert.match(last.limitation, /40001–40011/);
});

test("only complete supplied text is full coverage; automatic summaries remain unknown", () => {
  const full = buildSourceEvidence(
    parseTranscript("原文第一段。\n\n原文第二段。"),
    "manual",
    "用户字幕",
  );
  assert.equal(full.coverage, "full");
  assert.equal(full.totalCharacters, full.analyzedCharacters);
  assert.match(full.limitation, /取决于来源/);
  const automatic = automaticSourceEvidence();
  assert.equal(automatic.coverage, "unknown");
  assert.deepEqual(automatic.cues, []);
  assert.equal(automatic.totalCharacters, undefined);
  assert.deepEqual(JSON.parse(sourcePrompt(full)), full.cues);
});

test("invalid or unavailable ranges fail explicitly instead of analyzing another segment", () => {
  const cues = parseTranscript("这是当前片段。");
  for (const offset of [-1, 1, 1.5, NaN, Infinity, "20000", null]) {
    assert.equal(validTranscriptOffset(offset), false);
    assert.throws(
      () => buildSourceEvidence(cues, "manual", "字幕", offset),
      /范围无效/,
    );
  }
  assert.equal(validTranscriptOffset(60000), true);
  assert.throws(
    () => buildSourceEvidence(cues, "manual", "字幕", 20000),
    /超出/,
  );
  assert.throws(() => buildSourceEvidence([], "manual", "字幕"), /没有可分析/);
});

// Exercise the real route with in-memory provider boundaries, without credentials or network.
function tutorialRoute({
  requestJson = async () => {
    throw new Error("Unexpected upstream request");
  },
  fetch = async () => {
    throw new Error("Unexpected AI request");
  },
} = {}) {
  const fs = require("node:fs");
  const ts = require("typescript");
  const { outputText } = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../app/api/tutorial/route.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );
  class HttpError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name.endsWith("/upstream"))
      return {
        HttpError,
        requestJson,
        errorResponse: (error) =>
          Response.json(
            { error: error.message },
            { status: error.status || 500 },
          ),
      };
    if (/\/lib\/(video-url|sse|learning-source)$/.test(name))
      return require(
        path.join(process.env.BILI_TEST_BUILD, path.basename(name) + ".js"),
      );
    throw new Error(`Unexpected route dependency: ${name}`);
  };
  new Function("require", "module", "exports", "process", "fetch", outputText)(
    localRequire,
    module,
    module.exports,
    {
      env: {
        BIBIGPT_API_TOKEN: "test-token",
        SILICONFLOW_API_KEY: "test-token",
      },
    },
    fetch,
  );
  return module.exports.POST;
}

async function routeEvents(post, body) {
  const response = await post({
    json: async () => ({
      videoUrl: "https://www.bilibili.com/video/BV1wD4y1o7AS",
      title: "教学视频",
      ...body,
    }),
    signal: new AbortController().signal,
  });
  const text = await response.text();
  return {
    response,
    events: text
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6))),
  };
}

test("tutorial route sends only the chosen text window and its evidence to the model", async () => {
  let sent;
  const post = tutorialRoute({
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"## 关键知识\\n第二片段 [查看原文](source:1)"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const { response, events } = await routeEvents(post, {
    transcript: "甲".repeat(20000) + "乙".repeat(1000),
    transcriptOffset: 20000,
  });
  assert.equal(response.status, 200);
  const evidence = events.find((event) => event.evidence).evidence;
  assert.equal(evidence.coverage, "partial");
  assert.equal(evidence.analyzedCharacters, 1000);
  assert.equal(evidence.cues[0].text, "乙".repeat(1000));
  assert.ok(!sent.messages[1].content.includes("甲"));
  assert.match(sent.messages[0].content, /source:编号/);
  assert.ok(events.some((event) => event.text?.includes("source:1")));
});

test("automatic summary has unknown coverage and cannot masquerade as a selected later segment", async () => {
  const post = tutorialRoute({
    requestJson: async () => ({
      success: true,
      summary: "## 本节目的\n这是自动摘要。",
    }),
  });
  const normal = await routeEvents(post, {});
  assert.equal(
    normal.events.find((event) => event.evidence).evidence.coverage,
    "unknown",
  );
  assert.ok(normal.events.some((event) => event.text));
  const later = await routeEvents(post, { transcriptOffset: 20000 });
  assert.ok(!later.events.some((event) => event.text));
  assert.match(
    later.events.find((event) => event.error).error,
    /没有可选择范围的原文/,
  );
});

test("a later Bilibili part never invokes the automatic provider for part one", async () => {
  let requested = false;
  const post = tutorialRoute({
    requestJson: async () => {
      requested = true;
      return { success: true, summary: "第1P" };
    },
  });
  const { events } = await routeEvents(post, {
    videoUrl: "https://www.bilibili.com/video/BV1wD4y1o7AS?p=2",
  });
  assert.equal(requested, false);
  assert.ok(!events.some((event) => event.text));
  assert.match(events.find((event) => event.error).error, /当前分 P/);
});
