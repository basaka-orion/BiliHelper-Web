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
