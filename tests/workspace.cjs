const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  STORAGE_KEY,
  emptyWorkspace,
  documentId,
  createDocument,
  readWorkspace,
  migrateHistory,
  serializeWorkspace,
  upsertDocument,
  readMindMapSection,
} = require(path.join(process.env.BILI_TEST_BUILD, "workspace.js"));

const url = "https://www.bilibili.com/video/BV1wD4y1o7AS";
function video(part = 1) {
  return {
    platform: "bilibili",
    title: "Python 课程",
    uploader: "教师",
    url: `${url}?p=${part}`,
    bvid: "BV1wD4y1o7AS",
    selectedPage: part,
    cid: part,
    duration: 215,
    subtitles: [
      {
        lan: "zh-CN",
        lan_doc: "中文",
        subtitle_url: "https://i0.hdslb.com/subtitle.json",
      },
    ],
    hasSubtitles: true,
    pages: [
      { cid: 1, page: 1, title: "介绍", duration: 215 },
      { cid: 2, page: 2, title: "安装", duration: 450 },
    ],
  };
}
function note(value = "完整笔记") {
  return {
    text: value,
    source: "平台字幕",
    status: "complete",
    generatedAt: 123,
    evidence: {
      kind: "subtitle",
      label: "中文字幕",
      coverage: "full",
      totalCharacters: 5,
      analyzedCharacters: 5,
      cues: [{ id: "1", text: "原文内容。", start: 12.5, end: 15 }],
    },
  };
}
function workspaceWith(...documents) {
  return documents.reduce(upsertDocument, emptyWorkspace());
}

