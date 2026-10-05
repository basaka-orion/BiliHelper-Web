import { NextRequest } from 'next/server'
import { downloadCommand, parseVideoLink, trustedAsset } from '../../../lib/video-url'
import { biliHeaders, biliJson, biliWbiJson, HttpError, errorResponse } from '../../../lib/upstream'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { url, bvid, cid, quality } = await req.json()
    let link
    try { link = parseVideoLink(url || bvid) } catch (e) { throw new HttpError((e as Error).message, 400) }
    const qn = [16, 32, 64].includes(Number(quality)) ? Number(quality) : 32
    const fallback = (message: string, extra = {}) => Response.json({ mode: 'fallback', message, command: downloadCommand(link.url), ...extra })
    if (link.short) throw new HttpError('请先解析短链接再下载', 400)
    if (link.platform === 'youtube') return fallback('YouTube 视频需要在本机下载；下方提供安装步骤和可直接复制的下载指令。')
    if (!link.bvid || !Number.isSafeInteger(cid) || cid <= 0) throw new HttpError('请先解析视频并选择分 P', 400)
    // Both identifiers were parsed from the official platform; the playback API validates availability.
    let playData
    try {
      try { playData = await biliWbiJson('/x/player/wbi/playurl', { bvid: link.bvid, cid, qn, fnval: 1, fnver: 0, fourk: 0, platform: 'html5' }) }
      catch { playData = await biliJson(`/x/player/playurl?bvid=${link.bvid}&cid=${cid}&qn=${qn}&fnval=1&fnver=0&fourk=0&platform=html5`) }
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) throw e
      return fallback('平台暂未提供可直接下载的视频流，请使用本机下载；如提示登录，可按下方说明使用浏览器登录状态。')
    }
    const parts = playData.durl || []
    if (!parts.length) return fallback('该视频需要合并音视频或登录后下载，请使用本机下载。')
    const part = parts[0]
    const size = Number(part.size || 0)
    if (parts.length > 1 || !size || size > 40 * 1024 * 1024) return fallback(parts.length > 1 ? '视频包含多个片段，本机下载会自动合并为完整视频。' : '该视频较大，请使用本机下载，避免网页下载中断。', { size, quality: playData.quality })
    let videoUrl
    try { videoUrl = trustedAsset(part.url, 'media') } catch { return fallback('平台没有提供受支持的视频地址，请使用本机下载。') }
    if (!videoUrl.pathname.endsWith('.mp4')) return fallback('该视频需要转换格式，请使用本机下载生成 MP4。')
    const response = await fetch(videoUrl, { headers: { ...biliHeaders, Range: 'bytes=0-' }, redirect: 'error', signal: AbortSignal.timeout(50000) })
    if (!response.ok || !response.body) return fallback('网页下载暂不可用，请使用本机下载。')
    const type = response.headers.get('content-type') || ''
    if (/text|json|html/.test(type)) { await response.body.cancel(); return fallback('平台视频验证未通过，请使用本机下载。') }
    return new Response(response.body, { headers: { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${link.bvid}.mp4"`, 'Cache-Control': 'no-store', 'X-Video-Quality': String(playData.quality || qn), 'X-Video-Size': String(size), 'Content-Length': String(size) } })
  } catch (e) { return errorResponse(e) }
}
