const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  parseTranscript,
  platformSourceCues,
  buildSourceEvidence,
  automaticSourceEvidence,
  automaticSourceCues,
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

class MockHttpError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Exercise the real route with in-memory provider boundaries, without credentials or network.
function tutorialRoute({
  requestJson = async () => {
    throw new Error("Unexpected upstream request");
  },
  fetch = async () => {
    throw new Error("Unexpected AI request");
  },
  signals = AbortSignal,
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
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name.endsWith("/upstream"))
      return {
        HttpError: MockHttpError,
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
  new Function("require", "module", "exports", "process", "fetch", "AbortSignal", outputText)(
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
    signals,
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
  const actualInput = sent.messages.at(-1).content;
  assert.ok(!actualInput.includes("甲"));
  assert.ok(actualInput.includes("乙".repeat(1000)));
  assert.doesNotMatch(actualInput, /视频标题：/);
  assert.match(sent.messages[0].content, /source:编号/);
  assert.match(sent.messages[0].content, /步骤的排列序号不是原文 id/);
  assert.match(sent.messages[0].content, /每一条关键知识、每一个操作步骤都必须/);
  assert.match(sent.messages[0].content, /const 不保证对象或数组的内容不可修改/);
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

test("automatic captions preserve only the documented startTime and end seconds", () => {
  assert.deepEqual(automaticSourceCues([
    { text: "真实片段", startTime: 53.58, end: 65.08, index: 9 },
    { text: "仅有开始", startTime: 0 },
    { text: "倒序结束", startTime: 12, end: 8 },
    { text: "不猜字段", start: 1500, endTime: 2000 },
    { text: "非法时间", startTime: -1, end: Infinity },
    { text: "不转换字符串", startTime: "20", end: 21 },
    { text: null, startTime: 1, end: 2 },
  ]), [
    { id: "1", text: "真实片段", start: 53.58, end: 65.08 },
    { id: "2", text: "仅有开始", start: 0 },
    { id: "3", text: "倒序结束", start: 12 },
    { id: "4", text: "不猜字段" },
    { id: "5", text: "非法时间" },
    { id: "6", text: "不转换字符串" },
  ]);
});

test("source failure keeps safe upstream status classification without exposing raw details", async () => {
  const scenarios = [
    [401, /认证失败（401）.*凭据配置/],
    [403, /拒绝访问（403）.*权限或可用额度/],
    [402, /额度不足（402）/],
    [429, /请求过于频繁（429）/],
    [503, /访问失败（503）/],
  ];
  for (const [status, expected] of scenarios) {
    const post = tutorialRoute({ requestJson: async () => {
      throw new MockHttpError(`视频 AI 服务暂时无法访问（${status}），请稍后重试。raw-test-secret https://secret.invalid/?token=test-only`);
    } });
    const { events } = await routeEvents(post, {});
    const message = events.find(event => event.error).error;
    assert.match(message, expected);
    assert.match(message, /粘贴字幕/);
    assert.doesNotMatch(JSON.stringify(events), /raw-test-secret|secret\.invalid|test-only|test-token/);
  }
});

test("network and extraction timeouts remain distinct from credential failures", async () => {
  const network = tutorialRoute({ requestJson: async () => {
    throw new MockHttpError('视频 AI 服务连接超时或暂时不可用，请稍后重试');
  } });
  const networkResult = await routeEvents(network, {});
  assert.match(networkResult.events.find(event => event.error).error, /连接超时或暂时不可用/);
  const timeout = new AbortController(); timeout.abort();
  const timedOut = tutorialRoute({
    signals: { any: AbortSignal.any.bind(AbortSignal), timeout: () => timeout.signal },
    requestJson: async () => { throw new MockHttpError('视频 AI 服务连接超时或暂时不可用，请稍后重试'); },
  });
  const timeoutResult = await routeEvents(timedOut, {});
  assert.match(timeoutResult.events.find(event => event.error).error, /响应超时/);
  assert.doesNotMatch(JSON.stringify(timeoutResult.events), /认证失败|凭据配置/);
});

function modelResponse() {
  return new Response('data: {"choices":[{"delta":{"content":"## 关键知识\\n依据原文 [查看原文](source:1)"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
}

test("successful platform fallback does not report an earlier automatic authentication error", async () => {
  const post = tutorialRoute({
    requestJson: async url => {
      if (url.includes('bibigpt')) throw new MockHttpError('视频 AI 服务暂时无法访问（401），请稍后重试');
      return { body: [{ content: '所选平台字幕的实际教学内容。', from: 2, to: 8 }] };
    },
    fetch: async () => modelResponse(),
  });
  const { events } = await routeEvents(post, { subtitleUrl: 'https://aisubtitle.hdslb.com/test.json' });
  assert.ok(events.some(event => event.text));
  assert.ok(!events.some(event => event.error || event.warning));
  assert.equal(events.find(event => event.evidence).evidence.kind, 'subtitle');
  assert.doesNotMatch(JSON.stringify(events), /401|凭据配置/);
});

test("automatic transcript timing reaches the evidence and model without guessing units", async () => {
  let sent;
  const post = tutorialRoute({
    requestJson: async () => ({ success: true, detail: { subtitlesArray: [{ text: '设置 price 的数值。', startTime: 53.58, end: 65.08, index: 10 }] } }),
    fetch: async (_url, options) => { sent = JSON.parse(options.body); return modelResponse(); },
  });
  const { events } = await routeEvents(post, {});
  assert.deepEqual(events.find(event => event.evidence).evidence.cues[0], { id: '1', text: '设置 price 的数值。', start: 53.58, end: 65.08 });
  assert.match(sent.messages.at(-1).content, /"start":53\.58/);
  assert.ok(!events.some(event => event.error));
});

test("automatic connection and server failures use only the official alias without redirects", async () => {
  for (const failure of [
    new MockHttpError('视频 AI 服务连接超时或暂时不可用，请稍后重试'),
    new MockHttpError('视频 AI 服务暂时无法访问（503），请稍后重试'),
  ]) {
    const requests = [];
    const post = tutorialRoute({ requestJson: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) throw failure;
      return { success: true, summary: '## 本节目的\n通过官方备用入口取得内容。' };
    } });
    const { events } = await routeEvents(post, {});
    assert.deepEqual(requests.map(request => request.url), [
      'https://api.bibigpt.co/api/v1/summarizeWithConfig',
      'https://bibigpt.co/api/v1/summarizeWithConfig',
    ]);
    for (const { options } of requests) {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(options.method, 'POST');
    }
    assert.equal(requests[0].options.body, requests[1].options.body);
    assert.ok(events.some(event => event.text?.includes('官方备用入口')));
    assert.ok(!events.some(event => event.error));
  }
});

test("authentication, quota, rate limit, invalid output and successful responses never use the alias", async () => {
  const failures = [400, 401, 402, 403, 429].map(status => new MockHttpError(`视频 AI 服务暂时无法访问（${status}），请稍后重试`));
  failures.push(new MockHttpError('视频 AI 服务返回了验证页面，请稍后重试'), new Error('unexpected failure'));
  for (const result of [...failures, { success: true, summary: '已有内容' }, { success: false }]) {
    let requests = 0;
    const post = tutorialRoute({ requestJson: async () => {
      requests++;
      if (result instanceof Error) throw result;
      return result;
    } });
    await routeEvents(post, {});
    assert.equal(requests, 1);
  }
});

test("primary timeout and alias share one total extraction budget", async () => {
  const timers = new Map(), combined = [], requests = [];
  const post = tutorialRoute({
    signals: {
      timeout: milliseconds => {
        assert.ok(!timers.has(milliseconds), 'a timeout budget must not be reset for the alias');
        const controller = new AbortController();
        timers.set(milliseconds, controller);
        return controller.signal;
      },
      any: signals => { combined.push(signals); return AbortSignal.any(signals); },
    },
    requestJson: async (url, options) => {
      requests.push(url);
      if (requests.length === 1) {
        assert.equal(options.signal.aborted, false);
        timers.get(10000).abort();
        assert.equal(options.signal.aborted, true);
      } else {
        assert.equal(options.signal.aborted, false, 'the expired primary timeout must not abort the alias');
        timers.get(25000).abort();
        assert.equal(options.signal.aborted, true, 'the alias must stop at the original total deadline');
      }
      throw new MockHttpError('视频 AI 服务连接超时或暂时不可用，请稍后重试');
    },
  });
  const { events } = await routeEvents(post, {});
  assert.deepEqual([...timers.keys()], [25000, 10000]);
  assert.equal(requests.length, 2);
  assert.ok(combined[0].includes(timers.get(25000).signal));
  assert.ok(combined[1].includes(timers.get(25000).signal));
  assert.ok(!combined[1].includes(timers.get(10000).signal));
  assert.match(events.find(event => event.error).error, /响应超时/);
});

test("an exhausted total extraction budget never starts an alias request", async () => {
  const budget = new AbortController();
  let requests = 0;
  const post = tutorialRoute({
    signals: {
      timeout: milliseconds => milliseconds === 25000 ? budget.signal : new AbortController().signal,
      any: AbortSignal.any.bind(AbortSignal),
    },
    requestJson: async () => {
      requests++;
      budget.abort();
      throw new MockHttpError('视频 AI 服务连接超时或暂时不可用，请稍后重试');
    },
  });
  const { events } = await routeEvents(post, {});
  assert.equal(requests, 1);
  assert.match(events.find(event => event.error).error, /响应超时/);
});