test("workspace identities normalize tracking and distinguish course parts", () => {
  assert.equal(documentId(`${url}?p=1&track=abc`), url);
  assert.equal(documentId(`${url}?p=2&track=abc`), `${url}?p=2`);
  assert.equal(
    documentId("https://youtu.be/dQw4w9WgXcQ?t=20"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.throws(() =>
    documentId("https://bilibili.com.evil.test/video/BV1wD4y1o7AS"),
  );
  assert.equal(STORAGE_KEY, "bili-learning-workspace-v1");
  const document = createDocument(video(2));
  assert.equal(document.id, `${url}?p=2`);
  assert.equal(document.video.selectedPage, 2);
  assert.equal(document.transcriptOffset, 0);
  assert.equal(document.generationState, "idle");
  assert.equal(document.noteMode, "article");
});

test("complete note, previous version, draft, source evidence and user work survive a reload", () => {
  const document = createDocument(video(2));
  Object.assign(document, {
    transcript: "用户粘贴的真实字幕",
    transcriptOffset: 3,
    subtitleIndex: "0",
    memo: "我的理解",
    note: note(),
    previousNote: note("上一版"),
    draft: { ...note("收到一半"), status: "partial" },
    generationState: "running",
    scrollY: 521,
    updatedAt: 456,
  });
  const original = workspaceWith(document);
  const serialized = serializeWorkspace(original);
  assert.equal(
    JSON.parse(serialized).documents[document.id].generationState,
    "running",
  );
  const restored = readWorkspace(serialized);
  const actual = restored.documents[document.id];
  assert.equal(actual.generationState, "interrupted");
  assert.deepEqual(actual.note, document.note);
  assert.deepEqual(actual.previousNote, document.previousNote);
  assert.deepEqual(actual.draft, document.draft);
  for (const key of [
    "transcript",
    "transcriptOffset",
    "subtitleIndex",
    "memo",
    "scrollY",
    "updatedAt",
  ])
    assert.equal(actual[key], document[key]);
  assert.equal(
    original.documents[document.id].generationState,
    "running",
    "saving must not mutate an active request",
  );
});

test("updating a background document preserves the selected part and other documents", () => {
  const first = createDocument(video(1)),
    second = createDocument(video(2));
  const original = workspaceWith(first, second);
  const updated = upsertDocument(original, { ...second, note: note() });
  assert.equal(updated.activeId, first.id);
  assert.equal(updated.documents[first.id], original.documents[first.id]);
  assert.equal(original.documents[second.id].note, undefined);
  assert.equal(updated.documents[second.id].note.text, "完整笔记");
});

test("a later platform-caption range survives reload without a pasted transcript", () => {
  const document = createDocument(video());
  document.transcriptOffset = 20000;
  const restored = readWorkspace(serializeWorkspace(workspaceWith(document)));
  assert.equal(restored.documents[document.id].transcript, "");
  assert.equal(restored.documents[document.id].transcriptOffset, 20000);
});

test("corrupt and heterogeneous storage does not hide valid documents or pollute prototypes", () => {
  for (const raw of [
    null,
    "",
    "{",
    "null",
    "[]",
    "1",
    '{"version":2,"documents":{}}',
    '{"version":1,"documents":[]}',
  ]) {
    assert.equal(Object.keys(readWorkspace(raw).documents).length, 0);
  }
  const good = createDocument(video(2));
  good.note = note();
  const payload = JSON.parse(
    '{"version":1,"activeId":"__proto__","documents":{"__proto__":{"polluted":true},"constructor":{"polluted":true},"null":null,"array":[],"bad":{"video":{"url":"file:///etc/passwd"}}}}',
  );
  payload.documents.wrongStoredKey = good;
  const restored = readWorkspace(JSON.stringify(payload));
  assert.equal(Object.getPrototypeOf(restored.documents), null);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(Object.keys(restored.documents), [good.id]);
  assert.equal(restored.activeId, good.id);
  assert.equal(restored.documents[good.id].note.text, "完整笔记");
});

test("malformed optional fields recover safely and unsafe evidence timestamps are omitted", () => {
  const document = createDocument(video());
  Object.assign(document, {
    transcript: {},
    memo: [],
    transcriptOffset: -5,
    scrollY: -10,
    subtitleIndex: "__proto__",
    note: note(),
    previousNote: { text: ["wrong type"] },
    generationState: "other",
  });
  document.note.evidence.cues[0].start = -1;
  document.note.evidence.cues[0].end = -2;
  const restored = readWorkspace(
    JSON.stringify({
      version: 1,
      documents: { any: document },
      activeId: document.id,
    }),
  ).documents[document.id];
  assert.equal(restored.memo, "");
  assert.equal(restored.transcript, "");
  assert.equal(restored.transcriptOffset, 0);
  assert.equal(restored.scrollY, 0);
  assert.equal(restored.subtitleIndex, "auto");
  assert.equal(restored.previousNote, undefined);
  assert.equal(restored.generationState, "idle");
  assert.deepEqual(restored.note.evidence.cues, [
    { id: "1", text: "原文内容。" },
  ]);
});

test("legacy history migrates only valid supported URLs and deduplicates normalized parts", () => {
  const migrated = migrateHistory(
    JSON.stringify([
      null,
      1,
      [],
      { url: `${url}?p=1`, title: "第一节" },
      { url: `${url}?tracking=abc`, title: "重复" },
      { url: `${url}?p=2`, title: "第二节" },
      { url: "https://evil.test/", title: "坏链接" },
      { url, title: {} },
    ]),
  );
  assert.deepEqual(migrated, [
    { url, title: "第一节" },
    { url: `${url}?p=2`, title: "第二节" },
  ]);
  for (const raw of [null, "{", "null", "{}"])
    assert.deepEqual(migrateHistory(raw), []);
});

test("metadata pruning never silently evicts old notes, memos, transcripts or prior versions", () => {
  let workspace = emptyWorkspace();
  const protectedIds = [];
  for (let part = 1; part <= 60; part++) {
    const document = createDocument(video(part));
    document.updatedAt = part;
    if (part <= 30) {
      if (part % 5 === 0) document.note = note();
      else if (part % 5 === 1) document.memo = "保留我的备注";
      else if (part % 5 === 2) document.transcript = "保留我的字幕";
      else if (part % 5 === 3) document.previousNote = note("旧版也要保留");
      else document.draft = { ...note("未完成内容"), status: "partial" };
      protectedIds.push(document.id);
    }
    workspace = upsertDocument(workspace, document);
  }
  const restored = readWorkspace(serializeWorkspace(workspace));
  for (const id of protectedIds)
    assert.ok(restored.documents[id], `must retain user work for ${id}`);
  assert.equal(Object.keys(restored.documents).length, 54);
  assert.equal(
    Object.keys(workspace.documents).length,
    60,
    "serialization does not change the in-memory workspace",
  );
});

test("storage pressure reports an actionable error instead of discarding protected work", () => {
  const first = createDocument(video(1)),
    second = createDocument(video(2));
  first.memo = "甲".repeat(1100000);
  second.note = note("乙".repeat(1100000));
  const workspace = workspaceWith(first, second);
  assert.throws(() => serializeWorkspace(workspace), /尚未保存.*导出/);
  assert.equal(workspace.documents[first.id].memo.length, 1100000);
  assert.equal(workspace.documents[second.id].note.text.length, 1100000);
  first.memo = "甲".repeat(2200000);
  assert.throws(
    () => serializeWorkspace(workspaceWith(first)),
    /尚未保存.*导出/,
    "oversized individual user content cannot become an empty record",
  );
});

test("large expendable metadata can be pruned to fit without evicting the active note", () => {
  const active = createDocument(video(1));
  active.note = note();
  let workspace = workspaceWith(active);
  for (let part = 2; part <= 30; part++) {
    const document = createDocument({
      ...video(part),
      description: "资料".repeat(50000),
    });
    document.updatedAt = part;
    workspace = upsertDocument(workspace, document);
  }
  const serialized = serializeWorkspace(workspace);
  assert.ok(serialized.length <= 2 * 1024 * 1024);
  assert.deepEqual(
    readWorkspace(serialized).documents[active.id].note,
    active.note,
  );
});

test("full document mode, completed sections and resume state survive a reload", () => {
  const document = createDocument(video(1));
  const source = {
    kind: "subtitle",
    label: "完整字幕",
    coverage: "full",
    totalCharacters: 7001,
    analyzedCharacters: 7001,
    limitation: "已整理全部字幕。",
    cues: [
      { id: "1", text: "第一段。".repeat(875), start: 0, end: 2 },
      { id: "2", text: "第二段。".repeat(875), start: 2, end: 4 },
    ],
  };
  document.noteMode = "full";
  document.generationState = "running";
  document.fullJob = {
    status: "running",
    source,
    totalCharacters: 7001,
    totalSections: 2,
    sections: [
      { index: 0, markdown: "## 第一段\n\n内容。[查看原文](source:1)", cueIds: ["1"] },
    ],
    startedAt: 1000,
    updatedAt: 2000,
  };
  document.draft = {
    text: "## 第一段\n\n内容。[查看原文](source:1)",
    source: "完整字幕",
    status: "partial",
    generatedAt: 1000,
    mode: "full",
    sectionCount: 1,
  };
  document.updatedAt = 2500;
  const restored = readWorkspace(serializeWorkspace(workspaceWith(document)));
  const saved = restored.documents[document.id];
  assert.equal(saved.noteMode, "full");
  assert.equal(saved.generationState, "interrupted");
  assert.equal(saved.fullJob.status, "paused");
  assert.equal(saved.fullJob.mode, "full");
  assert.equal(saved.fullJob.totalSections, 2);
  assert.equal(saved.fullJob.sections.length, 1);
  assert.equal(saved.fullJob.sections[0].cueIds[0], "1");
  assert.equal(saved.fullJob.source.cues.length, 2);
  assert.equal(saved.draft.mode, "full");
  assert.equal(saved.draft.sectionCount, 1);
});

test("a completed full note keeps its mode and complete source evidence", () => {
  const document = createDocument(video(1));
  document.noteMode = "full";
  document.note = {
    ...note("# 完整文档\n\n## 第一章\n\n正文。[查看原文](source:1)"),
    mode: "full",
    sectionCount: 3,
    evidence: {
      kind: "subtitle",
      label: "完整字幕",
      coverage: "full",
      totalCharacters: 12,
      analyzedCharacters: 12,
      limitation: "已整理全部字幕。",
      cues: [
        { id: "1", text: "第一段原文。", start: 0, end: 2 },
        { id: "2", text: "第二段原文。", start: 2, end: 4 },
        { id: "3", text: "第三段原文。", start: 4, end: 6 },
      ],
    },
  };
  const restored = readWorkspace(serializeWorkspace(workspaceWith(document)));
  const saved = restored.documents[document.id].note;
  assert.equal(saved.mode, "full");
  assert.equal(saved.sectionCount, 3);
  assert.equal(saved.evidence.coverage, "full");
  assert.equal(saved.evidence.cues.length, 3);
});

test("legacy documents default to full writing while explicit study preference and existing notes remain", () => {
  const document = createDocument(video(1));
  document.note = note("既有学习笔记");
  delete document.noteMode;
  let restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.noteMode, "full");
  assert.equal(restored.note.text, "既有学习笔记");
  document.noteMode = "study";
  restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.noteMode, "study");
});

