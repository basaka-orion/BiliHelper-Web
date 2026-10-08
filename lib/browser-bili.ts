import { parseVideoLink, trustedAsset } from './video-url'
import { biliMetadata, BiliVideo } from './bili-metadata'

// Bilibili's public JSONP API can be reached from the viewer's network when cloud IPs are blocked.
// URLs are fixed to the official API; only validated video identifiers and callback names are inserted.
function jsonp<T>(path: string, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('请求已停止')); return }
    const callback = `bili_${crypto.randomUUID().replace(/-/g, '')}`
    const scope = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    const cleanup = () => { clearTimeout(timer); script.remove(); delete scope[callback]; signal.removeEventListener('abort', stopped) }
    const stopped = () => { cleanup(); reject(new Error('请求已停止')) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('B 站浏览器解析超时，请稍后重试')) }, 10000)
    scope[callback] = (result: { code: number; message?: string; data?: T } | null) => {
      cleanup()
      if (!result || result.code !== 0 || !result.data) { reject(new Error(result?.code === -404 ? '视频不存在或不可公开访问' : `B 站：${result?.message || '暂时不可用'}`)); return }
      resolve(result.data)
    }
    script.onerror = () => { cleanup(); reject(new Error('浏览器暂时无法访问 B 站，请检查网络后重试')) }
    script.src = `https://api.bilibili.com${path}&jsonp=jsonp&callback=${callback}`
    signal.addEventListener('abort', stopped, { once: true })
    document.head.appendChild(script)
  })
}

export async function browserSubtitles(bvid: string, cid: number, signal: AbortSignal): Promise<{ lan: string; lan_doc: string; subtitle_url: string }[]> {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !Number.isSafeInteger(cid) || cid < 1) throw new Error('视频或当前分 P 信息无效，请刷新来源后重试')
  const player = await jsonp<{ subtitle?: { subtitles?: { lan: string; lan_doc: string; subtitle_url: string }[] } }>(`/x/player/v2?bvid=${bvid}&cid=${cid}`, signal)
  if (typeof player !== 'object' || Array.isArray(player) || (player.subtitle && typeof player.subtitle !== 'object')) throw new Error('平台字幕信息格式异常，请刷新来源后重试')
  const subtitles = player.subtitle?.subtitles
  if (subtitles === undefined || subtitles === null) return []
  if (!Array.isArray(subtitles)) throw new Error('平台字幕信息格式异常，请刷新来源后重试')
  return subtitles.flatMap(subtitle => {
    if (!subtitle || typeof subtitle.lan !== 'string' || typeof subtitle.lan_doc !== 'string' || typeof subtitle.subtitle_url !== 'string') return []
    try { return [{ lan: subtitle.lan, lan_doc: subtitle.lan_doc, subtitle_url: trustedAsset(subtitle.subtitle_url, 'subtitle').href }] } catch { return [] }
  })
}

export async function browserVideoInfo(input: string, signal: AbortSignal) {
  const link = parseVideoLink(input)
  if (link.platform !== 'bilibili' || link.short) throw new Error('请使用完整 B 站视频链接或 BV 号')
  const data = await jsonp<BiliVideo>(`/x/web-interface/view?${link.bvid ? `bvid=${link.bvid}` : `aid=${link.aid}`}`, signal)
  const info = biliMetadata(data, link.page)
  try {
    info.subtitles = await browserSubtitles(info.bvid, info.cid, signal)
    info.hasSubtitles = info.subtitles.length > 0
    if (!info.hasSubtitles) info.subtitleNotice = '当前访问条件下未取得平台字幕，可粘贴这一分 P 的实际字幕文本。'
  } catch { if (signal.aborted) throw new Error('请求已停止'); info.subtitleNotice = '浏览器暂时无法查询平台字幕，可刷新来源重试，或粘贴这一分 P 的实际字幕文本。' }
  return info
}
