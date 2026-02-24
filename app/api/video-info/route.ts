import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请输入视频链接' }, { status: 400 })
    }

    // B站链接
    if (url.includes('bilibili.com') || url.includes('b23.tv')) {
      let bvid = ''
      let finalUrl = url

      // 短链解析
      if (url.includes('b23.tv')) {
        try {
          const r = await fetch(url, { redirect: 'follow' })
          finalUrl = r.url
        } catch { /* ignore */ }
      }
      const match = finalUrl.match(/BV[a-zA-Z0-9]+/)
      bvid = match?.[0] || ''
      if (!bvid) {
        return NextResponse.json({ error: '无法提取 BV 号' }, { status: 400 })
      }

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com',
      }

      // 1. 视频基础信息
      const infoResp = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { headers }
      )
      const infoData = await infoResp.json()
      if (infoData.code !== 0) {
        return NextResponse.json({ error: `B站错误: ${infoData.message}` }, { status: 400 })
      }
      const v = infoData.data
      const cid = v.cid

      // 2. 字幕列表
      let subtitles: { lan: string; lan_doc: string; subtitle_url: string }[] = []
      try {
        const playerResp = await fetch(
          `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`,
          { headers }
        )
        const playerData = await playerResp.json()
        if (playerData.code === 0 && playerData.data?.subtitle?.subtitles) {
          subtitles = playerData.data.subtitle.subtitles.map(
            (s: { lan: string; lan_doc: string; subtitle_url: string }) => ({
              lan: s.lan,
              lan_doc: s.lan_doc,
              subtitle_url: s.subtitle_url.startsWith('//')
                ? `https:${s.subtitle_url}`
                : s.subtitle_url,
            })
          )
        }
      } catch { /* 字幕获取失败不影响主流程 */ }

      return NextResponse.json({
        platform: 'bilibili',
        title: v.title,
        uploader: v.owner.name,
        avatar: v.owner.face,
        duration: v.duration,
        views: v.stat.view,
        likes: v.stat.like,
        coins: v.stat.coin,
        favorites: v.stat.favorite,
        danmakus: v.stat.danmaku,
        description: v.desc,
        thumbnail: v.pic,
        bvid,
        cid,
        aid: v.aid,
        url: finalUrl,
        subtitles,
        hasSubtitles: subtitles.length > 0,
      })
    }

    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)
      const data = await resp.json()
      if (data.error) {
        return NextResponse.json({ error: `YouTube 错误: ${data.error}` }, { status: 400 })
      }
      return NextResponse.json({
        platform: 'youtube',
        title: data.title,
        uploader: data.author_name,
        thumbnail: data.thumbnail_url,
        url,
        subtitles: [],
        hasSubtitles: false,
      })
    }

    return NextResponse.json({ error: '请输入 B 站或 YouTube 链接' }, { status: 400 })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `服务器错误: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }
}