test("a length-limited saved full section resumes before that section and cannot be saved as completed work", () => {
  const document = createDocument(video(1));
  document.fullJob = {
    status: "paused",
    source: { kind: "manual", label: "字幕", coverage: "full", cues: [
      { id: "1", text: "甲".repeat(3500) }, { id: "2", text: "乙".repeat(3500) },
    ] },
    totalCharacters: 7001, totalSections: 2, startedAt: 1, updatedAt: 2,
    sections: [
      { index: 0, markdown: "## 第一节\n完整内容", cueIds: ["1"] },
      { index: 1, markdown: "## 第二节\n尚未输出完", cueIds: ["2"], warning: "输出达到长度限制" },
    ],
  };
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /进度超出本机保存范围/);
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 1);
  assert.equal(restored.fullJob.status, "error");
  assert.match(restored.fullJob.error, /第 2 段重新整理/);
  assert.equal(restored.fullJob.source.cues.length, 2);
});

function resumableJob(cues, sections, totalSections) {
  return {
    status: "paused",
    source: { kind: "manual", label: "完整字幕", coverage: "full", cues },
    totalCharacters: cues.map(cue => cue.text).join("\n").length,
    totalSections, sections, startedAt: 1, updatedAt: 2,
  };
}

test("resume rechecks old chunk boundaries instead of skipping new smaller source ranges", () => {
  const document = createDocument(video(1));
  const cues = [1, 2, 3, 4].map(id => ({ id: String(id), text: `内容${id}`.repeat(1000) }));
  document.fullJob = resumableJob(cues, [
    { index: 0, markdown: "## 旧大段\n曾整理原文 1 和 2", cueIds: ["1", "2"] },
  ], 2);
  const state = workspaceWith(document);
  assert.throws(() => serializeWorkspace(state), /进度超出本机保存范围/);
  const restored = readWorkspace(JSON.stringify(state)).documents[document.id];
  assert.equal(restored.fullJob.totalSections, 4);
  assert.equal(restored.fullJob.sections.length, 0);
  assert.match(restored.fullJob.error, /分段范围已更新.*保留 0 段/);
  assert.deepEqual(restored.fullJob.source.cues, cues);
});

