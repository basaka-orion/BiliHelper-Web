const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { transferMp4 } = require(
  path.join(process.env.BILI_TEST_BUILD, "download-transfer.js"),
);

// A minimal ISO-BMFF header fixture; actual playback is verified separately in-browser.
const mp4 = Uint8Array.from([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115,
  111, 109, 109, 112, 52, 50, 0, 0, 0, 8, 102, 114, 101, 101,
]);
const options = (extra) => ({
  expectedSize: mp4.length,
  maxBytes: 1024,
  signal: new AbortController().signal,
  ...extra,
});
const headers = {
  "content-type": "video/mp4",
  "content-length": String(mp4.length),
};

test("complete MP4 headers may cross byte-sized chunks and retain every received byte", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of mp4) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers },
  );
  const result = await transferMp4(response, options());
  assert.equal(result.bytes, mp4.length);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), mp4);
});

test("unknown-length video is bounded while reading and cancels before buffering the excess chunk", async () => {
  let canceled = false,
    closed = false,
    aborted = false,
    writes = 0;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(mp4);
        controller.enqueue(new Uint8Array(100));
      },
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "video/mp4" } },
  );
  await assert.rejects(
    transferMp4(
      response,
      options({
        expectedSize: 0,
        maxBytes: 64,
        createWritable: async () => ({
          write: async () => {
            writes++;
          },
          close: async () => {
            closed = true;
          },
          abort: async () => {
            aborted = true;
          },
        }),
      }),
    ),
    /超过允许大小/,
  );
  assert.equal(canceled, true);
  assert.equal(aborted, true);
  assert.equal(closed, false);
  assert.equal(writes, 1);
});

test("known oversize and conflicting file lengths are rejected before opening a target file", async () => {
  let opened = 0;
  const open = async () => {
    opened++;
    throw new Error("must not open");
  };
  await assert.rejects(
    transferMp4(
      new Response(mp4, { headers }),
      options({ maxBytes: 16, createWritable: open }),
    ),
    /上限/,
  );
  await assert.rejects(
    transferMp4(
      new Response(mp4, { headers }),
      options({ expectedSize: mp4.length + 1, createWritable: open }),
    ),
    /大小不一致/,
  );
  assert.equal(opened, 0);
});

test("an interrupted stream aborts the transaction and never closes or returns a saved blob", async () => {
  let canceled = false,
    closed = false,
    aborted = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(mp4.slice(0, 16));
        controller.close();
      },
      cancel() {
        canceled = true;
      },
    }),
    { headers },
  );
  await assert.rejects(
    transferMp4(
      response,
      options({
        createWritable: async () => ({
          write: async () => {},
          close: async () => {
            closed = true;
          },
          abort: async () => {
            aborted = true;
          },
        }),
      }),
    ),
    /不完整/,
  );
  assert.equal(closed, false);
  assert.equal(aborted, true);
});

test("FLV and error pages cannot be saved under a .mp4 filename", async () => {
  for (const [body, type] of [
    [new Uint8Array([70, 76, 86, 1]), "video/x-flv"],
    [
      new TextEncoder().encode("<!DOCTYPE html>access denied"),
      "application/octet-stream",
    ],
  ]) {
    await assert.rejects(
      transferMp4(
        new Response(body, { headers: { "content-type": type } }),
        options({ expectedSize: 0 }),
      ),
      /MP4/,
    );
  }
});

test("partial ranges are rejected even if their content-length matches the fragment", async () => {
  await assert.rejects(
    transferMp4(
      new Response(mp4, {
        status: 206,
        headers: { ...headers, "content-range": "bytes 32-63/64" },
      }),
      options(),
    ),
    /部分视频/,
  );
  await assert.rejects(
    transferMp4(
      new Response(mp4, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-63/64",
        },
      }),
      options({ expectedSize: 0 }),
    ),
    /不完整/,
  );
  const result = await transferMp4(
    new Response(mp4, {
      status: 206,
      headers: {
        ...headers,
        "content-range": `bytes 0-${mp4.length - 1}/${mp4.length}`,
      },
    }),
    options(),
  );
  assert.equal(result.bytes, mp4.length);
});

