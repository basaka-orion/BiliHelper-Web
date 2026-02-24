export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (url.includes('bilibili.com') || url.includes('b23.tv')) {
      let bvid = "";
      if (url.includes('BV')) {
        const match = url.match(/BV[a-zA-Z0-9]+/);
        bvid = match ? match[0] : "";
      }
      
      // 处理短链接 b23.tv
      if (!bvid && url.includes('b23.tv')) {
         const resp = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
         const finalUrl = resp.url;
         const match = finalUrl.match(/BV[a-zA-Z0-9]+/);
         bvid = match ? match[0] : "";
      }

      if (!bvid) return Response.json({ error: '无法解析 BV 号' }, { status: 400 });

      const resp = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
        { 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com' 
          } 
        }
      );
      const data = await resp.json();

      if (data.code === 0) {
        const v = data.data;
        return Response.json({
          platform: 'bilibili',
          title: v.title,
          uploader: v.owner.name,
          avatar: v.owner.face,
          duration: v.duration,
          views: v.stat.view,
          likes: v.stat.like,
          description: v.desc,
          thumbnail: v.pic,
          bvid: bvid,
          url: `https://www.bilibili.com/video/${bvid}`
        });
      }
      return Response.json({ error: data.message || 'B站 API 调用失败' }, { status: 400 });
    }

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      const data = await resp.json();
      
      if (data.error) return Response.json({ error: 'YouTube 链接无效' }, { status: 400 });
      
      return Response.json({
        platform: 'youtube',
        title: data.title,
        uploader: data.author_name,
        thumbnail: data.thumbnail_url,
        url: url
      });
    }

    return Response.json({ error: '不支持的链接格式' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: '服务器错误' }, { status: 500 });
  }
}
