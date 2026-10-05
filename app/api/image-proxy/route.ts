import { NextRequest } from 'next/server'
import { trustedAsset } from '../../../lib/video-url'
import { biliHeaders, HttpError, errorResponse } from '../../../lib/upstream'

export async function GET(req: NextRequest) {
  try {
    let url
    try { url = trustedAsset(req.nextUrl.searchParams.get('url') || '', 'image') } catch (e) { throw new HttpError((e as Error).message, 400) }
    const response = await fetch(url, { headers: biliHeaders, redirect: 'error', signal: AbortSignal.timeout(8000) })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)(;|$)/i.test(contentType)) throw new HttpError('图片暂时不可用')
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new HttpError('图片过大', 413)
    const reader = response.body?.getReader()
    if (!reader) throw new HttpError('图片内容为空')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new HttpError('图片过大', 413) }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const image = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { image.set(chunk, offset); offset += chunk.length }
    return new Response(image, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
  } catch (e) { return errorResponse(e) }
}