test("resume keeps only the consecutive matching prefix and checks source id order", () => {
  const document = createDocument(video(1));
  const cues = [
    { id: "1", text: "甲".repeat(3500) },
    { id: "2", text: "乙".repeat(1000) },
    { id: "3", text: "丙".repeat(1000) },
    { id: "4", text: "丁".repeat(1000) },
    { id: "5", text: "戊".repeat(3500) },
  ];
  document.fullJob = resumableJob(cues, [
    { index: 0, markdown: "## 匹配\n完整保留", cueIds: ["1"] },
    { index: 1, markdown: "## 错序\n应重新整理", cueIds: ["3", "2", "4"] },
    { index: 2, markdown: "## 不可跨过中间的错配\n重做", cueIds: ["5"] },
  ], 3);
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /进度超出本机保存范围/);
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 1);
  assert.equal(restored.fullJob.sections[0].markdown, "## 匹配\n完整保留");
  assert.equal(restored.fullJob.totalSections, 3);
  assert.match(restored.fullJob.error, /第 2 段继续整理/);
});

test("resume updates only total section count when all completed ranges still match", () => {
  const document = createDocument(video(1));
  const cues = [1, 2, 3].map(id => ({ id: String(id), text: "字".repeat(3500) }));
  document.fullJob = resumableJob(cues, [
    { index: 0, markdown: "## 保留\n第一段已完成", cueIds: ["1"] },
  ], 2);
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 1);
  assert.equal(restored.fullJob.totalSections, 3);
  assert.match(restored.fullJob.error, /第 2 段继续整理/);
  assert.doesNotThrow(() => serializeWorkspace(workspaceWith(restored)));
});

