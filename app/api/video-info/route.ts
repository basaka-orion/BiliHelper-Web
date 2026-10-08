import { NextRequest } from 'next/server'
import { biliMetadata } from '../../../lib/bili-metadata'
import type { VideoLink } from '../../../lib/video-url'
import { parseVideoLink, trustedAsset } from '../../../lib/video-url'
import { biliJson, biliWbiJson, biliHeaders, requestJson, HttpError, errorResponse } from '../../../lib/upstream'

export const maxDuration = 60

async function resolveShort(url: string) {
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url, { redirect: 'manual', headers: biliHeaders, signal: AbortSignal.timeout(8000) })
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) return parseVideoLink(url)
    const next = parseVideoLink(new URL(location, url).href)
    if (next.platform !== 'bilibili') throw new HttpError('短链接没有指向 B 站视频', 400)
    if (!next.short) return next
    url = next.url
  }
  throw new HttpError('短链接跳转过多，请粘贴完整视频链接', 400)
}

async function pageMetadata(url: string) {
  const response = await fetch(url, { headers: biliHeaders, signal: AbortSignal.timeout(8000), redirect: 'error' })
  if (!response.ok) throw new HttpError('B 站视频页面暂时不可用')
  const html = await response.text()
  const raw = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]+?);\s*\(function/)?.[1]
  if (!raw) throw new HttpError('B 站暂时限制了访问，请稍后重试')
  const data = JSON.parse(raw).videoData
  if (!data?.title || !data?.bvid) throw new HttpError('视频信息不完整，请稍后重试')
  return data
}

export async function POST(req: NextRequest) {
  let resolvedLink: VideoLink | undefined
  try {
    const body = await req.json()
    let link
    try { link = parseVideoLink(body.url) } catch (e) { throw new HttpError((e as Error).message, 400) }
    if (link.short) link = await resolveShort(link.url)
    resolvedLink = link
    if (link.platform === 'youtube') {
      let data
      try { data = await requestJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(link.url)}&format=json`, {}, 'YouTube', 5000) }
      catch { data = await requestJson(`https://noembed.com/embed?url=${encodeURIComponent(link.url)}`, {}, 'YouTube 备用解析', 8000) }
      if (data.error || !data.title) throw new HttpError('YouTube 视频不存在或暂时无法解析，请稍后重试', 404)
      return Response.json({ platform: 'youtube', title: data.title, uploader: data.author_name, thumbnail: data.thumbnail_url, url: link.url, subtitles: [], hasSubtitles: false, pages: [] })
    }
    let v
    try { v = await biliJson(`/x/web-interface/view?${link.bvid ? `bvid=${link.bvid}` : `aid=${link.aid}`}`) }
    catch (error) {
      if (error instanceof HttpError && error.status === 404) throw error
      v = await pageMetadata(link.url)
    }
    let info
    try { info = biliMetadata(v, link.page) } catch (e) { throw new HttpError((e as Error).message, 400) }
    const cid = info.cid
    let subtitles = []
    let subtitleNotice = ''
    try {
      let player
      try { player = await biliJson(`/x/player/v2?bvid=${info.bvid}&cid=${cid}`) }
      catch { player = await biliWbiJson('/x/player/wbi/v2', { bvid: info.bvid, cid }) }
      const available = player?.subtitle?.subtitles || []
      if (!Array.isArray(available)) throw new Error('平台字幕信息格式异常')
      subtitles = available.flatMap((s: { lan: string; lan_doc: string; subtitle_url: string }) => {
        if (!s || typeof s.lan !== 'string' || typeof s.lan_doc !== 'string' || typeof s.subtitle_url !== 'string') return []
        try { return [{ lan: s.lan, lan_doc: s.lan_doc, subtitle_url: trustedAsset(s.subtitle_url, 'subtitle').href }] } catch { return [] }
      })
      if (!subtitles.length) subtitleNotice = '当前访问条件下未取得平台字幕，可粘贴这一分 P 的实际字幕文本。'
    } catch { subtitleNotice = '平台字幕查询暂不可用，可刷新来源重试，或粘贴这一分 P 的实际字幕文本。' }
    return Response.json({ ...info, subtitles, hasSubtitles: subtitles.length > 0, subtitleNotice })
  } catch (e) {
    if (resolvedLink?.platform === 'bilibili' && (!(e instanceof HttpError) || e.status >= 500)) return Response.json({ error: '云端暂时无法访问 B 站，正在尝试浏览器解析', browserFallback: true, resolvedUrl: resolvedLink.url }, { status: 502 })
    return errorResponse(e)
  }
}
