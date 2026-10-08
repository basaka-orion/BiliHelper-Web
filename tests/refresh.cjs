const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { refreshVideoSource } = require(
  join(process.env.BILI_TEST_BUILD, "refresh-video-source.js"),
);
const en = {
  lan: "en",
  lan_doc: "English",
  subtitle_url: "https://aisubtitle.hdslb.com/en.json",
};
const zh = {
  lan: "zh",
  lan_doc: "中文",
  subtitle_url: "https://aisubtitle.hdslb.com/zh.json",
};
const video = {
  platform: "bilibili",
  title: "来源测试",
  url: "https://www.bilibili.com/video/BV1wD4y1o7AS",
  bvid: "BV1wD4y1o7AS",
  cid: 42,
  subtitles: [],
  hasSubtitles: false,
};

test("an empty browser subtitle response still uses the independent cloud source", async () => {
  let queried = false;
  const result = await refreshVideoSource(
    video,
    "auto",
    new AbortController().signal,
    async () => [],
    async () => {
      queried = true;
      return { ...video, subtitles: [zh] };
    },
  );
  assert.equal(queried, true);
  assert.deepEqual(result.video.subtitles, [zh]);
  assert.equal(result.video.hasSubtitles, true);
});
test("a failed browser subtitle lookup does not discard usable cloud captions", async () => {
  const result = await refreshVideoSource(
    video,
    "auto",
    new AbortController().signal,
    async () => {
      throw Error("platform denied");
    },
    async () => ({ ...video, subtitles: [zh] }),
  );
  assert.equal(result.video.subtitles[0].lan, "zh");
});
test("a refreshed subtitle choice follows the language instead of an obsolete numeric index", async () => {
  const result = await refreshVideoSource(
    { ...video, subtitles: [en, zh] },
    "0",
    new AbortController().signal,
    async () => [zh, en],
    async () => ({ ...video, subtitles: [zh, en] }),
  );
  assert.equal(result.selected, "1");
  assert.equal(result.video.subtitles[Number(result.selected)].lan, "en");
});
test("a removed subtitle language returns to automatic source selection", async () => {
  const result = await refreshVideoSource(
    { ...video, subtitles: [en] },
    "0",
    new AbortController().signal,
    async () => [zh],
    async () => ({ ...video, subtitles: [zh] }),
  );
  assert.equal(result.selected, "auto");
});
test("metadata refresh preserves the previous document language when the new metadata order changes", async () => {
  const result = await refreshVideoSource(
    { ...video, subtitles: [zh, en] },
    "0",
    new AbortController().signal,
    async () => [zh, en],
    async () => ({ ...video, subtitles: [zh, en] }),
    "en",
  );
  assert.equal(result.selected, "1");
  assert.equal(result.video.subtitles[Number(result.selected)].lan, "en");
});
test("cloud subtitles for a different part or cid are not accepted", async () => {
  const result = await refreshVideoSource(
    video,
    "auto",
    new AbortController().signal,
    async () => [],
    async () => ({
      ...video,
      url: video.url + "?p=2",
      cid: 99,
      subtitles: [zh],
    }),
  );
  assert.deepEqual(result.video.subtitles, []);
});
test("stopping source refresh prevents a late result from starting generation", async () => {
  const controller = new AbortController();
  const cloud = async () => {
    controller.abort();
    return { ...video, subtitles: [zh] };
  };
  await assert.rejects(
    refreshVideoSource(video, "auto", controller.signal, async () => [], cloud),
    /已停止/,
  );
});
test("a legacy later-part document with the first-part cid uses only verified fresh part metadata", async () => {
  let unsafeBrowserCalls = 0;
  const old = {
    ...video,
    url: video.url + "?p=2",
    selectedPage: 2,
    subtitles: [en],
    pages: [],
  };
  const fresh = {
    ...old,
    cid: 99,
    pages: [{ page: 2, cid: 99, title: "第二节", duration: 60 }],
    subtitles: [zh],
  };
  const result = await refreshVideoSource(
    old,
    "0",
    new AbortController().signal,
    async () => {
      unsafeBrowserCalls++;
      return [en];
    },
    async () => fresh,
  );
  assert.equal(unsafeBrowserCalls, 0);
  assert.equal(result.video.cid, 99);
  assert.deepEqual(result.video.subtitles, [zh]);
});
test("an unverifiable legacy later-part cid cannot retain its old first-part captions after refresh failure", async () => {
  const old = {
    ...video,
    url: video.url + "?p=2",
    selectedPage: 2,
    subtitles: [en],
    pages: [],
  };
  const result = await refreshVideoSource(
    old,
    "0",
    new AbortController().signal,
    async () => [en],
    async () => {
      throw Error("cloud denied");
    },
  );
  assert.deepEqual(result.video.subtitles, []);
});