test("an oversized legacy source preserves draft evidence without renumbering its citations", () => {
  const document = createDocument(video(1));
  const source = [{ id: "1", text: "旧".repeat(6000) }];
  document.fullJob = resumableJob(source, [], 1);
  document.draft = { ...note("## 旧草稿\n这条来自旧原文。[查看原文](source:1)"), status: "partial", mode: "full" };
  delete document.draft.evidence;
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob, undefined);
  assert.equal(restored.draft.text, document.draft.text);
  assert.equal(restored.draft.evidence.cues[0].text.length, 6000);
  assert.match(restored.draft.error, /重新读取原文/);
});

test("article selection, completed note, previous mode and resumable progress survive saving and refresh", () => {
  const document = createDocument(video(1));
  const cues = [1, 2, 3].map(id => ({ id: String(id), text: "真实内容".repeat(875) }));
  document.noteMode = "article";
  document.note = { ...note("# 一篇完整文章\n\n完整的自然正文。"), mode: "article", sectionCount: 3 };
  document.previousNote = { ...note("## 已有全文整理\n\n已有笔记。"), mode: "full" };
  document.draft = { ...note("# 一篇完整文章\n\n尚未完成的正文。"), mode: "article", status: "partial", sectionCount: 2 };
  document.fullJob = { ...resumableJob(cues, [
    { index: 0, markdown: "第一段正文。", cueIds: ["1"] },
    { index: 1, markdown: "第二段正文。", cueIds: ["2"] },
  ], 3), mode: "article", status: "running" };
  const restored = readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id];
  assert.equal(restored.noteMode, "article");
  assert.equal(restored.note.mode, "article");
  assert.equal(restored.note.text, document.note.text);
  assert.equal(restored.previousNote.mode, "full");
  assert.equal(restored.draft.mode, "article");
  assert.equal(restored.fullJob.mode, "article");
  assert.equal(restored.fullJob.status, "paused");
  assert.equal(restored.fullJob.sections.length, 2);
  assert.deepEqual(restored.fullJob.sections.map(row => row.cueIds), [["1"], ["2"]]);
});

test("changing the selected mode does not relabel an existing full job or its draft as an article", () => {
  const document = createDocument(video(1));
  const cues = [{ id: "1", text: "已有全文整理原文" }];
  document.noteMode = "article";
  document.fullJob = resumableJob(cues, [{ index: 0, markdown: "## 既有整理\n\n内容。", cueIds: ["1"] }], 1);
  document.draft = { ...note("## 既有整理\n\n内容。"), mode: "full", status: "partial" };
  const restored = readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id];
  assert.equal(restored.noteMode, "article");
  assert.equal(restored.fullJob.mode, "full");
  assert.equal(restored.draft.mode, "full");
  assert.equal(restored.fullJob.sections[0].markdown, document.fullJob.sections[0].markdown);
});

