export type VideoLink = { platform: 'bilibili' | 'youtube'; url: string; bvid?: string; aid?: string; videoId?: string; page: number; short?: boolean }

export function parseVideoLink(input: unknown): VideoLink {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('请输入 B 站或 YouTube 视频链接')
  const text = input.trim()
  if (/^BV[0-9A-Za-z]{10}$/.test(text)) return { platform: 'bilibili', bvid: text, url: `https://www.bilibili.com/video/${text}`, page: 1 }
  if (/^av\d+$/i.test(text)) return { platform: 'bilibili', aid: text.slice(2), url: `https://www.bilibili.com/video/av${text.slice(2)}`, page: 1 }
  const candidate = text.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[，。；）)]+$/, '') || (/^(www\.|m\.|b23\.tv|youtu\.be)/i.test(text) ? `https://${text}` : text)
  let parsed: URL
  try { parsed = new URL(candidate) } catch { throw new Error('链接格式不正确，请粘贴完整视频链接或 BV 号') }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new Error('请输入有效的 HTTPS 视频链接')
  const host = parsed.hostname.toLowerCase()
  if (host === 'b23.tv') {
    if (!/^\/[A-Za-z0-9]+\/?$/.test(parsed.pathname)) throw new Error('B 站短链接格式不正确')
    return { platform: 'bilibili', url: `https://b23.tv${parsed.pathname}`, page: 1, short: true }
  }
  if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(host)) {
    const id = parsed.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/i)?.[1]
    if (!id) throw new Error('请使用 B 站视频链接（/video/BV…），暂不支持直播或番剧链接')
    const page = Math.max(1, Math.min(10000, Number.parseInt(parsed.searchParams.get('p') || '1', 10) || 1))
    const bvid = /^BV/.test(id) ? id : undefined
    if (!bvid && !/^av\d+$/i.test(id)) throw new Error('BV 号格式不正确')
    return { platform: 'bilibili', bvid, aid: bvid ? undefined : id.slice(2), page, url: `https://www.bilibili.com/video/${id}${page > 1 ? `?p=${page}` : ''}` }
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? parsed.pathname.slice(1) : parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1]
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('请使用 YouTube 视频链接，暂不支持频道或播放列表')
    return { platform: 'youtube', videoId: id, url: `https://www.youtube.com/watch?v=${id}`, page: 1 }
  }
  throw new Error('仅支持 bilibili.com、b23.tv、youtube.com 和 youtu.be 的视频链接')
}

export function shellQuote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'` }
export function downloadCommand(url: string, mode: 'video' | 'audio' | 'subtitle' = 'video') {
  const options = mode === 'audio' ? '-x --audio-format mp3' : mode === 'subtitle' ? '--write-subs --write-auto-subs --sub-langs "zh.*,en.*" --skip-download' : '-f "bv*+ba/b" --merge-output-format mp4'
  return `yt-dlp --no-playlist ${options} ${shellQuote(url)}`
}

export function trustedAsset(input: string, kind: 'image' | 'subtitle' | 'media'): URL {
  let url: URL
  try { url = new URL(input.startsWith('//') ? `https:${input}` : input) } catch { throw new Error('资源地址无效') }
  if (url.protocol === 'http:') url.protocol = 'https:'
  const host = url.hostname.toLowerCase()
  const allowed = kind === 'image' ? ['hdslb.com', 'biliimg.com', 'ytimg.com', 'ggpht.com'] : kind === 'subtitle' ? ['hdslb.com', 'bilibili.com'] : ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net', 'akamaized.net']
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error('资源地址不在支持范围内')
  return url
}
