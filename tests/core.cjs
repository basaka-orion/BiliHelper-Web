const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const compiled = process.env.BILI_TEST_BUILD
const { parseVideoLink, trustedAsset, downloadCommand } = require(path.join(compiled, 'video-url.js'))
const { readSSE, ThinkFilter } = require(path.join(compiled, 'sse.js'))

test('canonicalizes sharing text, BV, av, short links, parts and YouTube Shorts', () => {
  assert.equal(parseVideoLink('BV1GJ411x7h7').url, 'https://www.bilibili.com/video/BV1GJ411x7h7')
  assert.equal(parseVideoLink('av80433022').aid, '80433022')
  assert.equal(parseVideoLink('分享：【视频】 https://www.bilibili.com/video/BV1GJ411x7h7?p=2&tracking=123。').page, 2)
  assert.equal(parseVideoLink('https://b23.tv/abc123').short, true)
  assert.equal(parseVideoLink('https://youtube.com/shorts/dQw4w9WgXcQ?si=a').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  assert.equal(parseVideoLink('https://youtu.be/dQw4w9WgXcQ?t=10').videoId, 'dQw4w9WgXcQ')
})
test('rejects spoofed hosts, credentials, local addresses and unsupported paths', () => {
  for (const link of ['https://bilibili.com.evil.test/video/BV1GJ411x7h7','https://evil.test/?url=bilibili.com','https://www.bilibili.com@evil.test/video/BV1GJ411x7h7','http://127.0.0.1','file:///etc/passwd','https://youtube.com/@channel','https://www.bilibili.com/blackboard/live']) assert.throws(() => parseVideoLink(link))
})
test('restricts image and subtitle proxy targets and upgrades platform HTTP images', () => {
  assert.equal(trustedAsset('http://i1.hdslb.com/bfs/archive/a.jpg','image').protocol,'https:')
  assert.throws(() => trustedAsset('https://evil.test/a','image'))
  assert.throws(() => trustedAsset('https://hdslb.com.evil.test/a','subtitle'))
  assert.throws(() => trustedAsset('http://127.0.0.1/a','image'))
})
test('download command includes muxed fallback and shell escapes arbitrary text', () => {
  assert.match(downloadCommand('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /bv\*\+ba\/b/)
  assert.match(downloadCommand("a'$(whoami)"), /'a'\\''\$\(whoami\)'/)
})
test('SSE preserves Chinese UTF-8 across byte-sized chunks and final unterminated frames', async () => {
  const data = new TextEncoder().encode('data: {"text":"中文"}\r\n\r\ndata: [DONE]')
  const stream = new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close() } })
  const result = []; await readSSE(stream, x => result.push(x))
  assert.deepEqual(result, ['{"text":"中文"}','[DONE]'])
})
test('think filter handles every possible chunk boundary, multiple blocks and unfinished reasoning', () => {
  const input = '开头<think>secret</think>正文<think>more</think>结尾'
  for (let split=0;split<=input.length;split++) { const f=new ThinkFilter(); assert.equal(f.push(input.slice(0,split))+f.push(input.slice(split))+f.push('',true),'开头正文结尾') }
  const f=new ThinkFilter(); let out=''; for (const char of input) out+=f.push(char); assert.equal(out+f.push('',true),'开头正文结尾')
  const g=new ThinkFilter(); assert.equal(g.push('<think>private',true),'')
})

const { biliMetadata } = require(path.join(compiled, 'bili-metadata.js'))
test('selects the actual cid and duration for a multi-part video and rejects missing parts', () => {
  const video = { bvid: 'BV1wD4y1o7AS', title: 'Course', cid: 1, duration: 100, pages: [{ page: 1, cid: 1, part: 'Intro', duration: 100 }, { page: 2, cid: 2, part: 'Install', duration: 200 }] }
  const result = biliMetadata(video, 2)
  assert.equal(result.cid, 2); assert.equal(result.duration, 200); assert.equal(result.url, 'https://www.bilibili.com/video/BV1wD4y1o7AS?p=2')
  assert.throws(() => biliMetadata(video, 3))
})

test('later parts never fall back to the first part when page metadata or cid is absent', () => {
  const video = { bvid: 'BV1wD4y1o7AS', title: 'Course', cid: 111, duration: 100 }
  assert.equal(biliMetadata(video, 1).cid, 111, 'legacy metadata without pages remains usable for P1')
  for (const pages of [undefined, [], null, {}]) assert.throws(() => biliMetadata({ ...video, pages }, 2), /分 P 信息不完整/)
  for (const cid of [undefined, null, 0, -2, '222', NaN, Infinity, 2.5]) {
    assert.throws(() => biliMetadata({ ...video, pages: [{ page: 2, cid, part: 'Second', duration: 200 }] }, 2), /内容标识/)
  }
  assert.throws(() => biliMetadata({ ...video, cid: 0 }, 1), /内容标识/)
})

function loadTypeScript(relative, mocks = {}, globals = {}) {
  const ts = require('typescript')
  const { readFileSync } = require('node:fs')
  const output = ts.transpileModule(readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const localRequire = name => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
    if (name.endsWith('/video-url')) return require(path.join(compiled, 'video-url.js'))
    if (name.endsWith('/bili-metadata')) return require(path.join(compiled, 'bili-metadata.js'))
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'module', 'exports', ...Object.keys(globals), output)(localRequire, module, module.exports, ...Object.values(globals))
  return module.exports
}

function browserApi(onScript) {
  const window = Object.create(null), scripts = []
  const document = {
    createElement: () => ({ removed: false, remove() { this.removed = true } }),
    head: { appendChild(script) { scripts.push(script); onScript?.(script, window) } },
  }
  return { ...loadTypeScript('lib/browser-bili.ts', {}, { window, document, crypto: require('node:crypto').webcrypto }), window, scripts }
}

test('browser subtitle refresh uses the current cid and filters untrusted asset URLs', async () => {
  const api = browserApi((script, window) => {
    const request = new URL(script.src)
    assert.equal(request.origin, 'https://api.bilibili.com')
    assert.equal(request.pathname, '/x/player/v2')
    assert.equal(request.searchParams.get('cid'), '222')
    queueMicrotask(() => window[request.searchParams.get('callback')]({ code: 0, data: { subtitle: { subtitles: [
      { lan: 'zh', lan_doc: '中文', subtitle_url: '//i0.hdslb.com/subtitles/current.json' },
      { lan: 'en', lan_doc: 'English', subtitle_url: 'https://evil.test/subtitle.json' }, null,
    ] } } }))
  })
  const subtitles = await api.browserSubtitles('BV1wD4y1o7AS', 222, new AbortController().signal)
  assert.deepEqual(subtitles, [{ lan: 'zh', lan_doc: '中文', subtitle_url: 'https://i0.hdslb.com/subtitles/current.json' }])
  assert.equal(api.scripts[0].removed, true)
  assert.equal(Object.keys(api.window).length, 0)
})

test('browser subtitle refresh propagates platform and cancellation failures instead of reporting no subtitles', async () => {
  const denied = browserApi((script, window) => queueMicrotask(() => window[new URL(script.src).searchParams.get('callback')]({ code: -101, message: '账号未登录' })))
  await assert.rejects(denied.browserSubtitles('BV1wD4y1o7AS', 222, new AbortController().signal), /账号未登录/)
  const malformed = browserApi((script, window) => queueMicrotask(() => window[new URL(script.src).searchParams.get('callback')]({ code: 0, data: 'invalid player data' })))
  await assert.rejects(malformed.browserSubtitles('BV1wD4y1o7AS', 222, new AbortController().signal), /格式异常/)
  const pending = browserApi(), controller = new AbortController()
  const request = pending.browserSubtitles('BV1wD4y1o7AS', 222, controller.signal)
  controller.abort()
  await assert.rejects(request, /已停止/)
  assert.equal(pending.scripts[0].removed, true)
  assert.equal(Object.keys(pending.window).length, 0)
  await assert.rejects(pending.browserSubtitles('BV1wD4y1o7AS&cid=1', 222, new AbortController().signal), /信息无效/)
  await assert.rejects(pending.browserSubtitles('BV1wD4y1o7AS', 0, new AbortController().signal), /信息无效/)
  assert.equal(pending.scripts.length, 1, 'invalid identifiers must not issue JSONP requests')
})

class MetadataHttpError extends Error {
  constructor(message, status = 502) { super(message); this.status = status }
}
function metadataRoute(biliJson, biliWbiJson) {
  return loadTypeScript('app/api/video-info/route.ts', {
    '../../../lib/upstream': { biliJson, biliWbiJson, biliHeaders: {}, HttpError: MetadataHttpError,
      errorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }),
      requestJson: async () => { throw new Error('Unexpected request') } },
  })
}
const metadataVideo = { bvid: 'BV1wD4y1o7AS', title: 'Course', cid: 111, duration: 100,
  owner: { name: 'Teacher' }, pages: [{ page: 1, cid: 111, part: 'Intro', duration: 100 }, { page: 2, cid: 222, part: 'Install', duration: 200 }] }
