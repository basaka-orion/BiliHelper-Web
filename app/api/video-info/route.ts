import { NextRequest } from 'next/server'
import { parseVideoLink, trustedAsset } from '../../../lib/video-url'
import { biliJson, biliHeaders, requestJson, HttpError, errorResponse } from '../../../lib/upstream'

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
  try {
    const body = await req.json()
    let link
    try { link = parseVideoLink(body.url) } catch (e) { throw new HttpError((e as Error).message, 400) }
    if (link.short) link = await resolveShort(link.url)
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
    const pages = (v.pages || []).map((p: { cid: number; page: number; part: string; duration: number }) => ({ cid: p.cid, page: p.page, title: p.part, duration: p.duration }))
    const selected = pages.find((p: { page: number }) => p.page === link.page)
    if (pages.length && !selected) throw new HttpError('该视频没有这个分 P，请检查链接中的 p 参数', 400)
    const cid = selected?.cid || v.cid
    let subtitles = []
    let subtitleNotice = ''
    try {
      const player = await biliJson(`/x/player/v2?bvid=${v.bvid}&cid=${cid}`)
      subtitles = (player.subtitle?.subtitles || []).flatMap((s: { lan: string; lan_doc: string; subtitle_url: string }) => {
        try { return [{ lan: s.lan, lan_doc: s.lan_doc, subtitle_url: trustedAsset(s.subtitle_url, 'subtitle').href }] } catch { return [] }
      })
    } catch { subtitleNotice = '平台字幕暂不可用，可粘贴字幕文本或让 AI 服务尝试提取。' }
    return Response.json({ platform: 'bilibili', title: v.title, uploader: v.owner?.name || '未知 UP 主', avatar: v.owner?.face, duration: selected?.duration || v.duration, views: v.stat?.view, likes: v.stat?.like, coins: v.stat?.coin, favorites: v.stat?.favorite, danmakus: v.stat?.danmaku, description: v.desc, thumbnail: v.pic, bvid: v.bvid, cid, aid: v.aid, url: `https://www.bilibili.com/video/${v.bvid}${link.page > 1 ? `?p=${link.page}` : ''}`, subtitles, hasSubtitles: subtitles.length > 0, subtitleNotice, pages, selectedPage: link.page })
  } catch (e) { return errorResponse(e) }
}
