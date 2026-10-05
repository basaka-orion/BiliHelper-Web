import { NextRequest } from 'next/server'
import { downloadCommand, parseVideoLink, trustedAsset } from '../../../lib/video-url'
import { biliHeaders, biliJson, HttpError, errorResponse } from '../../../lib/upstream'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { url, bvid, cid, mediaUrl } = await req.json()
    let link
    try { link = parseVideoLink(url || bvid) } catch (e) { throw new HttpError((e as Error).message, 400) }
    const fallback = (message: string, extra = {}) => Response.json({ mode: 'fallback', message, command: downloadCommand(link.url), ...extra })
    if (mediaUrl) {
      let media
      try { media = trustedAsset(mediaUrl, 'media') } catch (e) { throw new HttpError((e as Error).message, 400) }
      if (link.platform !== 'bilibili' || !link.bvid || !media.pathname.endsWith('.mp4')) throw new HttpError('下载地址无效', 400)
      const head = await fetch(media, { method: 'HEAD', headers: biliHeaders, redirect: 'error', signal: AbortSignal.timeout(8000) })
      const size = Number(head.headers.get('content-length'))
      if (!head.ok || !size || size > 40 * 1024 * 1024 || /text|json|html/.test(head.headers.get('content-type') || '')) return fallback('网页暂时无法下载这个文件，请使用下方本机下载指令。')
      return Response.json({ mode: 'ready', size })
    }
    if (link.short) throw new HttpError('请先解析短链接再下载', 400)
    if (link.platform === 'youtube') return fallback('YouTube 视频需要在本机下载；下方提供安装步骤和可直接复制的下载指令。')
    if (!link.bvid || !Number.isSafeInteger(cid) || cid <= 0) throw new HttpError('请先解析视频并选择分 P', 400)
    // Verify the selected part belongs to this video before requesting its stream.
    let playData
    try {
      const info = await biliJson(`/x/web-interface/view?bvid=${link.bvid}`)
      if (!(info.pages || []).some((p: { cid: number }) => p.cid === cid) && info.cid !== cid) throw new HttpError('所选分 P 与视频不匹配', 400)
      playData = await biliJson(`/x/player/playurl?bvid=${link.bvid}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=0&platform=html5`)
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) throw e
      return fallback('平台暂未提供可直接下载的视频流，请使用本机下载；如提示登录，可按下方说明使用浏览器登录状态。')
    }
    const parts = playData.durl || []
    if (!parts.length) return fallback('该视频需要合并音视频或登录后下载，请使用本机下载。')
    const part = parts[0]
    const size = Number(part.size || 0)
    if (parts.length > 1 || !size || size > 4 * 1024 * 1024) return fallback(parts.length > 1 ? '视频包含多个片段，本机下载会自动合并为完整视频。' : '该视频较大，请使用本机下载，避免网页下载中断。', { size, quality: playData.quality })
    let videoUrl
    try { videoUrl = trustedAsset(part.url, 'media') } catch { return fallback('平台没有提供受支持的视频地址，请使用本机下载。') }
    if (!videoUrl.pathname.endsWith('.mp4')) return fallback('该视频需要转换格式，请使用本机下载生成 MP4。')
    const response = await fetch(videoUrl, { headers: biliHeaders, redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (!response.ok || !response.body) return fallback('网页下载暂不可用，请使用本机下载。')
    const type = response.headers.get('content-type') || ''
    if (/text|json|html/.test(type)) { await response.body.cancel(); return fallback('平台视频验证未通过，请使用本机下载。') }
    return new Response(response.body, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${link.bvid}.mp4"`, 'Cache-Control': 'no-store' } })
  } catch (e) { return errorResponse(e) }
}

// Stream a bounded, public platform MP4 to the browser's native download manager.
// The official browser API resolves the URL, avoiding cloud-IP blocks on metadata APIs.
export async function GET(req: NextRequest) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let url
    try { url = trustedAsset(req.nextUrl.searchParams.get('media') || '', 'media') } catch (e) { throw new HttpError((e as Error).message, 400) }
    if (!url.pathname.endsWith('.mp4')) throw new HttpError('请使用本机下载转换此视频格式', 400)
    const name = req.nextUrl.searchParams.get('name') || 'video'
    const filename = name.replace(/[^\w.-]/g, '_').slice(0, 100)
    const abort = new AbortController()
    timer = setTimeout(() => abort.abort(), 55000)
    req.signal.addEventListener('abort', () => abort.abort(), { once: true })
    const response = await fetch(url, { headers: biliHeaders, redirect: 'error', signal: abort.signal })
    const size = Number(response.headers.get('content-length'))
    if (!response.ok || !response.body || !size || size > 40 * 1024 * 1024 || /text|json|html/.test(response.headers.get('content-type') || '')) {
      clearTimeout(timer); await response.body?.cancel(); throw new HttpError('网页无法下载此文件，请使用页面中的本机下载指令', 400)
    }
    const reader = response.body.getReader()
    let count = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read()
          if (done) { clearTimeout(timer); reader.releaseLock(); controller.close(); return }
          count += value.byteLength
          if (count > 40 * 1024 * 1024) throw new Error('视频超过网页下载限制')
          controller.enqueue(value)
        } catch (e) { clearTimeout(timer); await reader.cancel().catch(() => {}); controller.error(e) }
      },
      async cancel() { clearTimeout(timer); abort.abort(); await reader.cancel().catch(() => {}) },
    })
    return new Response(stream, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${filename}.mp4"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (e) { clearTimeout(timer); return errorResponse(e) }
}