test("article resume preserves explicitly omitted source ranges with their ids, and still rejects truncated or mismatched ranges", () => {
  const document = createDocument(video(1));
  const cues = [1, 2, 3, 4].map(id => ({ id: String(id), text: "字".repeat(3500) }));
  document.fullJob = { ...resumableJob(cues, [
    { index: 0, markdown: "", cueIds: ["1"], omitted: true },
    { index: 1, markdown: "正文。", cueIds: ["2"] },
    { index: 2, markdown: "", cueIds: ["3"], omitted: true },
  ], 4), mode: "article" };
  let restored = readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.mode, "article");
  assert.equal(restored.fullJob.sections.length, 3);
  assert.deepEqual(restored.fullJob.sections[0], document.fullJob.sections[0]);
  assert.deepEqual(restored.fullJob.sections[2], document.fullJob.sections[2]);
  document.fullJob.sections.push({ index: 3, markdown: "尚未完成", warning: "长度截断", cueIds: ["4"] });
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /进度超出本机保存范围/);
  restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 3);
  assert.match(restored.fullJob.error, /第 4 段重新整理/);
  document.fullJob.sections[0].cueIds = ["2"];
  restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 0);
  assert.match(restored.fullJob.error, /第 1 段继续整理/);
});

test("only article jobs can persist empty advertising ranges; unmarked empty content cannot count as completed", () => {
  const document = createDocument(video(1));
  const cues = [{ id: "1", text: "广告内容" }];
  document.fullJob = { ...resumableJob(cues, [{ index: 0, markdown: "", cueIds: ["1"], omitted: true }], 1), mode: "full" };
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /进度超出本机保存范围/);
  document.fullJob.mode = "article";
  delete document.fullJob.sections[0].omitted;
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /进度超出本机保存范围/);
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.fullJob.sections.length, 0);
  assert.equal(restored.fullJob.mode, "article");
});

function mapSection(index, cueIds, sourceIds = cueIds) {
  return {
    version: 1, index, cueIds, sourceIds, fallback: false,
    nodes: sourceIds.length ? [{ id: `s${index + 1}-n1`, text: `第${index + 1}段原文细节`, sourceIds, children: [] }] : [],
  };
}

function mindmap(cues, sections, totalSections, status = "paused") {
  return {
    version: 1, title: "完整课程导图", status, sections, totalSections,
    source: { kind: "subtitle", label: "完整字幕", coverage: "full", cues,
      totalCharacters: cues.map(cue => cue.text).join("\n").length,
      analyzedCharacters: cues.map(cue => cue.text).join("\n").length },
    generatedAt: 100, updatedAt: 200,
  };
}

test("mindmap progress and source survive reload while an interrupted request becomes paused", () => {
  const document = createDocument(video());
  document.note = note("已有文章与导图分别保存");
  const cues = [
    { id: "1", text: "甲".repeat(3500), start: 0, end: 5 },
    { id: "2", text: "嗯，好，继续。", start: 5, end: 6 },
    { id: "3", text: "乙".repeat(3500), start: 6, end: 10 },
  ];
  document.mindmap = mindmap(cues, [mapSection(0, ["1"])], 2, "running");
  document.mindmap.sections[0].nodes[0].text = "原文代码 <script>alert(1)</script> 保持纯文本";
  const raw = serializeWorkspace(workspaceWith(document));
  assert.equal(JSON.parse(raw).documents[document.id].mindmap.status, "running");
  const restored = readWorkspace(raw).documents[document.id];
  assert.deepEqual(restored.mindmap, { ...document.mindmap, status: "paused" });
  assert.deepEqual(restored.note, document.note);
  assert.equal(document.mindmap.status, "running", "saving must not mutate the active map request");
  delete document.mindmap;
  assert.equal(readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id].mindmap, undefined);
});

