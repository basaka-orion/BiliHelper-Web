import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60 // Vercel Pro: 60s timeout

export async function POST(req: NextRequest) {
    try {
        const { bvid, cid } = await req.json()
        if (!bvid || !cid) {
            return NextResponse.json({ error: '缺少 bvid 或 cid' }, { status: 400 })
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://www.bilibili.com',
        }

        // 获取视频流地址
        const playResp = await fetch(
            `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`,
            { headers }
        )
        const playData = await playResp.json()

        if (playData.code !== 0 || !playData.data?.durl?.[0]?.url) {
            return NextResponse.json({ error: '获取视频流地址失败，可能需要登录' }, { status: 400 })
        }

        const videoUrl = playData.data.durl[0].url
        const size = playData.data.durl[0].size || 0

        // 如果文件太大（> 50MB），返回直链让用户用 yt-dlp 下载
        if (size > 50 * 1024 * 1024) {
            return NextResponse.json({
                mode: 'fallback',
                message: '视频较大，请使用以下命令下载',
                command: `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "https://www.bilibili.com/video/${bvid}"`,
                size,
            })
        }

        // 代理下载视频流
        const streamResp = await fetch(videoUrl, {
            headers: {
                ...headers,
                'Range': 'bytes=0-',
            },
        })

        if (!streamResp.ok || !streamResp.body) {
            return NextResponse.json({ error: '视频流获取失败' }, { status: 502 })
        }

        return new Response(streamResp.body, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename="${bvid}.mp4"`,
                'Content-Length': String(size || ''),
            },
        })
    } catch (e: unknown) {
        return NextResponse.json(
            { error: `下载失败: ${e instanceof Error ? e.message : String(e)}` },
            { status: 500 }
        )
    }
}
