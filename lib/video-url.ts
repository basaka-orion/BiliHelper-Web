export type VideoLink = { platform: 'bilibili' | 'youtube'; url: string; bvid?: string; aid?: string; videoId?: string; page: number; short?: boolean }

const BILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])
const TRAILING_PUNCTUATION = /[，。、；：！？）)\]】」』》〉,.;:!?]+$/

function clampPage(value: string | null | undefined): number {
  return Math.max(1, Math.min(10000, Number.parseInt(value || '1', 10) || 1))
}

function pageFromQuery(parsed: URL, keys: string[]): number {
  for (const key of keys) {
    const value = parsed.searchParams.get(key)
    if (value !== null && value !== '') return clampPage(value)
  }
  return 1
}

/** Build a canonical ordinary-video link from a BV or av identifier. */
function canonicalBili(id: string, page: number): VideoLink | undefined {
  const bv = id.match(/^bv([0-9A-Za-z]{10})$/i)
  if (bv) {
    const bvid = `BV${bv[1]}`
    return {
      platform: 'bilibili',
      bvid,
      page,
      url: `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`,
    }
  }
  const av = id.match(/^av(\d+)$/i)
  if (av) {
    return {
      platform: 'bilibili',
      aid: av[1],
      page,
      url: `https://www.bilibili.com/video/av${av[1]}${page > 1 ? `?p=${page}` : ''}`,
    }
  }
  return undefined
}

function unsupportedBili(parsed: URL): never {
  const path = parsed.pathname.toLowerCase()
  if (path.startsWith('/bangumi/'))
    throw new Error('这是番剧/影视链接，当前只支持普通视频页 /video/BV…；请打开具体视频页面后复制地址栏链接。')
  if (path.startsWith('/cheese/'))
    throw new Error('这是课堂/课程链接，当前只支持普通视频页 /video/BV…；请打开具体视频页面后复制地址栏链接。')
  if (path.startsWith('/list/') || path.startsWith('/medialist/'))
    throw new Error('这是合集/收藏夹链接，当前只支持普通视频页 /video/BV…；请打开其中具体视频后复制地址栏链接。')
  if (path.startsWith('/read/') || path.startsWith('/opus/'))
    throw new Error('这是专栏/动态链接，不是视频页；请打开具体视频后复制 /video/BV… 链接。')
  if (path.startsWith('/blackboard/') || path.startsWith('/festival/') || path.startsWith('/v/'))
    throw new Error('这是活动页或排行榜页面，不是普通视频页；请打开具体视频后复制 /video/BV… 链接。')
  if (path.startsWith('/video/'))
    throw new Error('视频地址不完整：需要 /video/BV… 或 /video/av…；请从视频页地址栏复制完整链接。')
  throw new Error('这个 B 站页面不是普通视频页；请打开具体视频后复制地址栏中的 /video/BV… 链接。暂不支持直播、番剧、课程和合集页面。')
}

function fromPlayerHost(parsed: URL): VideoLink {
  if (parsed.pathname !== '/player.html' && parsed.pathname !== '/player.html/')
    throw new Error('这是 B 站播放器页面，但没有有效的视频标识；请打开原视频页后复制 /video/BV… 链接。')
  const bvidRaw = parsed.searchParams.get('bvid')
  if (bvidRaw) {
    const link = canonicalBili(bvidRaw, pageFromQuery(parsed, ['page', 'p']))
    if (link) return link
  }
  const aidRaw = parsed.searchParams.get('aid') || parsed.searchParams.get('av')
  if (aidRaw) {
    const id = /^av/i.test(aidRaw) ? aidRaw : `av${aidRaw}`
    const link = canonicalBili(id, pageFromQuery(parsed, ['page', 'p']))
    if (link) return link
  }
  throw new Error('播放器链接里没有有效的 BV 号或 av 号；请打开原视频页后复制 /video/BV… 链接。')
}

export function parseVideoLink(input: unknown): VideoLink {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('请输入 B 站或 YouTube 视频链接')
  const text = input.trim()
  const bareBv = text.match(/^bv([0-9A-Za-z]{10})$/i)
  if (bareBv) {
    const bvid = `BV${bareBv[1]}`
    return { platform: 'bilibili', bvid, url: `https://www.bilibili.com/video/${bvid}`, page: 1 }
  }
  const bareAv = text.match(/^av(\d+)$/i)
  if (bareAv) return { platform: 'bilibili', aid: bareAv[1], url: `https://www.bilibili.com/video/av${bareAv[1]}`, page: 1 }

  const rawUrl = text.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]
  const noSchemeDomain = /^(?:[a-z0-9-]+\.)*(?:bilibili\.com|b23\.tv|youtube\.com|youtu\.be)(?:\/|$)/i.test(text)
  const candidate = (rawUrl || (noSchemeDomain ? `https://${text}` : text))
    // Shared text often appends Chinese punctuation or a sentence directly after the URL.
    .replace(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef].*$/, '')
    .replace(TRAILING_PUNCTUATION, '')
  let parsed: URL
  try { parsed = new URL(candidate) } catch { throw new Error('链接格式不正确，请粘贴完整视频链接或 BV 号') }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new Error('请输入有效的 HTTPS 视频链接')
  const host = parsed.hostname.toLowerCase()

  if (host === 'b23.tv') {
    if (!/^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)) throw new Error('B 站短链接格式不正确')
    return { platform: 'bilibili', url: `https://b23.tv${parsed.pathname}`, page: 1, short: true }
  }
  if (host === 'live.bilibili.com')
    throw new Error('这是直播链接，暂不支持直播；请打开直播回放对应的普通视频页后复制 /video/BV… 链接。')
  if (host === 'space.bilibili.com')
    throw new Error('这是 UP 主空间链接，不是单个视频；请打开具体视频后复制 /video/BV… 链接。')
  if (host === 'player.bilibili.com') return fromPlayerHost(parsed)
  if (BILI_HOSTS.has(host)) {
    const id = parsed.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/i)?.[1]
    if (!id) return unsupportedBili(parsed)
    const link = canonicalBili(id, pageFromQuery(parsed, ['p']))
    if (!link) return unsupportedBili(parsed)
    return link
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
