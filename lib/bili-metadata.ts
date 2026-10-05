export interface BiliVideo {
  bvid: string; cid: number; aid: number; title: string; desc: string; pic: string; duration: number
  owner?: { name: string; face: string }
  stat?: { view: number; like: number; coin: number; favorite: number; danmaku: number }
  pages?: { cid: number; page: number; part: string; duration: number }[]
}
export function biliMetadata(v: BiliVideo, page: number) {
  const pages = (v.pages || []).map(p => ({ cid: p.cid, page: p.page, title: p.part, duration: p.duration }))
  const selected = pages.find(p => p.page === page)
  if (pages.length && !selected) throw new Error('该视频没有这个分 P，请检查链接中的 p 参数')
  if (!v.bvid || !v.title) throw new Error('视频信息不完整，请稍后重试')
  return { platform: 'bilibili', title: v.title, uploader: v.owner?.name || '未知 UP 主', avatar: v.owner?.face, duration: selected?.duration || v.duration, views: v.stat?.view, likes: v.stat?.like, coins: v.stat?.coin, favorites: v.stat?.favorite, danmakus: v.stat?.danmaku, description: v.desc, thumbnail: v.pic, bvid: v.bvid, cid: selected?.cid || v.cid, aid: v.aid, url: `https://www.bilibili.com/video/${v.bvid}${page > 1 ? `?p=${page}` : ''}`, subtitles: [] as { lan: string; lan_doc: string; subtitle_url: string }[], hasSubtitles: false, subtitleNotice: '', pages, selectedPage: page }
}
