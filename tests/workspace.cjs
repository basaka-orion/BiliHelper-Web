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