test("completed mindmaps retain every chunk cue id including omitted filler and empty filler-only sections", () => {
  const document = createDocument(video());
  const cues = [
    { id: "1", text: "甲".repeat(3500) },
    { id: "2", text: "大家好，喜欢的话记得点赞关注。谢谢大家观看，下次见。" },
    { id: "3", text: "乙".repeat(3500) },
  ];
  document.mindmap = mindmap(cues, [mapSection(0, ["1"]), mapSection(1, ["2", "3"], ["3"])], 2, "complete");
  let restored = readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id];
  assert.deepEqual(restored.mindmap, document.mindmap);
  document.mindmap = mindmap([{ id: "1", text: "大家好，喜欢的话记得点赞关注。谢谢大家观看，下次见。" }], [mapSection(0, ["1"], [])], 1, "complete");
  restored = readWorkspace(serializeWorkspace(workspaceWith(document))).documents[document.id];
  assert.deepEqual(restored.mindmap.sections[0].cueIds, ["1"]);
  assert.deepEqual(restored.mindmap.sections[0].nodes, []);
  assert.equal(restored.mindmap.status, "complete");
  document.mindmap.sections[0].cueIds = [];
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存.*导出/);
});

test("an empty map section counts as complete only when its actual source contains no substantive units", () => {
  const document = createDocument(video());
  const cues = [{ id: "1", text: "甲".repeat(3500) }, { id: "2", text: "安装命令为 npm install，必须先安装依赖。" }];
  document.mindmap = mindmap(cues, [mapSection(0, ["1"]), mapSection(1, ["2"], [])], 2, "complete");
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存/);
  const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.mindmap.status, "error");
  assert.equal(restored.mindmap.sections.length, 1);
  assert.deepEqual(restored.mindmap.sections[0], document.mindmap.sections[0]);
  assert.match(restored.mindmap.error, /第 2 段重试/);
});

test("map recovery updates chunk boundaries, preserves only a matching prefix and cannot label partial work complete", () => {
  const document = createDocument(video());
  const cues = [1, 2, 3].map(id => ({ id: String(id), text: "字".repeat(3500) }));
  document.mindmap = mindmap(cues, [mapSection(0, ["1"])], 2, "complete");
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存/);
  let restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.mindmap.status, "error");
  assert.equal(restored.mindmap.totalSections, 3);
  assert.equal(restored.mindmap.sections.length, 1);
  assert.match(restored.mindmap.error, /已保留 1 段.*第 2 段重试/);
  assert.doesNotThrow(() => serializeWorkspace(workspaceWith(restored)));
  document.mindmap.totalSections = 3;
  restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
  assert.equal(restored.mindmap.status, "error");
  assert.match(restored.mindmap.error, /尚未完成.*第 2 段/);
});

test("map recovery rejects wrong source ids, reordered ranges and bad nodes without skipping an invalid middle section", () => {
  const document = createDocument(video());
  const cues = [
    { id: "1", text: "甲".repeat(3500) },
    { id: "2", text: "乙".repeat(1000) },
    { id: "3", text: "丙".repeat(1000) },
    { id: "4", text: "丁".repeat(1000) },
    { id: "5", text: "戊".repeat(3500) },
  ];
  const good = mindmap(cues, [mapSection(0, ["1"]), mapSection(1, ["2", "3", "4"]), mapSection(2, ["5"])], 3, "complete");
  const corruptions = [
    map => { map.sections[1].cueIds = ["3", "2", "4"]; },
    map => { map.sections[1].index = 2; },
    map => { map.sections[1].nodes[0].sourceIds = ["1"]; },
    map => { map.sections[1].sourceIds = ["99"]; },
    map => { map.sections[1].nodes[0].text = " "; },
    map => { map.sections[1].nodes[0].children = {}; },
    map => { map.sections[1].nodes[0].id = "s1-n1"; },
    map => { map.sections[1].nodes.push({ ...map.sections[1].nodes[0] }); },
    map => { map.sections[1].nodes[0].children = [{ id: "s2-n2", text: "子节点", sourceIds: ["2"], children: [] }]; },
  ];
  for (const corrupt of corruptions) {
    document.mindmap = structuredClone(good);
    corrupt(document.mindmap);
    assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存/);
    const restored = readWorkspace(JSON.stringify(workspaceWith(document))).documents[document.id];
    assert.equal(restored.mindmap.sections.length, 1);
    assert.equal(restored.mindmap.status, "error");
    assert.deepEqual(restored.mindmap.sections[0], good.sections[0]);
    assert.match(restored.mindmap.error, /第 2 段重试/);
    assert.deepEqual(restored.mindmap.source.cues, cues);
  }
});