test("abort cancels a pending read immediately and never commits the selected file", async () => {
  const abort = new AbortController();
  let streamCanceled = false,
    targetAborted = false,
    targetClosed = false,
    firstWrite;
  const wrote = new Promise((resolve) => {
    firstWrite = resolve;
  });
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(mp4);
      },
      cancel() {
        streamCanceled = true;
      },
    }),
    { headers: { "content-type": "video/mp4" } },
  );
  const result = transferMp4(
    response,
    options({
      expectedSize: 0,
      signal: abort.signal,
      createWritable: async () => ({
        write: async () => {
          firstWrite();
        },
        close: async () => {
          targetClosed = true;
        },
        abort: async () => {
          targetAborted = true;
        },
      }),
    }),
  );
  await wrote;
  abort.abort();
  await assert.rejects(result, (error) => error.name === "AbortError");
  assert.equal(streamCanceled, true);
  assert.equal(targetAborted, true);
  assert.equal(targetClosed, false);
});

function panelHarness({ picker, directFetch, browserError } = {}) {
  const ts = require("typescript"),
    fs = require("node:fs");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "app/components/download-panel.tsx"),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const timeline = [],
    messages = [],
    controller = {},
    saved = [];
  const media = {
    url: "https://cloud.bilivideo.com/video.mp4",
    backups: [],
    size: mp4.length,
    quality: 64,
    parts: 1,
    format: "mp4",
  };
  const view = (type, props) => ({ type, props });
  const mocks = {
    react: {
      useRef: () => controller,
      useState: (value) => [
        value,
        (next) => {
          if (typeof next === "string") messages.push(next);
        },
      ],
      useEffect: () => {},
    },
    "react/jsx-runtime": { jsx: view, jsxs: view },
    "lucide-react": {},
    "../../lib/video-url": { downloadCommand: () => "" },
    "../../lib/download-transfer": { transferMp4 },
    "../../lib/browser-bili": {
      browserMedia: async (bvid, cid) => {
        timeline.push(`browser:${bvid}:${cid}`);
        if (browserError) throw browserError;
        return { ...media, url: "https://viewer.bilivideo.com/video.mp4" };
      },
    },
  };
  const window = picker
    ? {
        showSaveFilePicker: (options) => {
          timeline.push("picker");
          return picker(options);
        },
      }
    : {};
  const fetch = async (url, init) => {
    timeline.push(String(url));
    if (url === "/api/download") {
      const body = JSON.parse(init.body);
      if (!body.info) throw new Error("unexpected proxy request");
      return Response.json({ mode: "direct", ...media });
    }
    if (directFetch) return directFetch(url, init);
    if (url.includes("cloud.")) throw new Error("CDN blocked");
    return new Response(mp4, { headers });
  };
  const module = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    "window",
    "document",
    "fetch",
    "setTimeout",
    code,
  )(
    (name) => {
      assert.ok(name in mocks, `unexpected import ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
    window,
    {
      createElement: () => ({
        click() {
          saved.push(true);
        },
      }),
    },
    fetch,
    (callback, timeout) => {
      if (timeout === 120000) callback();
      return 0;
    },
  );
  const tree = module.exports.DownloadPanel({
    video: {
      bvid: "BV1wD4y1o7AS",
      cid: 222,
      url: "https://www.bilibili.com/video/BV1wD4y1o7AS?p=2",
      title: "当前第二节",
    },
  });
  const findSave = (node) => {
    if (!node || typeof node !== "object") return undefined;
    if (node.type === "button" && node.props.className === "primary")
      return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const match = findSave(child);
      if (match) return match;
    }
  };
  return {
    click: () => findSave(tree).props.onClick(),
    timeline,
    messages,
    controller,
    saved,
  };
}

test("a blocked cloud CDN is retried with a fresh browser URL for the same selected part", async () => {
  const panel = panelHarness();
  await panel.click();
  assert.deepEqual(panel.timeline, [
    "/api/download",
    "https://cloud.bilivideo.com/video.mp4",
    "browser:BV1wD4y1o7AS:222",
    "https://viewer.bilivideo.com/video.mp4",
  ]);
  assert.equal(panel.saved.length, 1);
  assert.ok(panel.messages.some((message) => message.startsWith("已保存")));
});

test("the save picker is requested by the initial click before either network request", async () => {
  let closed = false,
    writes = 0;
  const panel = panelHarness({
    picker: async () => ({
      createWritable: async () => ({
        write: async (bytes) => {
          writes += bytes.byteLength;
        },
        close: async () => {
          closed = true;
        },
        abort: async () => {},
      }),
    }),
    directFetch: async () => new Response(mp4, { headers }),
  });
  const pending = panel.click();
  assert.deepEqual(panel.timeline, ["picker"]);
  await pending;
  assert.equal(writes, mp4.length);
  assert.equal(closed, true);
  assert.equal(
    panel.saved.length,
    0,
    "a selected file must not trigger a second blob download",
  );
});

test("canceling or blocking a picker never silently falls back to an in-memory download", async () => {
  for (const name of ["AbortError", "SecurityError"]) {
    const panel = panelHarness({
      picker: async () => {
        throw new DOMException("picker unavailable", name);
      },
    });
    await panel.click();
    assert.deepEqual(panel.timeline, ["picker"]);
    assert.equal(panel.saved.length, 0);
  }
});

test("stopping a pending CDN fetch never starts a backup, browser lookup or proxy", async () => {
  let started;
  const fetching = new Promise((resolve) => {
    started = resolve;
  });
  const panel = panelHarness({
    directFetch: async (url, init) => {
      started();
      return new Promise((resolve, reject) =>
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("stop", "AbortError")),
          { once: true },
        ),
      );
    },
  });
  const pending = panel.click();
  await fetching;
  panel.controller.current.abort();
  await pending;
  assert.deepEqual(panel.timeline, [
    "/api/download",
    "https://cloud.bilivideo.com/video.mp4",
  ]);
  assert.equal(panel.saved.length, 0);
  assert.ok(panel.messages.some((message) => message.includes("已取消")));
});

function proxyRoute(fetch, size = mp4.length, backups = []) {
  const ts = require("typescript"),
    fs = require("node:fs");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "app/api/download/route.ts"),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  class HttpError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const mocks = {
    "../../../lib/video-url": require(
      path.join(process.env.BILI_TEST_BUILD, "video-url.js"),
    ),
    "../../../lib/download-transfer": { transferMp4 },
    "../../../lib/upstream": {
      HttpError,
      biliHeaders: {},
      biliWbiJson: async () => ({
        quality: 64,
        format: "mp4720",
        durl: [
          {
            url: "https://cloud.bilivideo.com/video.mp4",
            size,
            backup_url: backups,
          },
        ],
      }),
      biliJson: async () => {
        throw new Error("unexpected API fallback");
      },
      errorResponse: (error) =>
        Response.json(
          { error: error.message },
          { status: error.status || 500 },
        ),
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", code)(
    (name) => {
      assert.ok(name in mocks, `unexpected import ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
    fetch,
  );
  return () =>
    module.exports.POST(
      new Request("https://example.test/api/download", {
        method: "POST",
        body: JSON.stringify({
          url: "https://www.bilibili.com/video/BV1wD4y1o7AS?p=2",
          cid: 222,
          quality: 64,
        }),
      }),
    );
}

test("the small-file proxy validates every byte before sending a complete fallback CDN file", async () => {
  const requests = [];
  const run = proxyRoute(
    async (url) => {
      requests.push(url);
      return requests.length === 1
        ? new Response("denied", { status: 403 })
        : new Response(mp4, { headers });
    },
    mp4.length,
    ["https://backup.bilivideo.com/video.mp4"],
  );
  const response = await run();
  assert.equal(response.headers.get("x-download-mode"), "proxy");
  assert.equal(Number(response.headers.get("content-length")), mp4.length);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), mp4);
  assert.deepEqual(requests, [
    "https://cloud.bilivideo.com/video.mp4",
    "https://backup.bilivideo.com/video.mp4",
  ]);
});

test("inconsistent upstream sizes never escape the proxy as a partial or oversized MP4", async () => {
  for (const response of [
    new Response(mp4.slice(0, 16), { headers }),
    new Response(mp4, { headers: { ...headers, "content-length": "5000000" } }),
    new Response("<html>blocked</html>", {
      headers: { "content-type": "application/octet-stream" },
    }),
  ]) {
    const result = await proxyRoute(async () => response)();
    assert.equal(result.headers.get("content-type"), "application/json");
    assert.equal((await result.json()).mode, "fallback");
  }
});
