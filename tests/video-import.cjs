const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { loadVideoInfo } = require(
  join(process.env.BILI_TEST_BUILD, "video-import.js"),
);

const short = "https://b23.tv/t9j1lcK";
const full = "https://www.bilibili.com/video/BV1SQnB6CEpx";
const share = `【Claude 工程负责人：“别再用 2024 年的方式使用 Claude 了”-哔哩哔哩】 ${short}`;
const progress = "云端暂时无法访问 B 站，正在尝试浏览器解析";
const video = {
  platform: "bilibili",
  title: "Claude 工程负责人",
  url: full,
  bvid: "BV1SQnB6CEpx",
  cid: 42,
  subtitles: [],
  hasSubtitles: false,
};
const cloudFailure = (resolvedUrl = full) =>
  Response.json(
    { error: progress, browserFallback: true, resolvedUrl },
    { status: 502 },
  );

test("a successful cloud import does not query the browser", async () => {
  let browserCalls = 0;
  const result = await loadVideoInfo(
    full,
    new AbortController().signal,
    async () => Response.json(video),
    async () => {
      browserCalls++;
      return video;
    },
  );
  assert.deepEqual(result, video);
  assert.equal(browserCalls, 0);
});

test("the reported Claude share text uses the cloud-resolved URL for browser recovery", async () => {
  const controller = new AbortController();
  let queried;
  let announced = 0;
  const result = await loadVideoInfo(
    share,
    controller.signal,
    async (input, signal) => {
      assert.equal(input, share);
      assert.equal(signal, controller.signal);
      return cloudFailure();
    },
    async (url, signal) => {
      queried = url;
      assert.equal(signal, controller.signal);
      return video;
    },
    () => announced++,
  );
  assert.equal(queried, full);
  assert.deepEqual(result, video);
  assert.equal(announced, 1);
});

test("short-link browser recovery preserves the resolved later-part selection", async () => {
  const later = `${full}?p=2`;
  const result = await loadVideoInfo(
    short,
    new AbortController().signal,
    async () => cloudFailure(`${later}&spm_id_from=share`),
    async (url) => {
      assert.equal(url, later);
      return { ...video, url: later, cid: 99, selectedPage: 2 };
    },
  );
  assert.equal(result.url, later);
  assert.equal(result.cid, 99);
});

test("a complete Bilibili link recovers from a cloud network failure", async () => {
  let queried;
  const result = await loadVideoInfo(
    `【分享视频】${full}?p=2`,
    new AbortController().signal,
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async (url) => {
      queried = url;
      return video;
    },
  );
  assert.equal(queried, `${full}?p=2`);
  assert.deepEqual(result, video);
});

for (const status of [400, 404]) {
  test(`a ${status} response is terminal instead of starting misleading browser recovery`, async () => {
    let browserCalls = 0;
    let announced = 0;
    await assert.rejects(
      loadVideoInfo(
        full,
        new AbortController().signal,
        async () =>
          Response.json(
            { error: "视频不存在或链接无效", browserFallback: true, resolvedUrl: full },
            { status },
          ),
        async () => {
          browserCalls++;
          return video;
        },
        () => announced++,
      ),
      /视频不存在或链接无效/,
    );
    assert.equal(browserCalls, 0);
    assert.equal(announced, 0);
  });
}

for (const resolvedUrl of [
  undefined,
  short,
  "https://example.com/video/BV1SQnB6CEpx",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.bilibili.com.evil.example/video/BV1SQnB6CEpx",
  "javascript:alert(1)",
]) {
  test(`an unresolved or untrusted short-link target cannot start browser recovery: ${resolvedUrl}`, async () => {
    let browserCalls = 0;
    let announced = 0;
    await assert.rejects(
      loadVideoInfo(
        short,
        new AbortController().signal,
        async () =>
          Response.json(
            { error: progress, browserFallback: true, resolvedUrl },
            { status: 502 },
          ),
        async () => {
          browserCalls++;
          return video;
        },
        () => announced++,
      ),
      (error) => {
        assert.doesNotMatch(error.message, /正在尝试/);
        return true;
      },
    );
    assert.equal(browserCalls, 0);
    assert.equal(announced, 0);
  });
}

test("aborting cloud import never launches a browser fallback", async () => {
  const controller = new AbortController();
  let browserCalls = 0;
  await assert.rejects(
    loadVideoInfo(
      share,
      controller.signal,
      async () => {
        controller.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      },
      async () => {
        browserCalls++;
        return video;
      },
    ),
  );
  assert.equal(browserCalls, 0);
});

test("when both paths fail the final error describes failure, not an in-progress retry", async () => {
  await assert.rejects(
    loadVideoInfo(
      share,
      new AbortController().signal,
      async () => cloudFailure(),
      async () => {
        throw Error("浏览器暂时无法访问 B 站，请检查网络后重试");
      },
    ),
    (error) => {
      assert.doesNotMatch(error.message, /正在尝试/);
      assert.match(error.message, /浏览器|网络|失败|无法/);
      return true;
    },
  );
});

test("a stopped browser lookup cannot commit a late successful result", async () => {
  const controller = new AbortController();
  await assert.rejects(
    loadVideoInfo(
      share,
      controller.signal,
      async () => cloudFailure(),
      async () => {
        controller.abort();
        return video;
      },
    ),
  );
});