test("API map validation bounds trees, permits long verbatim leaves and validates source unions", () => {
  const good = mapSection(0, ["1"]);
  good.nodes[0].text = "代码".repeat(3500);
  assert.ok(readMindMapSection(good, ["1"]), "cross-cue verbatim code can be longer than one cue");
  const deep = structuredClone(good);
  let node = deep.nodes[0];
  for (let depth = 2; depth <= 5; depth++) {
    node.children = [{ id: `depth-${depth}`, text: "细节", sourceIds: ["1"], children: [] }];
    node = node.children[0];
  }
  assert.equal(readMindMapSection(deep, ["1"]), undefined);
  const long = structuredClone(good);
  long.nodes[0].text = "字".repeat(9001);
  assert.equal(readMindMapSection(long, ["1"]), undefined);
  const wide = structuredClone(good);
  wide.nodes = Array.from({ length: 18001 }, (_, index) => ({ id: `n-${index}`, text: "字", sourceIds: ["1"], children: [] }));
  assert.equal(readMindMapSection(wide, ["1"]), undefined);
  const verbose = structuredClone(good);
  verbose.nodes = Array.from({ length: 81 }, (_, index) => ({ id: `n-${index}`, text: "字".repeat(9000), sourceIds: ["1"], children: [] }));
  assert.equal(readMindMapSection(verbose, ["1"]), undefined);
  assert.equal(readMindMapSection({ ...good, sourceIds: [] }, ["1"]), undefined);
  assert.equal(readMindMapSection(good, ["2"]), undefined);
});

test("invalid map metadata or source cannot silently disappear during serialization", () => {
  const document = createDocument(video());
  const good = mindmap([{ id: "1", text: "真实内容" }], [mapSection(0, ["1"])], 1, "complete");
  for (const corrupt of [
    map => { map.version = 2; },
    map => { map.title = "字".repeat(1001); },
    map => { map.generatedAt = -1; },
    map => { map.error = "字".repeat(10001); },
    map => { map.source.coverage = "partial"; },
    map => { map.source.cues[0].start = -1; },
    map => { map.source.cues[0].text = "字".repeat(240001); },
    map => { map.source.totalCharacters = -1; },
    map => { map.source.limitation = {}; },
  ]) {
    document.mindmap = structuredClone(good);
    corrupt(document.mindmap);
    assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存.*导出/);
  }
  document.mindmap = null;
  assert.throws(() => serializeWorkspace(workspaceWith(document)), /思维导图.*尚未保存/);
});

test("a document containing only a mindmap is protected from empty-document pruning", () => {
  const protectedDocument = createDocument(video());
  protectedDocument.updatedAt = 0;
  protectedDocument.mindmap = mindmap([{ id: "1", text: "仅有导图的原文" }], [mapSection(0, ["1"])], 1, "complete");
  let state = workspaceWith(protectedDocument);
  for (let part = 2; part <= 40; part++) {
    const document = createDocument(video(part));
    document.updatedAt = part;
    state = upsertDocument(state, document);
  }
  state.activeId = documentId(`${url}?p=40`);
  const restored = readWorkspace(serializeWorkspace(state));
  assert.deepEqual(restored.documents[protectedDocument.id].mindmap, protectedDocument.mindmap);
  assert.equal(Object.keys(restored.documents).length, 25);
});
