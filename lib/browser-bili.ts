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
    scope[callback] = (result: { code: number; message?: string; data?: T }) => {
      cleanup()
      if (result.code !== 0 || !result.data) { reject(new Error(result.code === -404 ? '视频不存在或不可公开访问' : `B 站：${result.message || '暂时不可用'}`)); return }
      resolve(result.data)
    }
    script.onerror = () => { cleanup(); reject(new Error('浏览器暂时无法访问 B 站，请检查网络后重试')) }
    script.src = `https://api.bilibili.com${path}&jsonp=jsonp&callback=${callback}`
    script.referrerPolicy = 'no-referrer'
    signal.addEventListener('abort', stopped, { once: true })
    document.head.appendChild(script)
  })
}
export async function browserVideoInfo(input: string, signal: AbortSignal) {
  const link = parseVideoLink(input)
  if (link.platform !== 'bilibili' || link.short) throw new Error('请使用完整 B 站视频链接或 BV 号')
  const data = await jsonp<BiliVideo>(`/x/web-interface/view?${link.bvid ? `bvid=${link.bvid}` : `aid=${link.aid}`}`, signal)
  const info = biliMetadata(data, link.page)
  try {
    const player = await jsonp<{ subtitle?: { subtitles?: { lan: string; lan_doc: string; subtitle_url: string }[] } }>(`/x/player/v2?bvid=${info.bvid}&cid=${info.cid}`, signal)
    info.subtitles = (player.subtitle?.subtitles || []).flatMap(s => { try { return [{ ...s, subtitle_url: trustedAsset(s.subtitle_url, 'subtitle').href }] } catch { return [] } })
    info.hasSubtitles = info.subtitles.length > 0
  } catch { if (signal.aborted) throw new Error('请求已停止'); info.subtitleNotice = '平台字幕暂不可用，可粘贴实际字幕文本。' }
  return info
}