const metadataRequest = () => new Request('https://example.test/api/video-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1wD4y1o7AS?p=2' }) })

test('metadata route tries the signed official player endpoint with the selected part after v2 fails', async () => {
  const calls = []
  const route = metadataRoute(async endpoint => {
    calls.push(endpoint)
    if (endpoint.startsWith('/x/web-interface/view')) return metadataVideo
    throw new MetadataHttpError('平台拒绝访问')
  }, async (endpoint, parameters) => {
    calls.push({ endpoint, parameters })
    return { subtitle: { subtitles: [
      { lan: 'zh', lan_doc: '中文', subtitle_url: '//i0.hdslb.com/subtitles/p2.json' },
      { lan: 'en', lan_doc: 'English', subtitle_url: 'https://evil.test/subtitles.json' },
    ] } }
  })
  const response = await route.POST(metadataRequest()), data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(calls[1], '/x/player/v2?bvid=BV1wD4y1o7AS&cid=222')
  assert.deepEqual(calls[2], { endpoint: '/x/player/wbi/v2', parameters: { bvid: 'BV1wD4y1o7AS', cid: 222 } })
  assert.equal(data.cid, 222)
  assert.equal(data.uploader, 'Teacher')
  assert.equal(data.duration, 200)
  assert.equal(data.hasSubtitles, true)
  assert.deepEqual(data.subtitles, [{ lan: 'zh', lan_doc: '中文', subtitle_url: 'https://i0.hdslb.com/subtitles/p2.json' }])
})

