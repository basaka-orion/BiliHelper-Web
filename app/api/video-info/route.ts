import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请输入视频链接' }, { status: 400 })
    }

    // B站链接处理
    if (url.includes('bilibili.com') || url.includes('b23.tv')) {
      let bvid = ''

      // 处理短链接
      if (url.includes('b23.tv')) {
        try {
          const redirectResp = await fetch(url, { redirect: 'follow' })
          const finalUrl = redirectResp.url
          const match = finalUrl.match(/BV[a-zA-Z0-9]+/)
          bvid = match?.[0] || ''
        } catch {
          return NextResponse.json({ error: '短链接解析失败' }, { status: 400 })
        }
      } else {
        const match = url.match(/BV[a-zA-Z0-9]+/)
        bvid = match?.[0] || ''
      }

      if (!bvid) {
        return NextResponse.json({ error: '无法从链接中提取 BV 号' }, { status: 400 })
      }

      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
      const resp = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com',
        },
      })
      const data = await resp.json()

      if (data.code !== 0) {
        return NextResponse.json(
          { error: `B站 API 错误: ${data.message || '未知错误'}` },
          { status: 400 }
        )
      }

      const v = data.data
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
        bvid: bvid,
        aid: v.aid,
        url: url,
      })
    }

    // YouTube 链接处理
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const oembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`
      const resp = await fetch(oembedUrl)
      const data = await resp.json()

      if (data.error) {
        return NextResponse.json(
          { error: `YouTube 解析失败: ${data.error}` },
          { status: 400 }
        )
      }

      return NextResponse.json({
        platform: 'youtube',
        title: data.title,
        uploader: data.author_name,
        thumbnail: data.thumbnail_url,
        url: url,
      })
    }

    return NextResponse.json(
      { error: '不支持的链接，请输入 B 站或 YouTube 视频链接' },
      { status: 400 }
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `服务器错误: ${msg}` }, { status: 500 })
  }
}
