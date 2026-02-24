import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url')
    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    try {
        const resp = await fetch(url, {
            headers: {
                'Referer': 'https://www.bilibili.com',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        })

        if (!resp.ok) {
            return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 })
        }

        const contentType = resp.headers.get('content-type') || 'image/jpeg'
        const buffer = await resp.arrayBuffer()

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, immutable',
            },
        })
    } catch {
        return NextResponse.json({ error: 'Proxy error' }, { status: 500 })
    }
}
