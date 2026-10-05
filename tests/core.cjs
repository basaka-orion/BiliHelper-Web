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

const { tutorialMarkdown } = require(path.join(compiled, 'markdown.js'))
test('renders provider Markdown wrappers while retaining nested programming examples', () => {
  const document = '# 标题\n\n```python\nprint("ok")\n```'
  assert.equal(tutorialMarkdown('```markdown\n' + document + '\n```'), document)
  assert.equal(tutorialMarkdown('```python\nprint("ok")\n```'), '```python\nprint("ok")\n```')
})