test('metadata stays available with an explicit notice when both subtitle queries fail', async () => {
  const route = metadataRoute(async endpoint => {
    if (endpoint.startsWith('/x/web-interface/view')) return metadataVideo
    throw new MetadataHttpError('v2 failed')
  }, async () => { throw new MetadataHttpError('signed player failed') })
  const response = await route.POST(metadataRequest()), data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.title, 'Course')
  assert.equal(data.selectedPage, 2)
  assert.equal(data.hasSubtitles, false)
  assert.deepEqual(data.subtitles, [])
  assert.match(data.subtitleNotice, /查询暂不可用.*刷新来源/)
})

test('metadata route refuses an unverifiable later part before any subtitle request', async () => {
  let calls = 0
  const route = metadataRoute(async endpoint => {
    calls++
    assert.match(endpoint, /^\/x\/web-interface\/view/)
    return { ...metadataVideo, pages: [] }
  }, async () => { throw new Error('Must not request P1 subtitles') })
  const response = await route.POST(metadataRequest())
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /分 P 信息不完整/)
  assert.equal(calls, 1)
})

const { tutorialMarkdown } = require(path.join(compiled, 'markdown.js'))
test('renders provider Markdown wrappers while retaining nested programming examples', () => {
  const document = '# 标题\n\n```python\nprint("ok")\n```'
  assert.equal(tutorialMarkdown('```markdown\n' + document + '\n```'), document)
  assert.equal(tutorialMarkdown('```python\nprint("ok")\n```'), '```python\nprint("ok")\n```')
})
